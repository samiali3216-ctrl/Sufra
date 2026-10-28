import express from "express";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import helmet from "helmet";
import { parseCookie as parse, stringifySetCookie } from "cookie";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { openDatabase, transaction } from "./db.js";
import {
  hash,
  token,
  passwordHash,
  passwordMatches,
  validNetwork,
  networkMatches,
} from "./security.js";
import {
  dayKey,
  cutoff,
  previousDay,
  withinOffice,
  csvCell,
} from "../src/domain.js";

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new ApiError(status, message);
};
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9._-]{2,63}$/,
    "اسم المستخدم: 3–64 حرفاً إنجليزياً أو رقماً أو . _ -",
  );
const password = z.string().min(12, "كلمة المرور لا تقل عن 12 محرفاً").max(128);
const name = z.string().trim().min(2).max(100);
const loginSchema = z
  .object({ username, password: z.string().min(1).max(128) })
  .strict();
const settingsSchema = z
  .object({
    company: name,
    budget: z.number().int().min(1).max(100000),
    office: z
      .object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        radius: z.number().min(25).max(1000),
      })
      .nullable(),
    networks: z
      .array(
        z
          .string()
          .refine(validNetwork, "عنوان الشبكة غير صالح؛ لا تستخدم loopback"),
      )
      .max(20),
    verification: z.enum(["self", "gps", "network", "either"]),
    autoPublish: z.boolean(),
  })
  .strict();
const mealSchema = z
  .object({
    name,
    description: z.string().trim().min(3).max(500),
    price: z.number().int().min(1).max(100000).optional(),
    quantity: z.number().int().min(1).max(100000).default(30),
    restaurant: name,
    allergens: z.string().trim().max(500),
    image: z.string().trim().max(2048).refine(value => {
      if (!value || /^photo-[a-zA-Z0-9-]+$/.test(value) || /^\/uploads\/[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(value)) return true;
      try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
    }, "أدخل رابط صورة يبدأ بـ https:// أو ارفع صورة من جهازك."),
    enabled: z.boolean(),
    confirmed: z.boolean(),
  })
  .strict();
const parseBody = (schema, body) => {
  const r = schema.safeParse(body);
  if (!r.success) fail(400, r.error.issues[0]?.message || "بيانات غير صالحة");
  return r.data;
};
const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  department: u.department,
  role: u.role,
  active: !!u.active,
  activated: !!u.password_hash,
});

