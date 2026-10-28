import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { hash, token, passwordHash, passwordMatches, validNetwork, networkMatches } from "./security.js";
import { createPushService, validPushEndpoint } from "./push.js";
import { dayKey, cutoff, previousDay, withinOffice, csvCell, MEALS } from "./domain.js";

// ─── Error handling ───
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new ApiError(status, message); };

// ─── Zod schemas ───
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/, "اسم المستخدم: 3–64 حرفاً إنجليزياً أو رقماً أو . _ -");
const password = z.string().min(12, "كلمة المرور لا تقل عن 12 محرفاً").max(128);
const name = z.string().trim().min(2).max(100);
const loginSchema = z.object({ username, password: z.string().min(1).max(128) }).strict();
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "أدخل وقتاً صحيحاً بصيغة ساعة:دقيقة.");
const settingsSchema = z.object({
  company: name, budget: z.number().int().min(1).max(100000),
  office: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), radius: z.number().min(25).max(1000) }).nullable(),
  networks: z.array(z.string().refine(validNetwork, "عنوان الشبكة غير صالح؛ لا تستخدم loopback")).max(20),
  verification: z.enum(["self", "gps", "network", "either"]), autoPublish: z.boolean(),
  attendanceTime: timeSchema, voteTime: timeSchema,
}).strict().refine(s => s.attendanceTime < s.voteTime, { message: "يجب أن ينتهي تسجيل الغداء قبل إغلاق التصويت." });
const announcementSchema = z.object({
  kind: z.enum(["update", "delay", "important", "ready", "reminder", "change"]),
  title: z.string().trim().min(3, "اكتب عنواناً واضحاً للإشعار.").max(90),
  message: z.string().trim().min(8, "اكتب تفاصيل الإشعار للموظفين.").max(600),
  expectedRevision: z.number().int().min(0),
}).strict();
const pushSubscriptionSchema = z.object({
  endpoint: z.string().refine(validPushEndpoint, "رابط خدمة الإشعارات غير مدعوم."),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{20,30}$/) }).strict(),
}).strict();
const mealSchema = z.object({
  name, description: z.string().trim().min(3).max(500),
  price: z.number().int().min(1).max(100000).optional(),
  quantity: z.number().int().min(1).max(100000).default(30),
  restaurant: name, allergens: z.string().trim().max(500),
  image: z.string().trim().max(2048).refine(value => {
    if (!value || /^photo-[a-zA-Z0-9-]+$/.test(value) || /^\/uploads\/[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(value)) return true;
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
  }, "أدخل رابط صورة يبدأ بـ https:// أو ارفع صورة من جهازك."),
  enabled: z.boolean(), confirmed: z.boolean(),
}).strict();

const parseBody = (schema, body) => {
  const r = schema.safeParse(body);
  if (!r.success) fail(400, r.error.issues[0]?.message || "بيانات غير صالحة");
  return r.data;
};
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, department: u.department, role: u.role, active: !!u.active, activated: !!u.password_hash });
const cookieName = "luqma_session";

// ─── Database helpers (async, D1) ───
async function settings(db) {
  const row = await db.prepare("SELECT payload FROM settings WHERE id=1").first();
  return JSON.parse(row.payload);
}
async function announcement(db, includeInactive = false) {
  const row = await db.prepare("SELECT * FROM announcement WHERE id=1").first();
  if (!row || (!includeInactive && !row.active)) return null;
  return { kind: row.kind, title: row.title, message: row.message, active: !!row.active, revision: row.revision, updatedAt: row.updated_at };
}
async function audit(db, actor, event, detail = {}, day = null) {
  await db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)").bind(Date.now(), actor, event, day, JSON.stringify(detail)).run();
}
async function getDay(db, day) {
  return await db.prepare("SELECT * FROM days WHERE day=?").bind(day).first();
}
async function count(db, day) {
  return (await db.prepare("SELECT count(*) n FROM attendance WHERE day=?").bind(day).first()).n;
}
async function dayMeals(db, day) {
  return (await db.prepare(
    "SELECT m.*,coalesce(sum(v.weight),0) points,count(v.user_id) voters FROM day_meals m LEFT JOIN votes v ON m.day=v.day AND m.meal_id=v.meal_id WHERE m.day=? GROUP BY m.day,m.meal_id ORDER BY m.price DESC,m.meal_id"
  ).bind(day).all()).results;
}
async function history(db, id, day) {
  const results = [];
  for (const n of [3, 2, 1]) {
    const date = previousDay(day, n);
    const d = await getDay(db, date);
    const v = await db.prepare("SELECT meal_id FROM votes WHERE user_id=? AND day=?").bind(id, date).first();
    results.push({ day: date, winner: d?.winner_id ?? null, choice: v?.meal_id ?? null });
  }
  return results;
}
async function weight(db, id, day) {
  const h = await history(db, id, day);
  return h.every(r => r.winner && r.choice && r.winner !== r.choice) ? 2 : 1;
}

// ─── Sync (replaces setInterval scheduler) ───
let lastSync = 0;
const SYNC_INTERVAL = 15000;

