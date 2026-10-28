import React, { useCallback, useEffect, useState } from "react";
import {
  Utensils,
  ArrowUpLeft,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Users,
  Wallet,
  Settings,
  Fingerprint,
  Download,
  Search,
  Plus,
  Copy,
  Link,
  CalendarDays,
  FileCheck2,
  Activity,
  Info,
  RefreshCw,
  Lock,
  MapPin,
} from "lucide-react";
import { api, downloadCSV } from "./api.js";
import { Modal } from "./Portal.jsx";
import { mealImage as image } from "./mealImage.js";
const fmt = (n) => new Intl.NumberFormat("ar-YE").format(n),
  zone = "Asia/Aden";
const dateText = (t) =>
  new Date(t).toLocaleDateString("ar-YE", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
const timeText = (t) =>
  new Date(t).toLocaleTimeString("ar-YE", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
  });
const remaining = (now, target) => {
  const n = Math.max(0, Math.ceil((target - now) / 1000));
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
};
const titles = {
  dashboard: "نظرة عامة",
  employees: "الفريق والدعوات",
  meals: "الوجبات والموردون",
  attendance: "الحضور والتقارير",
  settings: "إعدادات الشركة",
};
function Avatar({ name }) {
  return (
    <span className="avatar">
      {name
        ?.split(" ")
        .slice(0, 2)
        .map((s) => s[0])
        .join(" ")}
    </span>
  );
}
function eventText(event) {
  return (
    {
      "day.published": "اعتماد خيارات اليوم",
      "day.finalized": "إغلاق التصويت واعتماد النتيجة",
      "attendance.self_confirmed": "تأكيد حضور ذاتي",
      "vote.saved": "حفظ اختيار الوجبة",
    }[event] || event
  );
}
function Empty({ icon: Icon, title, text }) {
  return (
    <div className="admin-empty">
      <Icon size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function MealPhoto({ meal, className }) {
  const src = image(meal), [failed,setFailed] = useState(false);
  useEffect(()=>setFailed(false),[src]);
  return src && !failed ? <img className={className} src={src} alt={meal.name || 'طبق الأرز — سُفرة'} loading="lazy" onError={()=>setFailed(true)}/> : <span className="admin-image-placeholder"><Utensils size={28}/><small>صورة الوجبة</small></span>;
}
function Stat({ icon: Icon, label, value, unit, note, accent, mono }) {
  return (
    <section className={`stat ${accent ? "accent" : ""}`}>
      <div className="stat-top">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <div className={`stat-value ${mono ? "mono" : ""}`}>
        <strong dir={mono ? "ltr" : undefined}>{value}</strong>
        <small>{unit}</small>
      </div>
      <div className="stat-note">
        <span className="dot" />
        {note}
      </div>
    </section>
  );
}
export default function AdminArea({
  page,
  today: d,
  now,
  busy,
  offline,
  run,
  refresh,
  navigate,
  notify,
  downloadOrder,
}) {
  const [employees, setEmployees] = useState([]),
    [meals, setMeals] = useState([]),
    [settings, setSettings] = useState(null),
    [report, setReport] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [invite, setInvite] = useState(""),
    [edit, setEdit] = useState(null),
    [adding, setAdding] = useState(false),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [reportDate, setReportDate] = useState(d.day);
  const reload = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      if (page === "employees") setEmployees(await api("/admin/employees"));
      if (page === "meals") setMeals(await api("/admin/meals"));
      if (page === "settings") setSettings(await api("/admin/settings"));
      if (page === "attendance" || page === "dashboard")
        setReport(await api("/admin/report?day=" + reportDate));
    } catch (e) {
      setReport(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, reportDate]);
  useEffect(() => {
    reload();
    if (["attendance", "dashboard"].includes(page)) {
      const id = setInterval(reload, 10000);
      return () => clearInterval(id);
    }
  }, [reload]);
  useEffect(()=>{setQuery('');setStatus('all');},[page]);
  const winner = d.meals.find((m) => m.meal_id === d.winnerId),
    closed = now >= d.attendanceDeadline,
    votingClosed = now >= d.voteDeadline;
  const points = d.meals.reduce((n,m)=>n+m.points,0);
  const voters = d.meals.reduce((n,m)=>n+m.voters,0);
  const stage = !d.published ? (closed ? 'انتهى موعد الاعتماد' : 'بانتظار اعتماد القائمة') : !closed ? 'تسجيل المشاركة مفتوح' : !votingClosed ? 'التصويت مستمر' : winner ? 'اكتمل اختيار اليوم' : 'انتهى اليوم دون نتيجة';
  const descriptions = {dashboard:'تابع مشاركات الفريق، وقائمة الغداء، ومواعيد اليوم من مكان واحد.',employees:'إدارة حسابات الفريق ودعوات التفعيل وصلاحية المشاركة.',meals:'أضف الوجبات والموردين، وحدد الكميات واعتمد قائمة اليوم.',attendance:'راجع تأكيدات الموظفين واستخرج سجل المشاركة حسب اليوم.',settings:'اضبط بيانات الشركة وطريقة تأكيد المشاركة والتشغيل اليومي.'};
  const publish = () =>
    run("publish", async () => {
      await api("/admin/day/publish", {
        method: "POST",
        body: { confirmed: true },
      });
      await refresh();
      await reload();
      notify("اعتمدت خيارات اليوم وفتحت بوابة الموظفين.");
    });
  const download = () =>
    run("export", async () => {
      await downloadCSV(reportDate);
      notify("تم تنزيل سجل الحالات من قاعدة البيانات.");
    });
  return (
    <>
      <div className="heading">
        <div>
          <div className="eyebrow">
            {d.company} / مساحة الإدارة
          </div>
          <h1>
            {titles[page] || titles.dashboard}
          </h1>
          <p>
            {descriptions[page] || descriptions.dashboard}
          </p>
        </div>
        <div className="heading-actions">
          <span className="date">
            <CalendarDays size={15} />
            {dateText(now)}
          </span>
          <button
            className="outline"
            disabled={!!busy}
            onClick={() =>
              run("refresh", async () => {
                await refresh();
                await reload();
              })
            }
          >
            <RefreshCw size={14} /> تحديث
          </button>
        </div>
      </div>
      {error && (
        <div className="warning" role="alert">
          {error} <button onClick={reload}>إعادة المحاولة</button>
        </div>
      )}
      {page === "dashboard" && (
        <>
          <div className="stats">
            <Stat
              icon={Users}
              label="المشاركون المؤكدون"
              value={fmt(d.count)}
              unit="موظف"
              note={d.published ? `من ${fmt(d.employeeCount)} موظفاً في قائمة اليوم` : `من ${fmt(d.employeeCount)} حساب موظف نشط`}
              accent
            />
            <Stat
              icon={Fingerprint}
              label={closed ? "لم يؤكدوا المشاركة" : "بانتظار التأكيد"}
              value={fmt(Math.max(0,d.employeeCount-d.count))}
              unit="موظف"
              note={closed ? 'خارج عدد طلب اليوم' : 'التأكيد من حساب الموظف'}
            />
            <Stat
              icon={Clock}
              label={closed ? "أُغلق تسجيل الحضور" : "متبقي لإغلاق الحضور"}
              value={remaining(now, d.attendanceDeadline)}
              note="بوقت الخادم · ١١:٠٠"
              mono
            />
            <Stat
              icon={Utensils}
              label="المشاركون في التصويت"
              value={fmt(voters)}
              unit="مصوّت"
              note={
                votingClosed
                  ? "انتهى التصويت الساعة ١١:١٥"
                  : "اختيار واحد لكل مشارك"
              }
              accent
            />
          </div>
          <div className="dashboard-feature">
            <section className="command-card">
              <div className="command-copy">
                <span className="pill lime">
                  <span className="dot"/> {stage}
                </span>
                <h2>
                  {winner ? 'وجبة اليوم جاهزة للمراجعة.' : !d.published ? 'ابدأ بقائمة غداء اليوم.' : closed ? 'تابع نتيجة اختيار الفريق.' : 'مشاركات اليوم، في مكان واحد.'}
                </h2>
                <p>
                  {winner ? `اختار الفريق ${winner.name}. راجع عدد المشاركين والكمية المحددة قبل التواصل مع المورد.` : !d.published ? 'راجع الوجبات والكميات وتوفر الموردين، ثم اعتمد القائمة لتظهر لدى الموظفين.' : `${fmt(d.count)} من أصل ${fmt(d.employeeCount)} موظفاً أكدوا مشاركتهم. يمكنك مراجعة السجل ومتابعة اختيارات الوجبات أدناه.`}
                </p>
                <button
                  className="primary"
                  onClick={() =>
                    navigate(
                      "/admin/" + (!d.published ? "meals" : "attendance"),
                    )
                  }
                >
                  {!d.published ? "إدارة قائمة الوجبات" : "متابعة سجل الحضور"}
                  <ArrowUpLeft size={17} />
                </button>
                <span className="command-caption">
                  <ShieldCheck size={13} /> المشاركة يؤكدها الموظف من حسابه
                </span>
              </div>
              <div className="admin-hero-photo"><div className="admin-food-ring"/><div className="admin-food-plate"><MealPhoto meal={{image:'photo-1512058564366-18510be2db19'}}/></div><span>سُفرة <small>استراحة تجمع الفريق</small></span></div>
            </section>
            <section className="timeline-card">
              <div className="card-label">
                <Activity size={16} /> مسار اليوم{" "}
                <span className="pill muted">اليمن</span>
              </div>
              <h3>مواعيد غداء اليوم</h3>
              <div className="timeline">
                {[
                  [
                    "١١:٠٠",
                    "إغلاق الحضور",
                    closed ? "العدد مغلق للتسجيل" : "إقرار شخصي من كل مشارك",
                    closed,
                  ],
                  [
                    "١١:١٥",
                    "اعتماد الوجبة",
                    winner
                      ? winner.name
                      : votingClosed
                        ? "لا نتيجة تصويت"
                        : "اختيار أعلى النقاط",
                    votingClosed,
                  ],
                  [
                    "بعد الاعتماد",
                    "ملخص المطعم",
                    "تنزيل ومراجعة قبل إرساله",
                    !!winner,
                  ],
                ].map(([time, title, desc, done], i) => (
                  <div
                    className={`timeline-item ${done ? "done" : ""}`}
                    key={title}
                  >
                    <span className="timeline-marker">
                      {done ? <Check size={13} /> : i + 1}
                    </span>
                    <div>
                      <div>
                        <strong>{title}</strong>
                        <time>{time}</time>
                      </div>
                      <p>{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="timeline-foot">
                <Clock size={13} /> المواعيد بتوقيت اليمن
              </div>
            </section>
          </div>
          {!d.published && (
            <div className="admin-callout">
              <Info size={23} />
              <div>
                <strong>لم تُعتمد وجبات اليوم بعد</strong>
                <p>{closed ? 'فات موعد اعتماد اليوم. جهّز الوجبات لليوم القادم.' : 'اعتمد الوجبات قبل ١١:٠٠ لفتح تأكيد المشاركة أمام الفريق.'}</p>
              </div>
              <button
                className="outline"
                onClick={() => navigate("/admin/meals")}
              >
                إدارة الوجبات <ArrowLeft size={14} />
              </button>
            </div>
          )}
          {winner && (
            <section className="result-banner">
              <div className="result-icon">
                <FileCheck2 size={27} />
              </div>
              <div>
                <span className="micro-label">نتيجة اليوم</span>
                <h2>{winner.name}</h2>
                <p>
                  {fmt(d.count)} مشارك مؤكد · الكمية المحددة: {fmt(winner.quantity)} وجبة
                </p>
              </div>
              <button
                className="primary"
                disabled={!!busy || !d.count}
                onClick={downloadOrder}
              >
                تحميل ملخص المطعم <Download size={16} />
              </button>
            </section>
          )}
          <div className="section-heading">
            <div>
              <span className="micro-label">قائمة اليوم</span>
              <h2>اختيارات الفريق</h2>
              <p>{fmt(d.meals.length)} وجبات · {fmt(voters)} مشاركاً في التصويت</p>
            </div>
            <span className="pill lime">
              {d.published
                ? votingClosed
                  ? "النتيجة نهائية"
                  : "خيارات اليوم"
                : "بانتظار الاعتماد"}
            </span>
          </div>
          <div className="admin-meal-results">
            {d.meals.map((m) => {
              const pct = points ? Math.round(m.points/points*100) : 0;
              return <article className={`admin-choice-card ${m.meal_id===d.winnerId ? 'is-winner' : ''}`} key={m.meal_id}>
                <div className="admin-choice-photo"><MealPhoto meal={m}/>{m.meal_id===d.winnerId && <span className="admin-winner-label"><CheckCircle2 size={14}/> اختيار الفريق</span>}</div>
                <div className="admin-choice-body"><span className="admin-choice-supplier"><Utensils size={13}/>{m.restaurant}</span><h3>{m.name}</h3>
                  <div className="admin-choice-numbers"><span>{fmt(m.voters)} مصوّت · {fmt(m.points)} نقطة</span><b>{fmt(pct)}٪</b></div>
                  <div className="admin-choice-progress" role="progressbar" aria-label={`نسبة نقاط ${m.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{width:pct+'%'}}/></div>
                  <div className="admin-choice-quantity"><span>الكمية المحددة</span><strong>{fmt(m.quantity)} <small>وجبة</small></strong></div>
                </div>
              </article>;
            })}
            {!d.meals.length && (
              <Empty
                icon={Utensils}
                title="بانتظار وجبات اليوم"
                text="الخيارات التي تعتمدها ستظهر هنا ولدى الموظفين."
              />
            )}
          </div>
          <div className="admin-lower-grid">
            <section className="panel">
              <div className="admin-panel-heading"><h3>إدارة سريعة</h3><Settings size={17}/></div>
              <div className="setup-step">
                <Users size={19} />
                <div>
                  <strong>الفريق والدعوات</strong>
                  <p>أنشئ الحساب، والموظف يختار كلمة مروره من رابط التفعيل.</p>
                </div>
                <button aria-label="إدارة الفريق والدعوات" onClick={() => navigate("/admin/employees")}>
                  <ArrowUpLeft size={18} />
                </button>
              </div>
              <div className="setup-step">
                <MapPin size={19} />
                <div>
                  <strong>تأكيد المشاركة</strong>
                  <p>
                    {d.verification.mode === 'self' ? 'تأكيد ذاتي بضغطة زر من حساب الموظف.' : d.verification.configured
                      ? "التحقق مضبوط. اختبره من أجهزة الشركة."
                      : "إعداد الموقع أو الشبكة مطلوب قبل تسجيل الحضور."}
                  </p>
                </div>
                <button aria-label="إعدادات تأكيد المشاركة" onClick={() => navigate("/admin/settings")}>
                  <ArrowUpLeft size={18} />
                </button>
              </div>
            </section>
            <section className="panel">
              <div className="admin-panel-heading"><h3>آخر أحداث اليوم</h3><span className="admin-updating">{loading ? 'جارٍ التحديث' : 'آخر ٤ أحداث'}</span></div>
              {report?.audit.slice(0, 4).map((a) => (
                <div className="audit-row" key={a.id}>
                  <span className="dot" />
                  <div>
                    <strong>{eventText(a.event)}</strong>
                    <small>
                      {a.actor || "النظام"} · {timeText(a.at)}
                    </small>
                  </div>
                </div>
              ))}
              {!report?.audit.length && (
                <p>سيظهر اعتماد الخيارات وتأكيد الحضور والتصويت هنا.</p>
              )}
            </section>
          </div>
        </>
      )}
      {page === "employees" && (
        <>
          <div className="admin-summary-strip"><div><Users size={20}/><span>إجمالي الحسابات<strong>{fmt(employees.length)}</strong></span></div><div><CheckCircle2 size={20}/><span>حسابات مفعّلة<strong>{fmt(employees.filter(u=>u.active && u.activated).length)}</strong></span></div><div><Link size={20}/><span>بانتظار التفعيل<strong>{fmt(employees.filter(u=>u.active && !u.activated).length)}</strong></span></div></div>
          <div className="admin-toolbar">
            <label className="search">
              <Search size={15} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="اسم الموظف أو حسابه"
                aria-label="البحث عن موظف"
              />
            </label>
            <button className="primary" onClick={() => setAdding(true)}>
              <Plus size={16} /> إضافة موظف
            </button>
          </div>
          <section className="attendance-table">
            <div className="admin-table-heading"><h2>دليل الفريق</h2><span>{fmt(employees.filter(u=>(u.name+' '+u.username).includes(query)).length)} حساب</span></div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الموظف</th>
                    <th>اسم الدخول</th>
                    <th>القسم</th>
                    <th>الحساب</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {employees
                    .filter((u) => (u.name + " " + u.username).includes(query))
                    .map((u) => (
                      <tr key={u.id}>
                        <td>
                          <Avatar name={u.name} />
                          <strong>{u.name}</strong>
                        </td>
                        <td dir="ltr">{u.username}</td>
                        <td>{u.department || "الإدارة"}</td>
                        <td>
                          <span className={`pill ${u.active ? "lime" : "red"}`}>
                            {u.role === "admin"
                              ? "مشرف"
                              : !u.active
                                ? "معطل"
                                : u.activated
                                  ? "مفعّل"
                                  : "بانتظار التفعيل"}
                          </span>
                        </td>
                        <td>
                          {u.role === "employee" && (
                            <div className="row-actions">
                              <button
                                disabled={!!busy || !u.active}
                                onClick={() =>
                                  run("invite", async () => {
                                    const r = await api(
                                      "/admin/employees/" + u.id + "/invite",
                                      { method: "POST", body: {} },
                                    );
                                    setInvite(r.invite);
                                  })
                                }
                              >
                                <Link size={13} /> دعوة تفعيل
                              </button>
                              <button
                                disabled={!!busy}
                                onClick={() =>
                                  run("toggle", async () => {
                                    await api("/admin/employees/" + u.id, {
                                      method: "PATCH",
                                      body: { active: !u.active },
                                    });
                                    await reload();
                                    notify(
                                      u.active
                                        ? "عُطّل الحساب وأُنهيت جلساته."
                                        : "فُعّل الحساب. أصدر دعوة جديدة عند الحاجة.",
                                    );
                                  })
                                }
                              >
                                {u.active ? "تعطيل الحساب" : "تفعيل الحساب"}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {loading && <div className="empty">تحميل الفريق…</div>}
            {!loading && !employees.length && (
              <Empty
                icon={Users}
                title="ابدأ بأول موظف"
                text="أنشئ حسابه وأعطه رابط التفعيل بشكل خاص."
              />
            )}
            {!loading && !!employees.length && !employees.some(u=>(u.name+' '+u.username).includes(query)) && <Empty icon={Search} title="لا توجد نتائج مطابقة" text="جرّب اسم الموظف أو اسم حساب آخر."/>}
          </section>
          <div className="admin-info">
            <ShieldCheck size={17} /> لا توجد كلمة مرور افتراضية. الدعوات سرية،
            صالحة ٤٨ ساعة ولمرة واحدة، ولا تُرسل تلقائياً.
          </div>
        </>
      )}
      {page === "meals" && (
        <>
          <div className="admin-callout">
            <Utensils size={23} />
            <div>
              <strong>
                {d.published
                  ? "خيارات اليوم معتمدة ومثبتة"
                  : "اعتمد وجبات اليوم قبل ١١:٠٠"}
              </strong>
              <p>
                {d.published
                  ? "تعديلات قائمة الموردين تسري على الأيام القادمة، ولا تغيّر طلب اليوم."
                  : "أضف وجباتك وحدد الكمية والمورد، وأكّد التوفر قبل النشر."}
              </p>
            </div>
            <button
              className="primary"
              disabled={!!busy || offline || d.published || closed}
              onClick={publish}
            >
              {d.published ? (
                <>
                  <Check size={15} /> معتمدة اليوم
                </>
              ) : closed ? (
                "فات موعد اعتماد اليوم"
              ) : (
                "اعتماد خيارات اليوم"
              )}
            </button>
          </div>
          <div className="admin-toolbar">
            <label className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث عن وجبة أو مورد" aria-label="البحث في قائمة الوجبات"/></label>
            <span>{fmt(meals.length)} وجبة في القائمة</span>
            <button className="primary" onClick={() => setEdit({name:"",description:"",restaurant:"",allergens:"",image:"",quantity:30,enabled:1,confirmed:0})}><Plus size={16}/>إضافة وجبة ومورد</button>
          </div>
          {loading && <p className="admin-info" role="status">جارٍ تحميل قائمة الوجبات…</p>}
          {!loading && !meals.length && <Empty icon={Utensils} title="أضف أول وجبة" text="حدّد الاسم والمورد والكمية، ثم أكّد توفرها لإدراجها ضمن خيارات اليوم."/>}
          {!loading && !!meals.length && !meals.some(m=>(m.name+' '+m.restaurant).includes(query)) && <Empty icon={Search} title="لا توجد نتائج مطابقة" text="جرّب اسم وجبة أو مورد آخر."/>}
          <div className="meal-grid">
            {meals.filter(m=>(m.name+' '+m.restaurant).includes(query)).map((m) => (
              <article className="meal-card" key={m.id}>
                <div className="meal-photo">
                  <MealPhoto meal={m}/>
                  <span className="meal-category">
                    {m.confirmed ? "المورد مؤكد" : "تحتاج مراجعة المورد"}
                  </span>
                </div>
                <div className="meal-info">
                  <div className="meal-title">
                    <h3>{m.name}</h3>
                    <span>
                      <b>{fmt(m.quantity)}</b> وجبة
                    </span>
                  </div>
                  <p>{m.description}</p>
                  <div className="admin-meal-meta">
                    <span>{m.restaurant}</span>
                    <span className={`pill ${m.confirmed ? "lime" : "muted"}`}>
                      {m.enabled ? "ضمن القائمة" : "مستبعدة"}
                    </span>
                  </div>
                  <div className="admin-meal-actions"><button className="outline full" onClick={() => setEdit(m)}>
                    <Settings size={14} /> تعديل الوجبة والمورد
                  </button>
                  <button className="admin-delete-meal" disabled={!!busy} onClick={() => {
                    if (window.confirm(`حذف «${m.name}» من القائمة؟ سيبقى سجل الأيام المعتمدة محفوظاً.`))
                      run("delete-meal", async () => { await api("/admin/meals/" + m.id, {method:"DELETE"}); await reload(); notify("حُذفت الوجبة من القائمة."); });
                  }}>حذف</button></div>
                </div>
              </article>
            ))}
          </div>
          <div className="admin-info">
            <Lock size={16} /> يمكنك إضافة أي عدد من الوجبات. تنشر الوجبات المفعلة والمؤكدة فقط، مع تثبيت كمياتها لليوم.
            الصور توضيحية. الاعتماد اليومي التلقائي متاح من الإعدادات.
          </div>
        </>
      )}
      {page === "attendance" && (
        <>
          <div className="admin-toolbar">
            <label className="report-date">
              اليوم
              <input
                aria-label="تاريخ التقرير"
                type="date"
                value={reportDate}
                max={d.day}
                onChange={(e) => {
                  if (e.target.value) setReportDate(e.target.value);
                }}
              />
            </label>
            <button
              className="outline"
              disabled={!!busy || !report}
              onClick={download}
            >
              <Download size={15} /> تنزيل CSV
            </button>
          </div>
          <div className="attendance-summary">
            <div>
              <ShieldCheck size={25} />
              <span>
                <strong>سجل المشاركة اليومي</strong>
                <small>
                  لا يوجد تسجيل حضور أو تعديل له من حساب المشرف. الغياب لا يدخل
                  في العدد.
                </small>
              </span>
            </div>
            <span className="pill muted">
              <Lock size={13} /> قراءة فقط
            </span>
          </div>
          {report && (
            <>
              <div className="table-toolbar">
                <div className="tabs">
                  {[
                    ["all", "الجميع"],
                    ["present", "حضور ذاتي"],
                    ["absent", "غائبون"],
                    ["pending", "بانتظار التأكيد"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={status === id ? "active" : ""}
                      onClick={() => setStatus(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Search size={14} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ابحث عن موظف"
                    aria-label="البحث في الحضور"
                  />
                </label>
              </div>
              <section className="attendance-table">
                <div className="admin-table-heading"><h2>مشاركات {reportDate === d.day ? 'اليوم' : reportDate}</h2><span>{fmt(report.count)} تأكيد مسجّل</span></div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>الموظف</th>
                        <th>القسم</th>
                        <th>الحالة</th>
                        <th>وقت التأكيد</th>
                        <th>التحقق</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.people
                        .filter(
                          (p) =>
                            p.name.includes(query) &&
                            (status === "all" || p.status === status),
                        )
                        .map((p) => (
                          <tr key={p.id}>
                            <td>
                              <Avatar name={p.name} />
                              <strong>{p.name}</strong>
                            </td>
                            <td>{p.department}</td>
                            <td>
                              <span
                                className={`pill ${p.status === "present" ? "lime" : p.status === "absent" ? "red" : "muted"}`}
                              >
                                {p.status === "present"
                                  ? "حضور ذاتي"
                                  : p.status === "absent"
                                    ? "غائب عن الغداء"
                                    : "بانتظار التأكيد"}
                              </span>
                            </td>
                            <td>{p.at ? timeText(p.at) : "—"}</td>
                            <td>
                              {p.method === 'self' ? 'تأكيد ذاتي' : p.method === "gps"
                                ? "GPS"
                                : p.method === "network"
                                  ? "شبكة الشركة"
                                  : "—"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!report.people.length && (
                  <Empty
                    icon={Users}
                    title="لا موظفين لهذا اليوم"
                    text="أضف الفريق قبل اعتماد خيارات الغداء."
                  />
                )}
                {!!report.people.length && !report.people.some(p=>p.name.includes(query) && (status==='all'||p.status===status)) && <Empty icon={Search} title="لا توجد نتائج مطابقة" text="غيّر حالة الحضور أو كلمة البحث لعرض المشاركات."/>}
              </section>
              <div className="financial-strip">
                <Wallet size={25} />
                <div>
                  <span>العدد المؤكد</span>
                  <strong>
                    {fmt(report.count)} <small>موظف</small>
                  </strong>
                </div>
                <div>
                  <span>سقف الميزانية</span>
                  <strong>
                    {fmt(report.count * report.record.budget)}{" "}
                    <small>ريال يمني</small>
                  </strong>
                </div>
                {reportDate === d.day && (
                  <button
                    className="primary"
                    disabled={!!busy || !winner || !d.finalized || !d.count}
                    onClick={downloadOrder}
                  >
                    <Download size={15} /> ملخص المطعم
                  </button>
                )}
              </div>
              <section className="panel audit-panel">
                <h3>سجل أحداث اليوم</h3>
                {report.audit.map((a) => (
                  <div className="audit-row" key={a.id}>
                    <span className="dot" />
                    <div>
                      <strong>{eventText(a.event)}</strong>
                      <small>
                        {a.actor || "النظام"} · {timeText(a.at)}
                      </small>
                    </div>
                    <code>#{a.id}</code>
                  </div>
                ))}
                {!report.audit.length && <p>لا أحداث بعد.</p>}
              </section>
            </>
          )}
        </>
      )}
      {page === "settings" && settings && (
        <SettingsForm
          key={settings.policyVersion}
          initial={settings}
          busy={busy}
          onSave={(b) =>
            run("settings", async () => {
              await api("/admin/settings", { method: "PUT", body: b });
              await refresh();
              await reload();
              notify("حُفظت الإعدادات وأُبطلت إثباتات الموقع السابقة.");
            })
          }
        />
      )}
      {adding && (
        <Modal title="إضافة موظف جديد" onClose={() => setAdding(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const body = Object.fromEntries(new FormData(e.currentTarget));
              run("addEmployee", async () => {
                const r = await api("/admin/employees", {
                  method: "POST",
                  body,
                });
                setAdding(false);
                setInvite(r.invite);
                await reload();
                await refresh();
              });
            }}
          >
            <p>
              أنشئ الحساب وشارك رابط التفعيل بشكل خاص. الموظف يختار كلمة مروره
              بنفسه.
            </p>
            <label>
              الاسم الكامل
              <input name="name" minLength={2} maxLength={100} required />
            </label>
            <label>
              اسم المستخدم بالإنجليزية
              <input
                name="username"
                dir="ltr"
                pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,63}"
                required
              />
            </label>
            <label>
              القسم
              <input name="department" maxLength={100} />
            </label>
            <button className="primary full" disabled={!!busy}>
              إنشاء الحساب وإصدار الدعوة <Plus size={15} />
            </button>
          </form>
        </Modal>
      )}
      {invite && (
        <Modal title="رابط التفعيل جاهز" onClose={() => setInvite("")}>
          <p>
            رابط خاص صالح ٤٨ ساعة ولمرة واحدة. إصدار رابط جديد يبطل السابق. كلمة
            المرور لا تتغير إلا بعد تفعيل الدعوة.
          </p>
          <label>
            رابط الدعوة
            <input
              readOnly
              dir="ltr"
              value={invite}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            className="primary full"
            onClick={() =>
              run("copy", async () => {
                if (!navigator.clipboard)
                  throw Error(
                    "النسخ التلقائي يحتاج HTTPS؛ حدد الرابط وانسخه يدوياً.",
                  );
                await navigator.clipboard.writeText(invite);
                notify("نُسخ رابط الدعوة.");
              })
            }
          >
            <Copy size={16} /> نسخ الرابط
          </button>
          <div className="modal-note">
            لم يُرسل بريد أو رسالة. بعد إغلاق النافذة لا يُعرض سر الرابط مجدداً.
          </div>
        </Modal>
      )}
      {edit && (
        <Modal title={edit.id ? "تعديل الوجبة والمورد" : "إضافة وجبة ومورد"} onClose={() => setEdit(null)}>
          <MealForm
            meal={edit}
            busy={busy}
            onSave={(body) =>
              run("meal", async () => {
                await api("/admin/meals" + (edit.id ? "/" + edit.id : ""), { method: edit.id ? "PUT" : "POST", body });
                setEdit(null);
                await reload();
                notify("حُفظت الوجبة. خيارات اليوم المعتمدة لا تتغير.");
              })
            }
          />
        </Modal>
      )}
    </>
  );
}
function SettingsForm({ initial: s, busy, onSave }) {
  const [mode, setMode] = useState(s.verification),
    [gps, setGps] = useState(!!s.office);
  return (
    <form
      className="admin-settings panel"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({
          company: f.get("company"),
          budget: Number(f.get("budget")),
          office: gps
            ? {
                lat: Number(f.get("lat")),
                lon: Number(f.get("lon")),
                radius: Number(f.get("radius")),
              }
            : null,
          networks: String(f.get("networks") || "")
            .split(/\r?\n/)
            .map((v) => v.trim())
            .filter(Boolean),
          verification: mode,
          autoPublish: f.get("autoPublish") === "on",
        });
      }}
    >
      <h3>هوية الشركة والميزانية</h3>
      <div className="form-row">
        <label>
          اسم الشركة
          <input
            name="company"
            defaultValue={s.company}
            minLength={2}
            maxLength={100}
            required
          />
        </label>
        <label>
          سقف الفرد / ريال يمني
          <input
            name="budget"
            type="number"
            min={1}
            max={100000}
            defaultValue={s.budget}
            required
          />
        </label>
      </div>
      <div className="settings-divider" />
      <h3>كيف يتحقق الموظف من وجوده؟</h3>
      <p>التحقق على الخادم. المتصفح لا يقرأ اسم Wi-Fi، وGPS لا يمنع التزييف.</p>
      <label>
        وسيلة التحقق
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="self">تأكيد ذاتي من حساب الموظف</option>
          <option value="gps">GPS داخل نطاق الشركة</option>
          <option value="network">شبكة الشركة فقط</option>
          <option value="either">الشبكة أو GPS</option>
        </select>
      </label>
      {mode === 'self' && <div className="modal-note">يسجّل الموظف مشاركته بضغطة زر من حسابه. لا يتطلب موقعاً أو شبكة محددة، ولا يستخدم بصمة الجهاز. المواعيد ومنع التكرار يطبقهما الخادم.</div>}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={gps}
          onChange={(e) => setGps(e.target.checked)}
        />{" "}
        إعداد نطاق GPS للمبنى
      </label>
      {gps && (
        <div className="form-row three">
          <label>
            خط العرض
            <input
              type="number"
              step="any"
              name="lat"
              min="-90"
              max="90"
              defaultValue={s.office?.lat ?? ""}
              required
            />
          </label>
          <label>
            خط الطول
            <input
              type="number"
              step="any"
              name="lon"
              min="-180"
              max="180"
              defaultValue={s.office?.lon ?? ""}
              required
            />
          </label>
          <label>
            نصف القطر / متر
            <input
              type="number"
              name="radius"
              min="25"
              max="1000"
              defaultValue={s.office?.radius ?? 100}
              required
            />
          </label>
        </div>
      )}
      <label>
        شبكات الشركة المسموحة: عنوان أو CIDR في كل سطر
        <textarea
          name="networks"
          dir="ltr"
          rows={3}
          defaultValue={s.networks.join("\n")}
          placeholder="192.168.10.0/24"
        />
      </label>
      <div className="modal-note">
        الخادم يفحص اتصال الشبكة المباشر ولا يثق في IP من العميل أو ترويسات
        الوكيل. loopback غير مسموح. خلف وكيل عكسي يلزم إعداد شبكي موثوق قبل
        تفعيل هذه السياسة.
      </div>
      <div className="settings-divider" />
      <h3>اعتماد يومي تلقائي</h3>
      <label className="checkbox-label">
        <input
          name="autoPublish"
          type="checkbox"
          defaultChecked={s.autoPublish}
        />{" "}
        اعتماد الوجبات المفعلة والمؤكدة تلقائياً كل يوم قبل إغلاق الحضور
      </label>
      <p>
        فعّله بعد الاتفاق مع المورد على التوفر والأسعار اليومية. إيقاف تأكيد أي
        خيار يوقف النشر للأيام الجديدة. الميزانية الجديدة تطبق عند نشر يوم جديد.
      </p>
      <button className="primary" disabled={!!busy}>
        حفظ إعدادات الشركة <Check size={16} />
      </button>
    </form>
  );
}
function MealForm({ meal: m, busy, onSave }) {
  const [picture,setPicture] = useState(image(m) || ""), [uploading,setUploading] = useState(false), [imageError,setImageError] = useState("");
  async function upload(file) {
    if (!file) return;
    setImageError("");
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 4*1024*1024) {
      setImageError("اختر صورة JPG أو PNG أو WebP أو GIF بحجم لا يتجاوز 4 ميجابايت."); return;
    }
    setUploading(true);
    try {
      const data = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(reader.result.split(',')[1]); reader.onerror=()=>reject(Error("تعذرت قراءة الصورة.")); reader.readAsDataURL(file); });
      const result = await api('/admin/images',{method:'POST',body:{data}});
      setPicture(result.url);
    } catch(e) { setImageError(e.message); }
    finally { setUploading(false); }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({
          name: f.get("name"),
          description: f.get("description"),
          quantity: Number(f.get("quantity")),
          restaurant: f.get("restaurant"),
          allergens: f.get("allergens"),
          image: picture.trim(),
          enabled: f.get("enabled") === "on",
          confirmed: f.get("confirmed") === "on",
        });
      }}
    >
      <label>
        اسم الوجبة
        <input
          name="name"
          minLength={2}
          maxLength={100}
          defaultValue={m.name}
          required
        />
      </label>
      <label>
        المحتويات
        <textarea
          name="description"
          minLength={3}
          maxLength={500}
          defaultValue={m.description}
          required
        />
      </label>
      <div className="form-row">
        <label>
          الكمية المطلوبة من الوجبة
          <input
            name="quantity"
            type="number"
            min={1}
            max={100000}
            defaultValue={m.quantity ?? 30}
            required
          />
        </label>
        <label>
          المورد
          <input
            name="restaurant"
            minLength={2}
            maxLength={100}
            defaultValue={m.restaurant}
            required
          />
        </label>
      </div>
      <label>
        المكونات والحساسية
        <textarea name="allergens" maxLength={500} defaultValue={m.allergens} />
      </label>
      <label>
        رابط الصورة من الإنترنت (اختياري)
        <input
          name="image"
          dir="ltr"
          value={picture}
          onChange={e => {setPicture(e.target.value);setImageError("");}}
          placeholder="https://example.com/meal.jpg"
          disabled={uploading}
        />
      </label>
      <label>
        أو ارفع صورة من جهازك
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading || !!busy} onChange={e=>{upload(e.target.files[0]); e.target.value="";}} />
        <small>JPG، PNG، WebP، GIF · الحد الأقصى 4 ميجابايت. يفضّل رابط HTTPS.</small>
      </label>
      {uploading && <p role="status">جارٍ رفع الصورة…</p>}
      {imageError && <p role="alert">{imageError}</p>}
      {picture && <div><img key={picture} src={picture} alt="معاينة صورة الوجبة" referrerPolicy="no-referrer" style={{width:"100%",maxHeight:200,objectFit:"cover",borderRadius:12}} onError={()=>setImageError("تعذر عرض الصورة. تأكد أن الرابط مباشر ومتاح للجميع، أو ارفع الصورة من جهازك.")} /><button type="button" className="outline" disabled={uploading} onClick={()=>{setPicture("");setImageError("");}}>إزالة الصورة</button></div>}
      <label className="checkbox-label">
        <input type="checkbox" name="enabled" defaultChecked={!!m.enabled} />{" "}
        إدراجها في خيارات الغداء
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          name="confirmed"
          defaultChecked={!!m.confirmed}
        />{" "}
        تأكدت من الكمية والتوفر والمكونات مع المورد
      </label>
      <button className="primary full" disabled={!!busy || uploading}>
        حفظ الوجبة <Check size={16} />
      </button>
    </form>
  );
}