export function createApp({
  dbPath = "data/luqma.sqlite",
  clock = () => Date.now(),
  origin = "http://localhost:3000",
  allowedOrigins = [origin],
  secureCookies = false,
  allowSetup = true,
} = {}) {
  const db = openDatabase(dbPath),
    app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
          ],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:", "http:"],
          connectSrc: ["'self'", "ws://localhost:*", "ws://127.0.0.1:*"],
          upgradeInsecureRequests: secureCookies ? [] : null,
        },
      },
      strictTransportSecurity: secureCookies ? undefined : false,
    }),
  );
  app.use((req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(self), camera=(), microphone=()",
    );
    if (req.path.startsWith("/api/"))
      res.setHeader("Cache-Control", "no-store");
    next();
  });
  const uploadDirectory = resolve(dbPath === ':memory:' ? 'data/uploads' : resolve(dirname(dbPath),'uploads'));
  app.use('/uploads', express.static(uploadDirectory, { dotfiles:'deny', index:false, immutable:true, maxAge:'1y', setHeaders: res => res.setHeader('X-Content-Type-Options','nosniff') }));
  app.use('/api/admin/images', express.json({limit:'6mb'}));
  app.use(express.json({ limit: "24kb" }));
  const settings = () =>
    JSON.parse(
      db.prepare("SELECT payload FROM settings WHERE id=1").get().payload,
    );
  const audit = (actor, event, detail = {}, day = null) =>
    db
      .prepare(
        "INSERT INTO audit(at,actor_id,event,day,detail) VALUES(?,?,?,?,?)",
      )
      .run(clock(), actor, event, day, JSON.stringify(detail));
  const getDay = (day) => db.prepare("SELECT * FROM days WHERE day=?").get(day);
  const count = (day) =>
    db.prepare("SELECT count(*) n FROM attendance WHERE day=?").get(day).n;
  const dayMeals = (day) =>
    db
      .prepare(
        `SELECT m.*,coalesce(sum(v.weight),0) points,count(v.user_id) voters FROM day_meals m LEFT JOIN votes v ON m.day=v.day AND m.meal_id=v.meal_id WHERE m.day=? GROUP BY m.day,m.meal_id ORDER BY m.price DESC,m.meal_id`,
      )
      .all(day);
  function publish(day, actor) {
    const d = getDay(day);
    if (d.published) return;
    const s = settings(),
      meals = db
        .prepare("SELECT * FROM meals WHERE enabled=1 ORDER BY id")
        .all();
    if (
      meals.length === 0 ||
      meals.some((m) => !m.confirmed)
    )
      fail(409, "أضف وجبة مفعلة واحدة على الأقل وأكد توفر الوجبات مع المورد أولاً.");
    if (clock() >= d.attendance_deadline)
      fail(409, "فات موعد اعتماد خيارات اليوم قبل 11:00.");
    for (const m of meals)
      db.prepare("INSERT INTO day_meals(day,meal_id,name,description,price,restaurant,allergens,image,quantity) VALUES(?,?,?,?,?,?,?,?,?)").run(
        day,
        m.id,
        m.name,
        m.description,
        m.price,
        m.restaurant,
        m.allergens,
        m.image,
        m.quantity,
      );
    db.prepare(
      "INSERT OR IGNORE INTO day_people SELECT ?,id FROM users WHERE role='employee' AND active=1",
    ).run(day);
    db.prepare("UPDATE days SET published=1,budget=? WHERE day=?").run(
      s.budget,
      day,
    );
    audit(
      actor,
      "day.published",
      { options: meals.map((m) => m.id), budget: s.budget },
      day,
    );
  }
  // Each finalized result is immutable. Catch-up also covers periods when the process was stopped.
  function sync() {
    transaction(db, () => {
      const now = clock(),
        day = dayKey(now),
        s = settings();
      db.prepare(
        "INSERT OR IGNORE INTO days(day,budget,attendance_deadline,vote_deadline) VALUES(?,?,?,?)",
      ).run(day, s.budget, cutoff(day, "attendance"), cutoff(day, "voting"));
      if (
        s.autoPublish &&
        !getDay(day).published &&
        now < cutoff(day, "attendance")
      ) {
        try {
          publish(day, null);
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
        }
      }
      if (getDay(day).published && now < cutoff(day, "attendance"))
        db.prepare(
          "INSERT OR IGNORE INTO day_people SELECT ?,id FROM users WHERE role='employee' AND active=1",
        ).run(day);
      const due = db
        .prepare(
          "SELECT * FROM days WHERE published=1 AND finalized_at IS NULL AND vote_deadline<=?",
        )
        .all(now);
      for (const d of due) {
        const options = dayMeals(d.day).sort(
          (a, b) =>
            b.points - a.points ||
            a.price - b.price ||
            a.meal_id.localeCompare(b.meal_id),
        );
        const winner = options[0]?.points ? options[0].meal_id : null;
        db.prepare(
          "UPDATE days SET finalized_at=?,winner_id=?,final_count=? WHERE day=?",
        ).run(d.vote_deadline, winner, count(d.day), d.day);
        audit(null, "day.finalized", { winner, count: count(d.day) }, d.day);
      }
      db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
      db.prepare("DELETE FROM proofs WHERE expires_at<=?").run(now);
    });
  }
  function history(id, day) {
    return [3, 2, 1].map((n) => {
      const date = previousDay(day, n),
        d = getDay(date),
        v = db
          .prepare("SELECT meal_id FROM votes WHERE user_id=? AND day=?")
          .get(id, date);
      return {
        day: date,
        winner: d?.winner_id ?? null,
        choice: v?.meal_id ?? null,
      };
    });
  }
  function weight(id, day) {
    const h = history(id, day);
    return h.every((r) => r.winner && r.choice && r.winner !== r.choice)
      ? 2
      : 1;
  }
  const attempts = new Map();
  function rate(key, limit = 10) {
    const now = clock();
    let r = attempts.get(key);
    if (!r || r.until <= now) r = { n: 0, until: now + 15 * 60 * 1000 };
    r.n++;
    attempts.set(key, r);
    if (attempts.size > 5000)
      for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
    if (r.n > limit) fail(429, "محاولات كثيرة. حاول بعد 15 دقيقة.");
  }
  const cookieName = "luqma_session";
  function sessionCookie(res, value, maxAge) {
    res.setHeader(
      "Set-Cookie",
      stringifySetCookie({
        name: cookieName,
        value,
        httpOnly: true,
        secure: secureCookies,
        sameSite: "strict",
        path: "/",
        maxAge,
      }),
    );
  }
  function issueSession(res, id) {
    const secret = token(),
      csrf = token(),
      expires = clock() + 8 * 60 * 60 * 1000;
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      hash(secret),
      id,
      csrf,
      expires,
    );
    sessionCookie(res, secret, 8 * 60 * 60);
    return csrf;
  }
  app.use("/api", (req, res, next) => {
    try {
      const raw = parse(req.headers.cookie || "")[cookieName];
      if (raw) {
        const session = db
          .prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?")
          .get(hash(raw), clock());
        if (session) {
          const user = db
            .prepare(
              "SELECT * FROM users WHERE id=? AND active=1 AND password_hash IS NOT NULL",
            )
            .get(session.user_id);
          if (user) {
            req.user = user;
            req.session = session;
          }
        }
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        if (!allowedOrigins.includes(req.headers.origin)) fail(403, "مصدر الطلب غير مسموح. افتح الموقع من العنوان المعتمد: " + origin);
        if (
          req.user &&
          !["/auth/login", "/setup", "/auth/activate"].includes(req.path)
        ) {
          const csrf = req.headers["x-csrf-token"];
          if (
            typeof csrf !== "string" ||
            Buffer.byteLength(csrf) !== Buffer.byteLength(req.session.csrf) ||
            !timingSafeEqual(Buffer.from(csrf), Buffer.from(req.session.csrf))
          )
            fail(403, "جلسة الحماية غير صالحة. حدّث الصفحة.");
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  });
  const auth = (req, res, next) =>
    req.user ? next() : next(new ApiError(401, "سجّل دخولك أولاً."));
  const admin = (req, res, next) =>
    req.user?.role === "admin"
      ? next()
      : next(new ApiError(403, "هذه العملية للمشرف فقط."));
  const employee = (req, res, next) =>
    req.user?.role === "employee"
      ? next()
      : next(new ApiError(403, "هذه العملية لحساب الموظف فقط."));
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/setup", (req, res) =>
    res.json({ required: !db.prepare("SELECT id FROM users LIMIT 1").get() }),
  );
  app.post("/api/setup", async (req, res, next) => {
    try {
      const remote = req.socket.remoteAddress;
      if (
        !allowSetup ||
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)
      )
        fail(403, "إنشاء المشرف الأول متاح من جهاز الخادم فقط.");
      rate(`setup:${remote}`, 5);
      if (db.prepare("SELECT id FROM users LIMIT 1").get())
        fail(409, "اكتمل إعداد النظام مسبقاً.");
      const body = parseBody(
        z.object({ username, password, name }).strict(),
        req.body,
      );
      const encoded = await passwordHash(body.password),
        id = randomUUID();
      transaction(db, () => {
        if (db.prepare("SELECT id FROM users LIMIT 1").get())
          fail(409, "اكتمل الإعداد مسبقاً.");
        db.prepare(
          "INSERT INTO users(id,username,name,role,password_hash,created_at) VALUES(?,?,?,?,?,?)",
        ).run(id, body.username, body.name, "admin", encoded, clock());
        audit(id, "setup.completed");
      });
      const csrf = issueSession(res, id);
      res
        .status(201)
        .json({
          user: publicUser(
            db.prepare("SELECT * FROM users WHERE id=?").get(id),
          ),
          csrf,
        });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const b = parseBody(loginSchema, req.body);
      rate(`login-ip:${req.socket.remoteAddress}`, 50);
      rate(`login-user:${b.username}`, 10);
      const u = db
        .prepare("SELECT * FROM users WHERE username=?")
        .get(b.username);
      const correct = await passwordMatches(b.password, u?.password_hash);
      if (!correct || !u?.active) {
        audit(null, "auth.failed", { username: b.username });
        fail(401, "اسم المستخدم أو كلمة المرور غير صحيح.");
      }
      if (req.session)
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
          req.session.token_hash,
        );
      const csrf = issueSession(res, u.id);
      audit(u.id, "auth.login");
      res.json({ user: publicUser(u), csrf });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/auth/session", auth, (req, res) =>
    res.json({ user: publicUser(req.user), csrf: req.session.csrf }),
  );
  app.post("/api/auth/logout", auth, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
      req.session.token_hash,
    );
    sessionCookie(res, "", 0);
    res.json({ ok: true });
  });
  app.post("/api/auth/password", auth, async (req, res, next) => {
    try {
      const b = parseBody(
        z.object({ currentPassword: z.string().max(128), password }).strict(),
        req.body,
      );
      if (!(await passwordMatches(b.currentPassword, req.user.password_hash)))
        fail(400, "كلمة المرور الحالية غير صحيحة.");
      const encoded = await passwordHash(b.password);
      transaction(db, () => {
        db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
          encoded,
          req.user.id,
        );
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.user.id);
        audit(req.user.id, "auth.password.changed");
      });
      res.json({ csrf: issueSession(res, req.user.id) });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/auth/activate", async (req, res, next) => {
    try {
      rate(`activate:${req.socket.remoteAddress}`, 15);
      const b = parseBody(
        z.object({ token: z.string().min(40).max(100), password }).strict(),
        req.body,
      );
      const invite = db
        .prepare(
          "SELECT * FROM invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
        )
        .get(hash(b.token), clock());
      if (!invite) fail(400, "رابط الدعوة غير صالح أو انتهى.");
      const encoded = await passwordHash(b.password);
      transaction(db, () => {
        const valid = db
          .prepare(
            "SELECT * FROM invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
          )
          .get(hash(b.token), clock());
        const u =
          valid &&
          db
            .prepare("SELECT * FROM users WHERE id=? AND active=1")
            .get(valid.user_id);
        if (!u) fail(400, "رابط الدعوة غير صالح أو الحساب معطل.");
        db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
          encoded,
          u.id,
        );
        db.prepare(
          "UPDATE invites SET used_at=? WHERE user_id=? AND used_at IS NULL",
        ).run(clock(), u.id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
        audit(u.id, "auth.activated");
      });
      const u = db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(invite.user_id);
      res.json({ user: publicUser(u), csrf: issueSession(res, u.id) });
    } catch (e) {
      next(e);
    }
  });
  app.use("/api", (req, res, next) => {
    try {
      if (req.user) sync();
      next();
    } catch (e) {
      next(e);
    }
  });
  function today(user) {
    const now = clock(),
      day = dayKey(now),
      d = getDay(day),
      s = settings(),
      a = db
        .prepare("SELECT at,method FROM attendance WHERE user_id=? AND day=?")
        .get(user.id, day),
      v = db
        .prepare("SELECT meal_id,weight FROM votes WHERE user_id=? AND day=?")
        .get(user.id, day),
      totalUsers = d.published
        ? db.prepare("SELECT count(*) n FROM day_people WHERE day=?").get(day).n
        : db
            .prepare(
              "SELECT count(*) n FROM users WHERE role='employee' AND active=1",
            )
            .get().n;
    return {
      serverNow: now,
      day,
      company: s.company,
      budget: d.budget,
      published: !!d.published,
      attendanceDeadline: d.attendance_deadline,
      voteDeadline: d.vote_deadline,
      attendanceClosed: now >= d.attendance_deadline,
      votingClosed: now >= d.vote_deadline,
      finalized: !!d.finalized_at,
      winnerId: d.winner_id,
      count: d.final_count ?? count(day),
      employeeCount: totalUsers,
      meals: dayMeals(day),
      own: {
        attendance: a || null,
        vote: v || null,
        weight: weight(user.id, day),
        history: history(user.id, day),
      },
      verification: {
        mode: s.verification,
        configured:
          s.verification === "self" ? true : s.verification === "gps"
            ? !!s.office
            : s.verification === "network"
              ? s.networks.length > 0
              : !!s.office || s.networks.length > 0,
        office: s.office ? { radius: s.office.radius } : null,
      },
      policyVersion: s.policyVersion,
    };
  }
  app.get("/api/today", auth, (req, res) => res.json(today(req.user)));
  app.post("/api/presence/verify", auth, employee, (req, res, next) => {
    try {
      rate(`verify:${req.user.id}`, 60);
      const b = parseBody(
        z
          .object({
            position: z
              .object({
                latitude: z.number().min(-90).max(90),
                longitude: z.number().min(-180).max(180),
                accuracy: z.number().min(0).max(10000),
                timestamp: z.number(),
              })
              .optional(),
          })
          .strict(),
        req.body,
      );
      const s = settings(),
        now = clock(),
        day = dayKey(now),
        d = getDay(day);
      if (!d.published) fail(409, "لم تعتمد خيارات الغداء اليوم بعد.");
      if (now >= d.attendance_deadline)
        fail(409, "انتهى تسجيل الحضور الساعة 11:00.");
      if (
        db
          .prepare("SELECT 1 FROM attendance WHERE day=? AND user_id=?")
          .get(day, req.user.id)
      )
        fail(409, "حضورك مؤكد بالفعل.");
      let method = null;
      if (
        ["network", "either"].includes(s.verification) &&
        networkMatches(req.socket.remoteAddress, s.networks)
      )
        method = "network";
      if (!method && ["gps", "either"].includes(s.verification) && b.position) {
        const p = b.position,
          result = withinOffice(
            {
              timestamp: p.timestamp,
              coords: {
                latitude: p.latitude,
                longitude: p.longitude,
                accuracy: p.accuracy,
              },
            },
            s.office,
            now,
          );
        if (!result.ok) fail(403, result.reason);
        method = "gps";
      }
      if (!method)
        fail(
          403,
          s.verification === "network"
            ? "اتصل بشبكة الشركة المعتمدة. لا تُقبل شبكة loopback أو معلومات IP من العميل."
            : "التحقق يتطلب موقعاً داخل نطاق الشركة أو شبكة معتمدة بحسب الإعداد.",
        );
      const proof = token();
      db.prepare("INSERT INTO proofs VALUES(?,?,?,?,?,?,NULL)").run(
        hash(proof),
        req.user.id,
        req.session.token_hash,
        day,
        method,
        now + 60000,
      );
      res.json({ proof, expiresAt: now + 60000, method });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/attendance", auth, employee, (req, res, next) => {
    try {
      const b = parseBody(
        z
          .object({
            proof: z.string().min(40).max(100).optional(),
            acknowledged: z.literal(true),
          })
          .strict(),
        req.body,
      );
      transaction(db, () => {
        const now = clock(),
          day = dayKey(now),
          d = getDay(day);
        if (!d.published || now >= d.attendance_deadline)
          fail(409, "بوابة حضور اليوم مغلقة.");
        const selfConfirmation = settings().verification === 'self';
        const proof = selfConfirmation ? {method:'self'} : b.proof ? db
          .prepare(
            "SELECT * FROM proofs WHERE token_hash=? AND user_id=? AND session_hash=? AND day=? AND used_at IS NULL AND expires_at>?",
          )
          .get(hash(b.proof), req.user.id, req.session.token_hash, day, now) : null;
        if (!proof) fail(403, "التحقق منتهي أو غير صالح. أعد التحقق.");
        if (
          db
            .prepare("SELECT 1 FROM attendance WHERE day=? AND user_id=?")
            .get(day, req.user.id)
        )
          fail(409, "حضورك مؤكد بالفعل.");
        db.prepare("INSERT INTO attendance VALUES(?,?,?,?,?)").run(
          day,
          req.user.id,
          now,
          proof.method,
          settings().policyVersion,
        );
        if (!selfConfirmation) db.prepare("UPDATE proofs SET used_at=? WHERE token_hash=?").run(
          now,
          proof.token_hash,
        );
        audit(
          req.user.id,
          "attendance.self_confirmed",
          { method: proof.method },
          day,
        );
      });
      res.status(201).json(today(req.user));
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/votes", auth, employee, (req, res, next) => {
    try {
      const b = parseBody(
        z.object({ mealId: z.string().min(1).max(100) }).strict(),
        req.body,
      );
      transaction(db, () => {
        const now = clock(),
          day = dayKey(now),
          d = getDay(day);
        if (!d.published || d.finalized_at || now >= d.vote_deadline)
          fail(409, "انتهى التصويت الساعة 11:15.");
        if (
          !db
            .prepare("SELECT 1 FROM attendance WHERE day=? AND user_id=?")
            .get(day, req.user.id)
        )
          fail(403, "أكّد حضورك أولاً.");
        if (
          !db
            .prepare(
              "SELECT 1 FROM day_meals WHERE day=? AND meal_id=? AND price<=?",
            )
            .get(day, b.mealId, d.budget)
        )
          fail(400, "الوجبة غير متاحة.");
        const w = weight(req.user.id, day);
        db.prepare(
          "INSERT INTO votes VALUES(?,?,?,?,?) ON CONFLICT(day,user_id) DO UPDATE SET meal_id=excluded.meal_id,weight=excluded.weight,at=excluded.at",
        ).run(day, req.user.id, b.mealId, w, now);
        audit(req.user.id, "vote.saved", { meal: b.mealId, weight: w }, day);
      });
      res.json(today(req.user));
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/admin/settings", auth, admin, (req, res) =>
    res.json(settings()),
  );
  app.put("/api/admin/settings", auth, admin, (req, res, next) => {
    try {
      const b = parseBody(settingsSchema, req.body),
        before = settings();
      if (b.autoPublish) {
        const meals = db.prepare("SELECT * FROM meals WHERE enabled=1").all();
        if (
          meals.length === 0 ||
          meals.some((m) => !m.confirmed)
        )
          fail(
            409,
            "التشغيل اليومي التلقائي يحتاج وجبة مفعلة واحدة على الأقل مع تأكيد التوفر.",
          );
      }
      const next = {
        ...b,
        policyVersion: String(Number(before.policyVersion) + 1),
      };
      db.prepare("UPDATE settings SET payload=? WHERE id=1").run(
        JSON.stringify(next),
      );
      db.prepare("DELETE FROM proofs").run();
      audit(req.user.id, "settings.updated", {
        policyVersion: next.policyVersion,
      });
      res.json(next);
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/admin/images', auth, admin, (req,res,next) => {
    try {
      const {data} = parseBody(z.object({data:z.string().min(1).max(5592410).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict(),req.body);
      const bytes = Buffer.from(data,'base64');
      if (!bytes.length || bytes.length > 4*1024*1024) fail(400,'حجم الصورة يجب ألا يتجاوز 4 ميجابايت.');
      let ext;
      if (bytes.length > 24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ext='png';
      else if (bytes.length > 4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255 && bytes.at(-2)===255 && bytes.at(-1)===217) ext='jpg';
      else if (bytes.length > 12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') ext='webp';
      else if (bytes.length > 13 && ['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6))) ext='gif';
      else fail(400,'الملف ليس صورة مدعومة. استخدم JPG أو PNG أو WebP أو GIF.');
      mkdirSync(uploadDirectory,{recursive:true});
      const filename = randomUUID()+'.'+ext;
      writeFileSync(resolve(uploadDirectory,filename),bytes,{flag:'wx'});
      audit(req.user.id,'image.uploaded',{filename});
      res.status(201).json({url:'/uploads/'+filename});
    } catch(e) { next(e); }
  });
  app.get("/api/admin/meals", auth, admin, (req, res) =>
    res.json(db.prepare("SELECT * FROM meals ORDER BY id").all()),
  );
  app.post("/api/admin/meals", auth, admin, (req, res, next) => {
    try {
      const b = parseBody(mealSchema, req.body), id = randomUUID();
      db.prepare("INSERT INTO meals(id,name,description,price,restaurant,allergens,image,enabled,confirmed,quantity) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(id,b.name,b.description,b.price ?? settings().budget,b.restaurant,b.allergens,b.image,Number(b.enabled),Number(b.confirmed),b.quantity);
      audit(req.user.id,"meal.created",{id});
      res.status(201).json({id});
    } catch(e) { next(e); }
  });
  app.delete("/api/admin/meals/:id", auth, admin, (req,res,next) => {
    try {
      if (!db.prepare("DELETE FROM meals WHERE id=?").run(req.params.id).changes) fail(404,"الوجبة غير موجودة.");
      audit(req.user.id,"meal.deleted",{id:req.params.id});
      res.json({ok:true});
    } catch(e) { next(e); }
  });
  app.put("/api/admin/meals/:id", auth, admin, (req, res, next) => {
    try {
      const b = parseBody(mealSchema, req.body);
      if (!db.prepare("SELECT id FROM meals WHERE id=?").get(req.params.id))
        fail(404, "الوجبة غير موجودة.");
      db.prepare(
        "UPDATE meals SET name=?,description=?,price=?,restaurant=?,allergens=?,image=?,enabled=?,confirmed=?,quantity=? WHERE id=?",
      ).run(
        b.name,
        b.description,
        b.price ?? settings().budget,
        b.restaurant,
        b.allergens,
        b.image,
        Number(b.enabled),
        Number(b.confirmed),
        b.quantity,
        req.params.id,
      );
      audit(req.user.id, "meal.updated", { id: req.params.id });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/admin/day/publish", auth, admin, (req, res, next) => {
    try {
      parseBody(z.object({ confirmed: z.literal(true) }).strict(), req.body);
      transaction(db, () => publish(dayKey(clock()), req.user.id));
      res.json(today(req.user));
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/admin/employees", auth, admin, (req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM users ORDER BY created_at,id")
        .all()
        .map(publicUser),
    ),
  );
  const makeInvite = (id) => {
    db.prepare(
      "UPDATE invites SET used_at=? WHERE user_id=? AND used_at IS NULL",
    ).run(clock(), id);
    const secret = token();
    db.prepare("INSERT INTO invites VALUES(?,?,?,NULL)").run(
      hash(secret),
      id,
      clock() + 48 * 60 * 60 * 1000,
    );
    return `${origin}/join#${secret}`;
  };
  app.post("/api/admin/employees", auth, admin, (req, res, next) => {
    try {
      const b = parseBody(
        z
          .object({ username, name, department: z.string().trim().max(100) })
          .strict(),
        req.body,
      );
      if (db.prepare("SELECT 1 FROM users WHERE username=?").get(b.username))
        fail(409, "اسم المستخدم مستخدم مسبقاً.");
      const id = randomUUID();
      let invite;
      transaction(db, () => {
        db.prepare(
          "INSERT INTO users(id,username,name,department,role,created_at) VALUES(?,?,?,?,'employee',?)",
        ).run(id, b.username, b.name, b.department, clock());
        invite = makeInvite(id);
        audit(req.user.id, "employee.created", { id });
      });
      res
        .status(201)
        .json({
          invite,
          user: publicUser(
            db.prepare("SELECT * FROM users WHERE id=?").get(id),
          ),
        });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/admin/employees/:id/invite", auth, admin, (req, res, next) => {
    try {
      const u = db
        .prepare(
          "SELECT * FROM users WHERE id=? AND role='employee' AND active=1",
        )
        .get(req.params.id);
      if (!u) fail(404, "الموظف غير موجود أو معطل.");
      const invite = makeInvite(u.id);
      audit(req.user.id, "employee.invited", { id: u.id });
      res.json({ invite });
    } catch (e) {
      next(e);
    }
  });
  app.patch("/api/admin/employees/:id", auth, admin, (req, res, next) => {
    try {
      const b = parseBody(z.object({ active: z.boolean() }).strict(), req.body);
      const u = db
        .prepare("SELECT * FROM users WHERE id=? AND role='employee'")
        .get(req.params.id);
      if (!u) fail(404, "الموظف غير موجود.");
      transaction(db, () => {
        db.prepare("UPDATE users SET active=? WHERE id=?").run(
          Number(b.active),
          u.id,
        );
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
        db.prepare(
          "UPDATE invites SET used_at=? WHERE user_id=? AND used_at IS NULL",
        ).run(clock(), u.id);
        audit(
          req.user.id,
          b.active ? "employee.enabled" : "employee.disabled",
          { id: u.id },
        );
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  function report(day) {
    const d = getDay(day);
    if (!d) fail(404, "لا يوجد سجل لهذا اليوم.");
    const people = db
      .prepare(
        `SELECT u.id,u.name,u.department,u.active,a.at,a.method FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.day=? WHERE u.role='employee' AND (EXISTS(SELECT 1 FROM day_people dp WHERE dp.day=? AND dp.user_id=u.id) OR a.at IS NOT NULL) ORDER BY u.name`,
      )
      .all(day, day);
    return {
      day,
      record: d,
      count: d.final_count ?? count(day),
      meals: dayMeals(day),
      people: people.map((p) => ({
        ...p,
        status: p.at
          ? "present"
          : clock() >= d.attendance_deadline
            ? "absent"
            : "pending",
      })),
      audit: db
        .prepare(
          "SELECT a.*,u.name actor FROM audit a LEFT JOIN users u ON a.actor_id=u.id WHERE a.day=? ORDER BY a.id DESC LIMIT 200",
        )
        .all(day),
    };
  }
  const reportDay = (req) => {
    const day = req.query.day || dayKey(clock());
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day))
      fail(400, "تاريخ غير صالح.");
    return day;
  };
  app.get("/api/admin/report", auth, admin, (req, res, next) => {
    try {
      res.json(report(reportDay(req)));
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/admin/export", auth, admin, (req, res, next) => {
    try {
      const r = report(reportDay(req));
      const safe = (v) => csvCell(/^[=+@\-\t\r]/.test(String(v)) ? `'${v}` : v);
      const rows = [
        ["اليوم", "الموظف", "القسم", "الحالة", "وقت التأكيد", "طريقة التحقق"],
        ...r.people.map((p) => [
          r.day,
          p.name,
          p.department,
          p.status === "present"
            ? "حضور ذاتي"
            : p.status === "absent"
              ? "غائب عن الغداء"
              : "بانتظار التأكيد",
          p.at ? new Date(p.at).toISOString() : "",
          p.method || "",
        ]),
      ];
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="attendance-${r.day}.csv"`,
      );
      res
        .type("text/csv")
        .send(
          "\ufeff" + rows.map((row) => row.map(safe).join(",")).join("\r\n"),
        );
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/admin/order", auth, admin, (req, res, next) => {
    try {
      const r = report(reportDay(req)),
        meal = r.meals.find((m) => m.meal_id === r.record.winner_id);
      if (!r.record.finalized_at || !meal || !r.count)
        fail(409, "لا يوجد طلب معتمد بعد.");
      res.json({
        day: r.day,
        meal,
        count: r.count,
        budget: r.record.budget,
        total: r.count * meal.price,
        ceiling: r.count * r.record.budget,
        saving: r.count * (r.record.budget - meal.price),
        notice: "ملخص للتحميل، لم يتم إرسال الطلب إلى المورد.",
      });
    } catch (e) {
      next(e);
    }
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "المسار غير موجود." }),
  );
  app.use((error, req, res, next) => {
    if (error instanceof ApiError)
      return res.status(error.status).json({ error: error.message });
    if (error.type === "entity.parse.failed")
      return res.status(400).json({ error: "صيغة الطلب غير صالحة." });
    if (error.type === "entity.too.large")
      return res.status(413).json({ error: "حجم الطلب أكبر من المسموح." });
    console.error("Server error:", error.message);
    res.status(500).json({ error: "تعذر إكمال العملية. حاول لاحقاً." });
  });
  sync();
  return { app, db, sync, close: () => db.close() };
}