async function reconcileTodaySchedule(db, day, s, actor = null) {
  const current = await getDay(db, day);
  if (!current) return;
  const attendanceDeadline = cutoff(day, "attendance", s.attendanceTime);
  const voteDeadline = cutoff(day, "voting", s.voteTime);
  if (current.attendance_deadline === attendanceDeadline && current.vote_deadline === voteDeadline) return;
  const reopen = !!current.finalized_at && Date.now() < voteDeadline;
  await db.batch([
    db.prepare("UPDATE days SET attendance_deadline=?,vote_deadline=?,finalized_at=?,winner_id=?,final_count=? WHERE day=?")
      .bind(attendanceDeadline, voteDeadline, reopen ? null : current.finalized_at, reopen ? null : current.winner_id, reopen ? null : current.final_count, day),
    db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)")
      .bind(Date.now(), actor, reopen ? "day.reopened_by_settings" : "day.deadlines_updated", day, JSON.stringify({ attendanceDeadline, voteDeadline, reconciled: actor === null }))
  ]);
}

async function publish(db, origin, day, actor) {
  const d = await getDay(db, day);
  if (d.published) return;
  const s = await settings(db);
  const meals = (await db.prepare("SELECT * FROM meals WHERE enabled=1 ORDER BY id").all()).results;
  if (meals.length === 0 || meals.some(m => !m.confirmed))
    fail(409, "أضف وجبة مفعلة واحدة على الأقل وأكد توفر الوجبات مع المورد أولاً.");
  if (Date.now() >= d.attendance_deadline)
    fail(409, "فات موعد اعتماد خيارات اليوم قبل إغلاق تسجيل الغداء.");
  const stmts = meals.map(m =>
    db.prepare("INSERT INTO day_meals(day,meal_id,name,description,price,restaurant,allergens,image,quantity) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(day, m.id, m.name, m.description, m.price, m.restaurant, m.allergens, m.image, m.quantity)
  );
  stmts.push(db.prepare("INSERT OR IGNORE INTO day_people SELECT ?,id FROM users WHERE role='employee' AND active=1").bind(day));
  stmts.push(db.prepare("UPDATE days SET published=1,budget=? WHERE day=?").bind(s.budget, day));
  stmts.push(db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)")
    .bind(Date.now(), actor, "day.published", day, JSON.stringify({ options: meals.map(m => m.id), budget: s.budget })));
  await db.batch(stmts);
}

async function sync(env) {
  const db = env.DB;
  const now = Date.now(), day = dayKey(now);
  const s = await settings(db);
  await db.prepare("INSERT OR IGNORE INTO days(day,budget,attendance_deadline,vote_deadline) VALUES(?,?,?,?)")
    .bind(day, s.budget, cutoff(day, "attendance", s.attendanceTime), cutoff(day, "voting", s.voteTime)).run();
  await reconcileTodaySchedule(db, day, s);
  const today = await getDay(db, day);
  if (s.autoPublish && !today.published && now < today.attendance_deadline) {
    try { await publish(db, env.ORIGIN, day, null); } catch (e) { if (!(e instanceof ApiError)) throw e; }
  }
  const todayAfter = await getDay(db, day);
  if (todayAfter.published && now < todayAfter.attendance_deadline)
    await db.prepare("INSERT OR IGNORE INTO day_people SELECT ?,id FROM users WHERE role='employee' AND active=1").bind(day).run();
  const due = (await db.prepare("SELECT * FROM days WHERE published=1 AND finalized_at IS NULL AND vote_deadline<=?").bind(now).all()).results;
  for (const d of due) {
    const options = await dayMeals(db, d.day);
    options.sort((a, b) => b.points - a.points || a.price - b.price || a.meal_id.localeCompare(b.meal_id));
    const winner = options[0]?.points ? options[0].meal_id : null;
    const dayCount = await count(db, d.day);
    await db.batch([
      db.prepare("UPDATE days SET finalized_at=?,winner_id=?,final_count=? WHERE day=?").bind(d.vote_deadline, winner, dayCount, d.day),
      db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)").bind(now, null, "day.finalized", d.day, JSON.stringify({ winner, count: dayCount }))
    ]);
  }
  await db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now).run();
  await db.prepare("DELETE FROM proofs WHERE expires_at<=?").bind(now).run();
}

async function maybeSync(env) {
  const now = Date.now();
  if (now - lastSync < SYNC_INTERVAL) return;
  lastSync = now;
  try { await sync(env); } catch (e) { console.error("Sync error:", e.message); }
}

// ─── Session helpers ───
async function issueSession(c, db, id) {
  const secret = token(), csrf = token(), expires = Date.now() + 8 * 60 * 60 * 1000;
  await db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").bind(hash(secret), id, csrf, expires).run();
  setCookie(c, cookieName, secret, { httpOnly: true, secure: true, sameSite: "Strict", path: "/", maxAge: 8 * 60 * 60 });
  return csrf;
}

