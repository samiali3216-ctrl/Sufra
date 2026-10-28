export const ZONE = "Asia/Aden";
export const BUDGET = 900;
export const EMPLOYEE_ID = "e25";
export const MEALS = [
  {
    id: "mandi",
    name: "مندي الدجاج",
    subtitle: "الكلاسيكية التي تجمعنا",
    description: "دجاج مندي، أرز متبل، سلطة وسحاوق",
    price: 900,
    category: "وجبة القائد",
    image: "photo-1512058564366-18510be2db19",
    restaurant: "مطبخ الدار",
    allergens: "يلزم تأكيد مكونات التتبيلة مع المورد",
    color: "orange",
  },
  {
    id: "shawarma",
    name: "شاورما على المزاج",
    subtitle: "خفيفة على اليوم، غنية بالنكهة",
    description: "شاورما دجاج، بطاطس، مخلل وصوص",
    price: 850,
    category: "الخيار السريع",
    image: "photo-1561651823-34feb02250e4",
    restaurant: "ركن الشاورما",
    allergens: "قد تحتوي قمحاً وحليباً وسمسماً",
    color: "purple",
  },
  {
    id: "green",
    name: "البوكس الأخضر",
    subtitle: "طاقة أحلى لبقية يومك",
    description: "أرز، حمص، خضار موسمية وسلطة",
    price: 800,
    category: "صحي / نباتي",
    image: "photo-1512621776951-a57141f2eefd",
    restaurant: "جرين بوكس",
    allergens: "قد يحتوي سمسماً؛ تحقق من التلوث المتبادل",
    color: "green",
  },
];
const names = [
  "أحمد محمد",
  "محمد العريقي",
  "خالد عبدالله",
  "عبدالرحمن علي",
  "عمر الحداد",
  "علي الصبري",
  "حسن القاضي",
  "يوسف أحمد",
  "إبراهيم صالح",
  "مازن سعيد",
  "وليد ناصر",
  "سامي محمد",
  "أنس علي",
  "فؤاد سالم",
  "أمين حسن",
  "بسام يحيى",
  "مروان عادل",
  "صالح عمر",
  "نبيل أحمد",
  "عادل قاسم",
  "طارق سعيد",
  "رامي ناصر",
  "يحيى صالح",
  "عبدالله خالد",
  "أسامة علي",
  "هشام محمد",
  "هيثم أحمد",
  "زياد حسن",
  "سليم عبده",
  "أكرم علي",
  "حاتم سالم",
  "نزار يحيى",
];
export const EMPLOYEES = names.map((name, i) => ({
  id: `e${i + 1}`,
  name,
  department: ["التقنية والتطوير", "الموارد البشرية", "المالية", "التسويق"][
    i % 4
  ],
}));
export function dayKey(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}
export function cutoff(day, kind) {
  return Date.parse(
    `${day}T${kind === "attendance" ? "11:00" : "11:15"}:00+03:00`,
  );
}
export function previousDay(day, n = 1) {
  return new Date(Date.parse(`${day}T12:00:00Z`) - n * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function blankDay() {
  return { attendance: {}, votes: {}, result: null };
}
export function seedDay(day) {
  const record = blankDay();
  EMPLOYEES.slice(0, 24).forEach((p, i) => {
    record.attendance[p.id] = {
      at: Date.parse(`${day}T10:${String(5 + i).padStart(2, "0")}:00+03:00`),
      method: "demo",
    };
    record.votes[p.id] = {
      mealId: i < 12 ? "mandi" : i < 19 ? "shawarma" : "green",
      weight: 1,
    };
  });
  return record;
}
export function seedHistory(day) {
  return [3, 2, 1].map((n) => ({
    day: previousDay(day, n),
    winner: "mandi",
    votes: { [EMPLOYEE_ID]: { mealId: "green", weight: 1 } },
    demo: true,
  }));
}
// A missed day, a non-vote, or a winning choice ends the consecutive loss streak.
export function lossStreak(history, employeeId, day) {
  let losses = 0;
  for (let n = 1; n <= 3; n++) {
    const result = history.find((r) => r.day === previousDay(day, n));
    const vote = result?.votes?.[employeeId];
    if (!result?.winner || !vote || vote.mealId === result.winner) break;
    losses++;
  }
  return losses;
}
export function voteWeight(history, id, day) {
  return lossStreak(history, id, day) >= 3 ? 2 : 1;
}
export function tally(record) {
  return MEALS.map((meal) => ({
    ...meal,
    points: Object.values(record.votes)
      .filter((v) => v.mealId === meal.id)
      .reduce((n, v) => n + v.weight, 0),
    voters: Object.values(record.votes).filter((v) => v.mealId === meal.id)
      .length,
  }));
}
export function pickWinner(record) {
  const sorted = tally(record).sort(
    (a, b) =>
      b.points - a.points || a.price - b.price || a.id.localeCompare(b.id),
  );
  return sorted[0].points ? sorted[0] : null;
}
export function isClosed(now, day, kind) {
  return now >= cutoff(day, kind);
}
export function selfAttend(
  record,
  { id, now, day, verifiedAt, method, acknowledged },
) {
  if (id !== EMPLOYEE_ID) throw Error("لا يمكنك تسجيل حضور شخص آخر.");
  if (dayKey(now) !== day || isClosed(now, day, "attendance"))
    throw Error("انتهى وقت تسجيل الحضور.");
  if (record.attendance[id]) throw Error("حضورك مسجل بالفعل.");
  if (!acknowledged) throw Error("أكّد إقرار الحضور أولاً.");
  if (
    !["demo", "gps"].includes(method) ||
    !Number.isFinite(verifiedAt) ||
    now - verifiedAt > 60000 ||
    now < verifiedAt
  )
    throw Error("تحقق من موقعك مجدداً قبل التسجيل.");
  return {
    ...record,
    attendance: { ...record.attendance, [id]: { at: now, method } },
  };
}
export function castVote(record, { id, mealId, now, day, history }) {
  if (id !== EMPLOYEE_ID) throw Error("التصويت لحسابك فقط.");
  if (dayKey(now) !== day || isClosed(now, day, "voting") || record.result)
    throw Error("أُغلق التصويت واعتمدت النتيجة.");
  if (!record.attendance[id])
    throw Error("سجّل حضورك أولاً للمشاركة في التصويت.");
  if (!MEALS.some((m) => m.id === mealId && m.price <= BUDGET))
    throw Error("هذه الوجبة غير متاحة ضمن الميزانية.");
  return {
    ...record,
    votes: {
      ...record.votes,
      [id]: { mealId, weight: voteWeight(history, id, day) },
    },
  };
}
export function finalize(record, now, day) {
  if (!isClosed(now, day, "voting") || record.result) return record;
  const winner = pickWinner(record);
  return {
    ...record,
    result: {
      winner: winner?.id ?? null,
      at: cutoff(day, "voting"),
      count: Object.keys(record.attendance).length,
      points: winner?.points ?? 0,
    },
  };
}
export function distanceMeters(a, b) {
  const rad = (n) => (n * Math.PI) / 180;
  const x =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) *
      Math.cos(rad(b.lat)) *
      Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export function withinOffice(position, office, now) {
  const coords = position?.coords;
  if (
    !coords ||
    !Number.isFinite(coords.latitude) ||
    !Number.isFinite(coords.longitude) ||
    !Number.isFinite(coords.accuracy) ||
    coords.accuracy < 0
  )
    return { ok: false, reason: "تعذر قراءة إحداثيات دقيقة." };
  if (
    !office ||
    !Number.isFinite(office.lat) ||
    !Number.isFinite(office.lon) ||
    !Number.isFinite(office.radius) ||
    office.radius < 25
  )
    return { ok: false, reason: "لم يتم إعداد نطاق الشركة." };
  if (
    !Number.isFinite(position.timestamp) ||
    now - position.timestamp > 60000 ||
    position.timestamp > now + 5000
  )
    return { ok: false, reason: "قراءة الموقع قديمة. أعد المحاولة." };
  const distance = distanceMeters(
    { lat: coords.latitude, lon: coords.longitude },
    office,
  );
  return {
    ok: distance + coords.accuracy <= office.radius,
    distance,
    reason:
      distance + coords.accuracy <= office.radius
        ? "داخل النطاق المحدد"
        : "خارج النطاق أو دقة الموقع غير كافية.",
  };
}
export function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}
export function attendanceCSV(record, day, now) {
  const rows = [
    ["اليوم", "الموظف", "القسم", "الحالة", "وقت التأكيد", "طريقة التحقق"],
  ];
  for (const p of EMPLOYEES) {
    const a = record.attendance[p.id];
    rows.push([
      day,
      p.name,
      p.department,
      a
        ? "حضور ذاتي"
        : isClosed(now, day, "attendance")
          ? "غائب عن الغداء"
          : "بانتظار التأكيد",
      a ? new Date(a.at).toLocaleTimeString("en-GB", { timeZone: ZONE }) : "",
      a?.method === "demo"
        ? "محاكاة"
        : a?.method === "gps"
          ? "GPS (تحقق متصفح)"
          : "",
    ]);
  }
  return "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