async function today(db, user) {
  const now = Date.now(), day = dayKey(now);
  const d = await getDay(db, day);
  const s = await settings(db);
  const a = await db.prepare("SELECT at,method FROM attendance WHERE user_id=? AND day=?").bind(user.id, day).first();
  const v = await db.prepare("SELECT meal_id,weight FROM votes WHERE user_id=? AND day=?").bind(user.id, day).first();
  const totalUsers = d.published
    ? (await db.prepare("SELECT count(*) n FROM day_people WHERE day=?").bind(day).first()).n
    : (await db.prepare("SELECT count(*) n FROM users WHERE role='employee' AND active=1").first()).n;
  const meals = await dayMeals(db, day);
  const hist = await history(db, user.id, day);
  const w = await weight(db, user.id, day);
  const ann = await announcement(db);
  return {
    serverNow: now, day, company: s.company, announcement: ann, budget: d.budget,
    published: !!d.published, attendanceDeadline: d.attendance_deadline, voteDeadline: d.vote_deadline,
    attendanceClosed: now >= d.attendance_deadline, votingClosed: now >= d.vote_deadline,
    finalized: !!d.finalized_at, winnerId: d.winner_id,
    count: d.final_count ?? await count(db, day), employeeCount: totalUsers,
    meals, own: { attendance: a || null, vote: v || null, weight: w, history: hist },
    verification: {
      mode: s.verification,
      configured: s.verification === "self" ? true : s.verification === "gps" ? !!s.office : s.verification === "network" ? s.networks.length > 0 : !!s.office || s.networks.length > 0,
      office: s.office ? { radius: s.office.radius } : null,
    },
    policyVersion: s.policyVersion,
  };
}

async function makeInvite(db, origin, id) {
  await db.prepare("UPDATE invites SET used_at=? WHERE user_id=? AND used_at IS NULL").bind(Date.now(), id).run();
  const secret = token();
  await db.prepare("INSERT INTO invites VALUES(?,?,?,NULL)").bind(hash(secret), id, Date.now() + 48 * 60 * 60 * 1000).run();
  return `${origin}/join#${secret}`;
}

async function report(db, day) {
  const d = await getDay(db, day);
  if (!d) fail(404, "لا يوجد سجل لهذا اليوم.");
  const people = (await db.prepare(
    "SELECT u.id,u.name,u.department,u.active,a.at,a.method FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.day=? WHERE u.role='employee' AND (EXISTS(SELECT 1 FROM day_people dp WHERE dp.day=? AND dp.user_id=u.id) OR a.at IS NOT NULL) ORDER BY u.name"
  ).bind(day, day).all()).results;
  const meals = await dayMeals(db, day);
  const dayCount = d.final_count ?? await count(db, day);
  const auditRows = (await db.prepare("SELECT a.*,u.name actor FROM audit a LEFT JOIN users u ON a.actor_id=u.id WHERE a.day=? ORDER BY a.id DESC LIMIT 200").bind(day).all()).results;
  return {
    day, record: d, count: dayCount, meals,
    people: people.map(p => ({ ...p, status: p.at ? "present" : Date.now() >= d.attendance_deadline ? "absent" : "pending" })),
    audit: auditRows,
  };
}

const reportDay = (c) => {
  const day = c.req.query("day") || dayKey(Date.now());
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(400, "تاريخ غير صالح.");
  return day;
};

// ─── Rate limiting (per-isolate) ───
const attempts = new Map();
function rate(key, limit = 10) {
  const now = Date.now();
  let r = attempts.get(key);
  if (!r || r.until <= now) r = { n: 0, until: now + 15 * 60 * 1000 };
  r.n++; attempts.set(key, r);
  if (attempts.size > 5000) for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
  if (r.n > limit) fail(429, "محاولات كثيرة. حاول بعد 15 دقيقة.");
}

// ─── Hono app ───
const app = new Hono();

// Security headers
app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
  if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  await next();
});

// Session + CSRF middleware
app.use("/api/*", async (c, next) => {
  const db = c.env.DB;
  const raw = getCookie(c, cookieName);
  if (raw) {
    const session = await db.prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?").bind(hash(raw), Date.now()).first();
    if (session) {
      const user = await db.prepare("SELECT * FROM users WHERE id=? AND active=1 AND password_hash IS NOT NULL").bind(session.user_id).first();
      if (user) { c.set("user", user); c.set("session", session); }
    }
  }
  const method = c.req.method;
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const origin = c.req.header("origin");
    const ownOrigin = c.env.ORIGIN || new URL(c.req.url).origin;
    if (origin && origin !== ownOrigin) fail(403, "مصدر الطلب غير مسموح. افتح الموقع من العنوان المعتمد.");
    const user = c.get("user");
    const session = c.get("session");
    const path = c.req.path;
    if (user && !["/api/auth/login", "/api/setup", "/api/auth/activate"].includes(path)) {
      const csrf = c.req.header("x-csrf-token");
      if (typeof csrf !== "string" || Buffer.byteLength(csrf) !== Buffer.byteLength(session.csrf) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf)))
        fail(403, "جلسة الحماية غير صالحة. حدّث الصفحة.");
    }
  }
  await next();
});

// Sync middleware
app.use("/api/*", async (c, next) => {
  if (c.get("user")) await maybeSync(c.env);
  await next();
});

// Auth middleware
const auth = async (c, next) => { if (c.get("user")) await next(); else fail(401, "سجّل دخولك أولاً."); };
const admin = async (c, next) => { if (c.get("user")?.role === "admin") await next(); else fail(403, "هذه العملية للمشرف فقط."); };
const employee = async (c, next) => { if (c.get("user")?.role === "employee") await next(); else fail(403, "هذه العملية لحساب الموظف فقط."); };

// ─── Routes: Health & Setup ───
app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/setup", async (c) => {
  const row = await c.env.DB.prepare("SELECT id FROM users LIMIT 1").first();
  return c.json({ required: !row });
});

app.post("/api/setup", async (c) => {
  const db = c.env.DB;
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  rate(`setup:${ip}`, 5);
  if (await db.prepare("SELECT id FROM users LIMIT 1").first()) fail(409, "اكتمل إعداد النظام مسبقاً.");
  const body = parseBody(z.object({ username, password, name }).strict(), await c.req.json());
  const encoded = await passwordHash(body.password);
  const id = randomUUID();
  if (await db.prepare("SELECT id FROM users LIMIT 1").first()) fail(409, "اكتمل الإعداد مسبقاً.");
  await db.batch([
    db.prepare("INSERT INTO users(id,username,name,role,password_hash,created_at) VALUES(?,?,?,?,?,?)").bind(id, body.username, body.name, "admin", encoded, Date.now()),
    db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)").bind(Date.now(), id, "setup.completed", null, "{}"),
  ]);
  const csrf = await issueSession(c, db, id);
  const user = await db.prepare("SELECT * FROM users WHERE id=?").bind(id).first();
  return c.json({ user: publicUser(user), csrf }, 201);
});

// ─── Routes: Auth ───
app.post("/api/auth/login", async (c) => {
  const db = c.env.DB;
  const b = parseBody(loginSchema, await c.req.json());
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  rate(`login-ip:${ip}`, 50);
  rate(`login-user:${b.username}`, 10);
  const u = await db.prepare("SELECT * FROM users WHERE username=?").bind(b.username).first();
  const correct = await passwordMatches(b.password, u?.password_hash);
  if (!correct || !u?.active) { await audit(db, null, "auth.failed", { username: b.username }); fail(401, "اسم المستخدم أو كلمة المرور غير صحيح."); }
  const session = c.get("session");
  if (session) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(session.token_hash).run();
  const csrf = await issueSession(c, db, u.id);
  await audit(db, u.id, "auth.login");
  return c.json({ user: publicUser(u), csrf });
});

app.get("/api/auth/session", auth, (c) => c.json({ user: publicUser(c.get("user")), csrf: c.get("session").csrf }));

app.post("/api/auth/logout", auth, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(c.get("session").token_hash).run();
  setCookie(c, cookieName, "", { httpOnly: true, secure: true, sameSite: "Strict", path: "/", maxAge: 0 });
  return c.json({ ok: true });
});

app.post("/api/auth/password", auth, async (c) => {
  const db = c.env.DB;
  const b = parseBody(z.object({ currentPassword: z.string().max(128), password }).strict(), await c.req.json());
  const user = c.get("user");
  if (!(await passwordMatches(b.currentPassword, user.password_hash))) fail(400, "كلمة المرور الحالية غير صحيحة.");
  const encoded = await passwordHash(b.password);
  await db.batch([
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").bind(encoded, user.id),
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id),
    db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)").bind(Date.now(), user.id, "auth.password.changed", null, "{}"),
  ]);
  const csrf = await issueSession(c, db, user.id);
  return c.json({ csrf });
});

app.post("/api/auth/activate", async (c) => {
  const db = c.env.DB;
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  rate(`activate:${ip}`, 15);
  const b = parseBody(z.object({ token: z.string().min(40).max(100), password }).strict(), await c.req.json());
  const invite = await db.prepare("SELECT * FROM invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?").bind(hash(b.token), Date.now()).first();
  if (!invite) fail(400, "رابط الدعوة غير صالح أو انتهى.");
  const encoded = await passwordHash(b.password);
  const valid = await db.prepare("SELECT * FROM invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?").bind(hash(b.token), Date.now()).first();
  const u = valid && await db.prepare("SELECT * FROM users WHERE id=? AND active=1").bind(valid.user_id).first();
  if (!u) fail(400, "رابط الدعوة غير صالح أو الحساب معطل.");
  await db.batch([
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").bind(encoded, u.id),
    db.prepare("UPDATE invites SET used_at=? WHERE user_id=? AND used_at IS NULL").bind(Date.now(), u.id),
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.id),
    db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)").bind(Date.now(), u.id, "auth.activated", null, "{}"),
  ]);
  const user = await db.prepare("SELECT * FROM users WHERE id=?").bind(u.id).first();
  const csrf = await issueSession(c, db, u.id);
  return c.json({ user: publicUser(user), csrf });
});

// ─── Routes: Employee ───
app.get("/api/today", auth, async (c) => c.json(await today(c.env.DB, c.get("user"))));

app.get("/api/push/config", auth, employee, (c) => c.json({ publicKey: "" }));

app.post("/api/push/subscriptions", auth, employee, async (c) => {
  const db = c.env.DB;
  const subscription = parseBody(pushSubscriptionSchema, await c.req.json());
  const existing = await db.prepare("SELECT user_id FROM push_subscriptions WHERE endpoint=?").bind(subscription.endpoint).first();
  const cnt = (await db.prepare("SELECT count(*) n FROM push_subscriptions WHERE user_id=?").bind(c.get("user").id).first()).n;
  if (existing?.user_id !== c.get("user").id && cnt >= 10) fail(409, "بلغت الحد الأقصى للأجهزة. أوقف الإشعارات من جهاز قديم أولاً.");
  await db.prepare("INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at")
    .bind(subscription.endpoint, c.get("user").id, subscription.keys.p256dh, subscription.keys.auth, Date.now(), Date.now()).run();
  return c.json({ subscribed: true });
});

app.delete("/api/push/subscriptions", auth, employee, async (c) => {
  const body = parseBody(z.object({ endpoint: z.string().refine(validPushEndpoint) }).strict(), await c.req.json());
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?").bind(body.endpoint, c.get("user").id).run();
  return c.json({ subscribed: false });
});

app.post("/api/presence/verify", auth, employee, async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  rate(`verify:${user.id}`, 60);
  const b = parseBody(z.object({
    position: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(0).max(10000), timestamp: z.number() }).optional()
  }).strict(), await c.req.json());
  const s = await settings(db);
  const now = Date.now(), day = dayKey(now);
  const d = await getDay(db, day);
  if (!d.published) fail(409, "لم تعتمد خيارات الغداء اليوم بعد.");
  if (now >= d.attendance_deadline) fail(409, "انتهى وقت تأكيد المشاركة اليوم.");
  if (await db.prepare("SELECT 1 FROM attendance WHERE day=? AND user_id=?").bind(day, user.id).first()) fail(409, "حضورك مؤكد بالفعل.");
  let method = null;
  const ip = c.req.header("CF-Connecting-IP") || "";
  if (["network", "either"].includes(s.verification) && networkMatches(ip, s.networks)) method = "network";
  if (!method && ["gps", "either"].includes(s.verification) && b.position) {
    const result = withinOffice({ timestamp: b.position.timestamp, coords: { latitude: b.position.latitude, longitude: b.position.longitude, accuracy: b.position.accuracy } }, s.office, now);
    if (!result.ok) fail(403, result.reason);
    method = "gps";
  }
  if (!method) fail(403, s.verification === "network" ? "اتصل بشبكة الشركة المعتمدة." : "التحقق يتطلب موقعاً داخل نطاق الشركة أو شبكة معتمدة بحسب الإعداد.");
  const proof = token();
  await db.prepare("INSERT INTO proofs VALUES(?,?,?,?,?,?,NULL)").bind(hash(proof), user.id, c.get("session").token_hash, day, method, now + 60000).run();
  return c.json({ proof, expiresAt: now + 60000, method });
});

app.post("/api/attendance", auth, employee, async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const b = parseBody(z.object({ proof: z.string().min(40).max(100).optional(), acknowledged: z.literal(true) }).strict(), await c.req.json());
  const now = Date.now(), day = dayKey(now);
  const d = await getDay(db, day);
  if (!d.published || now >= d.attendance_deadline) fail(409, "بوابة حضور اليوم مغلقة.");
  const selfConfirmation = (await settings(db)).verification === "self";
  let proofRow = null;
  if (selfConfirmation) { proofRow = { method: "self" }; }
  else if (b.proof) {
    proofRow = await db.prepare("SELECT * FROM proofs WHERE token_hash=? AND user_id=? AND session_hash=? AND day=? AND used_at IS NULL AND expires_at>?").bind(hash(b.proof), user.id, c.get("session").token_hash, day, now).first();
  }
  if (!proofRow) fail(403, "التحقق منتهي أو غير صالح. أعد التحقق.");
  if (await db.prepare("SELECT 1 FROM attendance WHERE day=? AND user_id=?").bind(day, user.id).first()) fail(409, "حضورك مؤكد بالفعل.");
  const s = await settings(db);
  const stmts = [
    db.prepare("INSERT INTO attendance VALUES(?,?,?,?,?)").bind(day, user.id, now, proofRow.method, s.policyVersion),
    db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)").bind(now, user.id, "attendance.self_confirmed", day, JSON.stringify({ method: proofRow.method })),
  ];
  if (!selfConfirmation) stmts.push(db.prepare("UPDATE proofs SET used_at=? WHERE token_hash=?").bind(now, hash(b.proof)));
  await db.batch(stmts);
  return c.json(await today(db, user), 201);
});

app.post("/api/votes", auth, employee, async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const b = parseBody(z.object({ mealId: z.string().min(1).max(100) }).strict(), await c.req.json());
  const now = Date.now(), day = dayKey(now);
  const d = await getDay(db, day);
  if (!d.published || d.finalized_at || now >= d.vote_deadline) fail(409, "انتهى وقت التصويت اليوم.");
  if (!await db.prepare("SELECT 1 FROM attendance WHERE day=? AND user_id=?").bind(day, user.id).first()) fail(403, "أكّد حضورك أولاً.");
  if (!await db.prepare("SELECT 1 FROM day_meals WHERE day=? AND meal_id=? AND price<=?").bind(day, b.mealId, d.budget).first()) fail(400, "الوجبة غير متاحة.");
  const w = await weight(db, user.id, day);
  await db.batch([
    db.prepare("INSERT INTO votes VALUES(?,?,?,?,?) ON CONFLICT(day,user_id) DO UPDATE SET meal_id=excluded.meal_id,weight=excluded.weight,at=excluded.at").bind(day, user.id, b.mealId, w, now),
    db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)").bind(now, user.id, "vote.saved", day, JSON.stringify({ meal: b.mealId, weight: w })),
  ]);
  return c.json(await today(db, user));
});

// ─── Routes: Admin — Settings ───
app.get("/api/admin/settings", auth, admin, async (c) => c.json(await settings(c.env.DB)));

app.put("/api/admin/settings", auth, admin, async (c) => {
  const db = c.env.DB;
  const b = parseBody(settingsSchema, await c.req.json());
  const before = await settings(db);
  if (b.autoPublish) {
    const meals = (await db.prepare("SELECT * FROM meals WHERE enabled=1").all()).results;
    if (meals.length === 0 || meals.some(m => !m.confirmed)) fail(409, "التشغيل اليومي التلقائي يحتاج وجبة مفعلة واحدة على الأقل مع تأكيد التوفر.");
  }
  const next = { ...b, policyVersion: String(Number(before.policyVersion) + 1) };
  const day = dayKey(Date.now());
  await db.batch([
    db.prepare("UPDATE settings SET payload=? WHERE id=1").bind(JSON.stringify(next)),
    db.prepare("DELETE FROM proofs"),
    db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)").bind(Date.now(), c.get("user").id, "settings.updated", null, JSON.stringify({ policyVersion: next.policyVersion })),
  ]);
  await reconcileTodaySchedule(db, day, next, c.get("user").id);
  await maybeSync(c.env);
  return c.json(next);
});

// ─── Routes: Admin — Announcement ───
app.get("/api/admin/announcement", auth, admin, async (c) => c.json(await announcement(c.env.DB, true)));

app.put("/api/admin/announcement", auth, admin, async (c) => {
  const db = c.env.DB;
  const b = parseBody(announcementSchema, await c.req.json());
  const current = await announcement(db, true);
  if (b.expectedRevision !== (current?.revision ?? 0)) fail(409, "تغيّر الإشعار في جلسة أخرى. حدّث الصفحة قبل الحفظ.");
  await db.prepare("INSERT INTO announcement(id,kind,title,message,active,revision,updated_at,updated_by) VALUES(1,?,?,?,1,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,message=excluded.message,active=1,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by")
    .bind(b.kind, b.title, b.message, b.expectedRevision + 1, Date.now(), c.get("user").id).run();
  await audit(db, c.get("user").id, "announcement.published", { kind: b.kind, title: b.title, revision: b.expectedRevision + 1 }, dayKey(Date.now()));
  return c.json(await announcement(db, true));
});

app.delete("/api/admin/announcement", auth, admin, async (c) => {
  const db = c.env.DB;
  const b = parseBody(z.object({ expectedRevision: z.number().int().min(1) }).strict(), await c.req.json());
  const current = await announcement(db, true);
  if (!current || !current.active) fail(409, "لا يوجد إشعار منشور لإيقافه.");
  if (b.expectedRevision !== current.revision) fail(409, "تغيّر الإشعار في جلسة أخرى. حدّث الصفحة قبل إيقافه.");
  await db.prepare("UPDATE announcement SET active=0,revision=?,updated_at=?,updated_by=? WHERE id=1").bind(current.revision + 1, Date.now(), c.get("user").id).run();
  await audit(db, c.get("user").id, "announcement.disabled", { revision: current.revision + 1 }, dayKey(Date.now()));
  return c.json(await announcement(db, true));
});

// ─── Routes: Admin — Images ───
app.post("/api/admin/images", auth, admin, async (c) => {
  const db = c.env.DB;
  const { data } = parseBody(z.object({ data: z.string().min(1).max(700000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict(), await c.req.json());
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > 512 * 1024) fail(400, "حجم الصورة يجب ألا يتجاوز 512 كيلوبايت.");
  let ext;
  if (bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ext = "png";
  else if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) ext = "jpg";
  else if (bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") ext = "webp";
  else if (bytes.length > 13 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) ext = "gif";
  else fail(400, "الملف ليس صورة مدعومة. استخدم JPG أو PNG أو WebP أو GIF.");
  const filename = `${randomUUID()}.${ext}`;
  const contentType = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" }[ext];
  await db.prepare("INSERT INTO images(filename,data,content_type,created_at) VALUES(?,?,?,?)").bind(filename, data, contentType, Date.now()).run();
  await audit(db, c.get("user").id, "image.uploaded", { filename });
  return c.json({ url: `/uploads/${filename}` }, 201);
});

app.get("/uploads/:filename", async (c) => {
  const row = await c.env.DB.prepare("SELECT data,content_type FROM images WHERE filename=?").bind(c.req.param("filename")).first();
  if (!row) return c.notFound();
  return new Response(Buffer.from(row.data, "base64"), {
    headers: { "Content-Type": row.content_type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
});

// ─── Routes: Admin — Meals ───
app.get("/api/admin/meals", auth, admin, async (c) => c.json((await c.env.DB.prepare("SELECT * FROM meals ORDER BY id").all()).results));

app.post("/api/admin/meals", auth, admin, async (c) => {
  const db = c.env.DB;
  const b = parseBody(mealSchema, await c.req.json());
  const id = randomUUID();
  const s = await settings(db);
  await db.prepare("INSERT INTO meals(id,name,description,price,restaurant,allergens,image,enabled,confirmed,quantity) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(id, b.name, b.description, b.price ?? s.budget, b.restaurant, b.allergens, b.image, Number(b.enabled), Number(b.confirmed), b.quantity).run();
  await audit(db, c.get("user").id, "meal.created", { id });
  return c.json({ id }, 201);
});

app.delete("/api/admin/meals/:id", auth, admin, async (c) => {
  const db = c.env.DB;
  const result = await db.prepare("DELETE FROM meals WHERE id=?").bind(c.req.param("id")).run();
  if (!result.meta.changes) fail(404, "الوجبة غير موجودة.");
  await audit(db, c.get("user").id, "meal.deleted", { id: c.req.param("id") });
  return c.json({ ok: true });
});

app.put("/api/admin/meals/:id", auth, admin, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const b = parseBody(mealSchema, await c.req.json());
  if (!await db.prepare("SELECT id FROM meals WHERE id=?").bind(id).first()) fail(404, "الوجبة غير موجودة.");
  const s = await settings(db);
  await db.prepare("UPDATE meals SET name=?,description=?,price=?,restaurant=?,allergens=?,image=?,enabled=?,confirmed=?,quantity=? WHERE id=?")
    .bind(b.name, b.description, b.price ?? s.budget, b.restaurant, b.allergens, b.image, Number(b.enabled), Number(b.confirmed), b.quantity, id).run();
  await audit(db, c.get("user").id, "meal.updated", { id });
  return c.json({ ok: true });
});

// ─── Routes: Admin — Day ───
app.post("/api/admin/day/publish", auth, admin, async (c) => {
  parseBody(z.object({ confirmed: z.literal(true) }).strict(), await c.req.json());
  await publish(c.env.DB, c.env.ORIGIN, dayKey(Date.now()), c.get("user").id);
  return c.json(await today(c.env.DB, c.get("user")));
});

// ─── Routes: Admin — Employees ───
app.get("/api/admin/employees", auth, admin, async (c) => {
  const db = c.env.DB;
  const day = dayKey(Date.now());
  const users = (await db.prepare("SELECT * FROM users ORDER BY created_at,id").all()).results;
  return c.json(await Promise.all(users.map(async (u) => ({
    ...publicUser(u),
    todayAttendance: !!(await db.prepare("SELECT 1 FROM attendance WHERE day=? AND user_id=?").bind(day, u.id).first()),
    todayVote: (await db.prepare("SELECT meal_id FROM votes WHERE day=? AND user_id=?").bind(day, u.id).first())?.meal_id ?? null,
  }))));
});

app.post("/api/admin/employees", auth, admin, async (c) => {
  const db = c.env.DB;
  const b = parseBody(z.object({ username, name, department: z.string().trim().max(100) }).strict(), await c.req.json());
  if (await db.prepare("SELECT 1 FROM users WHERE username=?").bind(b.username).first()) fail(409, "اسم المستخدم مستخدم مسبقاً.");
  const id = randomUUID();
  await db.prepare("INSERT INTO users(id,username,name,department,role,created_at) VALUES(?,?,?,?,'employee',?)").bind(id, b.username, b.name, b.department, Date.now()).run();
  const invite = await makeInvite(db, c.env.ORIGIN, id);
  await audit(db, c.get("user").id, "employee.created", { id });
  const user = await db.prepare("SELECT * FROM users WHERE id=?").bind(id).first();
  return c.json({ invite, user: publicUser(user) }, 201);
});

app.post("/api/admin/employees/:id/invite", auth, admin, async (c) => {
  const db = c.env.DB;
  const u = await db.prepare("SELECT * FROM users WHERE id=? AND role='employee' AND active=1").bind(c.req.param("id")).first();
  if (!u) fail(404, "الموظف غير موجود أو معطل.");
  const invite = await makeInvite(db, c.env.ORIGIN, u.id);
  await audit(db, c.get("user").id, u.password_hash ? "employee.password_reset_invited" : "employee.invited", { id: u.id });
  return c.json({ invite });
});

app.put("/api/admin/employees/:id", auth, admin, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const b = parseBody(z.object({ username, name, department: z.string().trim().max(100) }).strict(), await c.req.json());
  const u = await db.prepare("SELECT * FROM users WHERE id=? AND role='employee'").bind(id).first();
  if (!u) fail(404, "الموظف غير موجود.");
  if (await db.prepare("SELECT 1 FROM users WHERE username=? AND id<>?").bind(b.username, u.id).first()) fail(409, "اسم المستخدم مستخدم مسبقاً.");
  await db.batch([
    db.prepare("UPDATE users SET username=?,name=?,department=? WHERE id=?").bind(b.username, b.name, b.department, u.id),
    db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)").bind(Date.now(), c.get("user").id, "employee.profile_updated", null, JSON.stringify({ id: u.id, before: { username: u.username, name: u.name, department: u.department }, after: b })),
  ]);
  return c.json(publicUser(await db.prepare("SELECT * FROM users WHERE id=?").bind(u.id).first()));
});

app.post("/api/admin/employees/:id/assisted-vote", auth, admin, async (c) => {
  const db = c.env.DB;
  const b = parseBody(z.object({ mealId: z.string().min(1).max(100), employeeRequested: z.literal(true), presentInPerson: z.literal(true) }).strict(), await c.req.json());
  const now = Date.now(), day = dayKey(now);
  const d = await getDay(db, day);
  const u = await db.prepare("SELECT * FROM users WHERE id=? AND role='employee' AND active=1").bind(c.req.param("id")).first();
  if (!u) fail(404, "الموظف غير موجود أو حسابه معطل.");
  if (!d.published || d.finalized_at || now >= d.vote_deadline) fail(409, "التصويت غير متاح الآن.");
  if (!await db.prepare("SELECT 1 FROM day_people WHERE day=? AND user_id=?").bind(day, u.id).first()) fail(409, "الموظف غير مدرج ضمن قائمة اليوم.");
  if (!await db.prepare("SELECT 1 FROM day_meals WHERE day=? AND meal_id=? AND price<=?").bind(day, b.mealId, d.budget).first()) fail(400, "الوجبة غير متاحة اليوم.");
  const s = await settings(db);
  const attended = !!(await db.prepare("SELECT 1 FROM attendance WHERE day=? AND user_id=?").bind(day, u.id).first());
  const stmts = [];
  if (!attended) {
    if (now >= d.attendance_deadline) fail(409, "انتهى تسجيل الغداء؛ لا يمكن إضافة حضور جديد لهذا اليوم.");
    stmts.push(db.prepare("INSERT INTO attendance VALUES(?,?,?,?,?)").bind(day, u.id, now, "admin_assisted", s.policyVersion));
    stmts.push(db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)").bind(now, c.get("user").id, "attendance.admin_assisted", day, JSON.stringify({ employeeId: u.id })));
  }
  const previousMealId = (await db.prepare("SELECT meal_id FROM votes WHERE day=? AND user_id=?").bind(day, u.id).first())?.meal_id ?? null;
  const w = await weight(db, u.id, day);
  stmts.push(db.prepare("INSERT INTO votes VALUES(?,?,?,?,?) ON CONFLICT(day,user_id) DO UPDATE SET meal_id=excluded.meal_id,weight=excluded.weight,at=excluded.at").bind(day, u.id, b.mealId, w, now));
  stmts.push(db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)").bind(now, c.get("user").id, "vote.admin_assisted", day, JSON.stringify({ employeeId: u.id, mealId: b.mealId, previousMealId, weight: w })));
  await db.batch(stmts);
  return c.json({ ok: true });
});

app.patch("/api/admin/employees/:id", auth, admin, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const b = parseBody(z.object({ active: z.boolean() }).strict(), await c.req.json());
  const u = await db.prepare("SELECT * FROM users WHERE id=? AND role='employee'").bind(id).first();
  if (!u) fail(404, "الموظف غير موجود.");
  const stmts = [
    db.prepare("UPDATE users SET active=? WHERE id=?").bind(Number(b.active), u.id),
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.id),
    db.prepare("UPDATE invites SET used_at=? WHERE user_id=? AND used_at IS NULL").bind(Date.now(), u.id),
    db.prepare("INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)").bind(Date.now(), c.get("user").id, b.active ? "employee.enabled" : "employee.disabled", null, JSON.stringify({ id: u.id })),
  ];
  if (!b.active) stmts.push(db.prepare("DELETE FROM push_subscriptions WHERE user_id=?").bind(u.id));
  await db.batch(stmts);
  return c.json({ ok: true });
});

// ─── Routes: Admin — Reports ───
app.get("/api/admin/report", auth, admin, async (c) => c.json(await report(c.env.DB, reportDay(c))));

app.get("/api/admin/export", auth, admin, async (c) => {
  const r = await report(c.env.DB, reportDay(c));
  const safe = (v) => csvCell(/^[=+@\-\t\r]/.test(String(v)) ? `'${v}` : v);
  const rows = [
    ["اليوم", "الموظف", "القسم", "الحالة", "وقت التأكيد", "طريقة التحقق"],
    ...r.people.map(p => [
      r.day, p.name, p.department,
      p.status === "present" ? p.method === "admin_assisted" ? "حضور بمساعدة المشرف" : "حضور ذاتي" : p.status === "absent" ? "غائب عن الغداء" : "بانتظار التأكيد",
      p.at ? new Date(p.at).toISOString() : "",
      p.method === "admin_assisted" ? "تأكيد المشرف" : p.method === "self" ? "تأكيد ذاتي" : p.method === "gps" ? "GPS" : p.method === "network" ? "شبكة الشركة" : "",
    ]),
  ];
  const csv = "\ufeff" + rows.map(row => row.map(safe).join(",")).join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${r.day}.csv"` } });
});

app.get("/api/admin/order", auth, admin, async (c) => {
  const r = await report(c.env.DB, reportDay(c));
  const meal = r.meals.find(m => m.meal_id === r.record.winner_id);
  if (!r.record.finalized_at || !meal || !r.count) fail(409, "لا يوجد طلب معتمد بعد.");
  return c.json({
    day: r.day, meal, count: r.count, budget: r.record.budget,
    total: r.count * meal.price, ceiling: r.count * r.record.budget,
    saving: r.count * (r.record.budget - meal.price),
    notice: "ملخص للتحميل، لم يتم إرسال الطلب إلى المورد.",
  });
});

// ─── 404 + Error handler ───
app.all("/api/*", (c) => c.json({ error: "المسار غير موجود." }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.message }, err.status);
  console.error("Server error:", err.message);
  return c.json({ error: "تعذر إكمال العملية. حاول لاحقاً." }, 500);
});

// ─── Export ───
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    await sync(env);
  },
};
