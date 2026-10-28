import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Utensils,
  ArrowUpLeft,
  ArrowLeft,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  Clock,
  ShieldCheck,
  Users,
  Wallet,
  Scale,
  Settings,
  LayoutDashboard,
  Fingerprint,
  LogOut,
  Download,
  Search,
  Plus,
  X,
  Leaf,
  Flame,
  Zap,
  MapPin,
  Wifi,
  Lock,
  RefreshCw,
  Eye,
  EyeOff,
  Copy,
  Link,
  CalendarDays,
  FileCheck2,
  Activity,
  Menu,
  Info,
  LoaderCircle,
  KeyRound,
} from "lucide-react";
import { api, setCsrf, saveBlob, downloadCSV } from "./api.js";
import AdminArea from "./AdminArea.jsx";
import AuthScreen from "./AuthScreen.jsx";
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
const nav = [
  ["dashboard", "نظرة عامة", LayoutDashboard],
  ["employees", "الفريق والدعوات", Users],
  ["meals", "الوجبات والموردون", Utensils],
  ["attendance", "الحضور والتقارير", FileCheck2],
  ["settings", "إعدادات الشركة", Settings],
];
export function Brand({ onClick }) {
  return (
    <button
      className="brand"
      onClick={onClick}
      aria-label="سُفرة، الرئيسية"
    >
      <span className="brand-symbol">
        <Utensils size={25} />
        <i />
      </span>
      <span>
        <b>سُفرة</b>
        <small>SUFRA · غداء العمل</small>
      </span>
    </button>
  );
}
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
function Toast({ text, onClose }) {
  return (
    <div className="toast" role="status">
      <Info size={17} />
      {text}
      <button aria-label="إغلاق التنبيه" onClick={onClose}>
        <X size={15} />
      </button>
    </div>
  );
}
export function Modal({ title, children, onClose }) {
  const ref = useRef(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prior = document.activeElement;
    ref.current?.focus();
    const key = (e) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab") return;
      const nodes = ref.current.querySelectorAll(
          "button:not(:disabled),input,select,textarea,a[href]",
        ),
        first = nodes[0],
        last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prior?.focus();
    };
  }, []);
  return (
    <div className="backdrop" onClick={onClose}>
      <section
        className="modal"
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="close" aria-label="إغلاق" onClick={onClose}>
          <X size={21} />
        </button>
        <h2 id="modal-title">{title}</h2>
        {children}
      </section>
    </div>
  );
}
export function SecretInput({
  label = "كلمة المرور",
  name = "password",
  newPassword = false,
}) {
  const [show, setShow] = useState(false);
  return (
    <label>
      {label}
      <div className="secret-input">
        <input
          name={name}
          type={show ? "text" : "password"}
          autoComplete={newPassword ? "new-password" : "current-password"}
          minLength={newPassword ? 12 : 1}
          maxLength={128}
          required
        />
        <button
          type="button"
          aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
          onClick={() => setShow(!show)}
        >
          {show ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </label>
  );
}
function PasswordForm({ onDone }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const b = Object.fromEntries(new FormData(e.currentTarget));
          if (b.password !== b.confirm)
            throw Error("كلمتا المرور غير متطابقتين.");
          delete b.confirm;
          const r = await api("/auth/password", { method: "POST", body: b });
          onDone(r.csrf);
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>ستُنهى الجلسات الأخرى بعد التغيير.</p>
      {error && <div className="form-error">{error}</div>}
      <SecretInput label="كلمة المرور الحالية" name="currentPassword" />
      <SecretInput label="كلمة المرور الجديدة" newPassword />
      <SecretInput label="تأكيد الكلمة الجديدة" name="confirm" newPassword />
      <button className="primary full" disabled={busy}>
        حفظ كلمة المرور
      </button>
    </form>
  );
}

export default function Portal() {
  const [session, setSession] = useState(null),
    [initial, setInitial] = useState(true),
    [setup, setSetup] = useState(false),
    [startupError, setStartupError] = useState(""),
    [path, setPath] = useState(window.location.pathname),
    [today, setToday] = useState(null),
    [received, setReceived] = useState(0),
    [tick, setTick] = useState(performance.now()),
    [offline, setOffline] = useState(""),
    [busy, setBusy] = useState(""),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState(null),
    [mobile, setMobile] = useState(false);
  const navigate = useCallback((url) => {
      window.history.pushState({}, "", url);
      setPath(url);
      setMobile(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, []),
    notify = useCallback(setToast, []);
  const refresh = useCallback(async () => {
    const d = await api("/today");
    setToday(d);
    setReceived(performance.now());
    setOffline("");
    return d;
  }, []);
  const restore = useCallback(async () => {
    setInitial(true);
    setStartupError("");
    try {
      const s = await api("/setup");
      setSetup(s.required);
      if (!s.required) {
        try {
          setSession(await api("/auth/session"));
        } catch (e) {
          if (e.status !== 401) throw e;
          setSession(null);
        }
      }
    } catch (e) {
      setStartupError(e.message);
    } finally {
      setInitial(false);
    }
  }, []);
  useEffect(() => {
    restore();
    const pop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [restore]);
  useEffect(() => {
    const id = setInterval(() => setTick(performance.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!session) {
      setToday(null);
      return;
    }
    let active = true;
    const update = async () => {
      try {
        const d = await api("/today");
        if (active) {
          setToday(d);
          setReceived(performance.now());
          setOffline("");
        }
      } catch (e) {
        if (!active) return;
        if (e.status === 401) {
          setSession(null);
          setCsrf("");
          navigate("/login");
          notify("انتهت الجلسة. سجّل دخولك مجدداً.");
        } else setOffline("تعذر تحديث البيانات. " + e.message);
      }
    };
    update();
    const id = setInterval(update, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [session?.user.id, navigate, notify]);
  useEffect(() => {
    if (initial || !session) return;
    const admin = session.user.role === "admin";
    if (
      ["/", "/login", "/setup", "/join"].includes(path) ||
      (admin && !path.startsWith("/admin")) ||
      (!admin && path !== "/employee")
    )
      navigate(admin ? "/admin/dashboard" : "/employee");
  }, [session, path, initial, navigate]);
  const run = async (key, fn) => {
    if (busy) return;
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      if (e.status === 401) {
        setSession(null);
        navigate("/login");
      }
      notify(e.message);
      return null;
    } finally {
      setBusy("");
    }
  };
  const logout = () =>
    run("logout", async () => {
      await api("/auth/logout", { method: "POST", body: {} });
      setSession(null);
      setCsrf("");
      navigate("/login");
    });
  const signedIn = (data) => {
    setCsrf(data.csrf);
    setSession(data);
    setSetup(false);
    window.history.replaceState(
      {},
      "",
      data.user.role === "admin" ? "/admin/dashboard" : "/employee",
    );
    setPath(window.location.pathname);
  };
  const now = today
    ? today.serverNow + Math.max(0, tick - received)
    : Date.now();
  const downloadOrder = () =>
    run("order", async () => {
      const o = await api("/admin/order");
      saveBlob(
        new Blob(
          [
            `سُفرة — ملخص طلب الغداء\nالتاريخ: ${o.day}\nالوجبة: ${o.meal.name}\nالمورد: ${o.meal.restaurant}\nعدد المشاركين المؤكدين: ${o.count}\nالكمية التي حددها المشرف: ${o.meal.quantity}\n\n${o.notice}\nتأكيد ما قبل الغداء لا يثبت استلام الوجبة لاحقاً.`,
          ],
          { type: "text/plain;charset=utf-8" },
        ),
        `lunch-order-${o.day}.txt`,
      );
      notify("تم تحميل الملخص. لم يُرسل طلب إلى المورد.");
    });
  if (initial)
    return (
      <div className="startup">
        <Brand />
        <LoaderCircle className="spin" />
        <p>نجهّز مساحة غداء الفريق…</p>
      </div>
    );
  if (startupError)
    return (
      <div className="startup">
        <Brand />
        <h2>تعذر الاتصال بالخادم</h2>
        <p>{startupError}</p>
        <button className="primary" onClick={restore}>
          إعادة المحاولة <RefreshCw size={16} />
        </button>
      </div>
    );
  if (!session)
    return (
      <>
        <AuthScreen
          mode={setup ? "setup" : path === "/join" ? "join" : "login"}
          onSuccess={signedIn}
        />
        {toast && <Toast text={toast} onClose={() => setToast("")} />}
      </>
    );
  if (!today)
    return (
      <div className="startup">
        <Brand />
        <LoaderCircle className="spin" />
        <p>{offline || "نحمّل بيانات اليوم من الخادم…"}</p>
        <button className="outline" onClick={() => run("refresh", refresh)}>
          إعادة المحاولة
        </button>
        <button onClick={logout}>تسجيل الخروج</button>
      </div>
    );
  const admin = session.user.role === "admin",
    page = path.split("/")[2] || "dashboard";
  return (
    <div className={admin ? "shell admin-shell" : "employee-site"}>
      {admin ? (
        <>
          <aside className={`sidebar ${mobile ? "open" : ""}`}>
            <a className="admin-skip" href="#admin-main">انتقل إلى المحتوى</a>
            <Brand onClick={() => navigate("/admin/dashboard")} />
            <div className="company">
              <span className="company-avatar">{today.company[0]}</span>
              <div>
                <strong>{today.company}</strong>
                <small>لوحة إدارة الغداء</small>
              </div>
              <span className="dot" />
            </div>
            <div className="nav-caption">إدارة الغداء</div>
            <nav aria-label="أقسام الإدارة">
              {nav.map(([id, label, Icon]) => (
                <button
                  key={id}
                  className={page === id ? "active" : ""}
                  aria-current={page === id ? "page" : undefined}
                  onClick={() => navigate("/admin/" + id)}
                >
                  <Icon size={19} />
                  {label}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="protection">
                <span className="admin-sidebar-label"><Clock size={15}/> مواعيد اليوم</span>
                <div><span>تأكيد المشاركة</span><b>١١:٠٠</b></div>
                <div><span>اختيار الوجبة</span><b>١١:١٥</b></div>
                <small>جميع المواعيد بتوقيت اليمن</small>
              </div>
              <div className="profile">
                <Avatar name={session.user.name} />
                <div>
                  <strong>{session.user.name}</strong>
                  <small>مشرف النظام</small>
                </div>
                <button aria-label="تسجيل الخروج" onClick={logout}>
                  <LogOut size={17} />
                </button>
              </div>
            </div>
          </aside>
          {mobile && (
            <button
              className="sidebar-scrim"
              aria-label="إغلاق القائمة"
              onClick={() => setMobile(false)}
            />
          )}
          <div className="main">
            <header>
              <div className="breadcrumbs">
                <button
                  className="mobile-toggle"
                  aria-label="فتح القائمة"
                  aria-expanded={mobile}
                  onClick={() => setMobile(true)}
                >
                  <Menu size={20} />
                </button>
                <span>{today.company}</span>
                <ChevronLeft size={13} />
                <b>{nav.find((n) => n[0] === page)?.[1]}</b>
              </div>
              <div className="header-end">
                <span className="online">
                  <span className="dot" />
                  {offline ? "تعذر الاتصال" : "بيانات اليوم"}
                </span>
                <button
                  aria-label="تغيير كلمة المرور"
                  onClick={() => setModal("password")}
                >
                  <KeyRound size={18} />
                </button>
                <Avatar name={session.user.name} />
                <span className="admin-header-user">{session.user.name}<small>مشرف الغداء</small></span>
              </div>
            </header>
            <main id="admin-main">
              {offline && (
                <div className="warning" role="alert">
                  {offline}{" "}
                  <button onClick={() => run("refresh", refresh)}>
                    إعادة الاتصال
                  </button>
                </div>
              )}
              <AdminArea
                page={page}
                today={today}
                now={now}
                busy={busy}
                offline={!!offline}
                run={run}
                refresh={refresh}
                navigate={navigate}
                notify={notify}
                downloadOrder={downloadOrder}
              />
              <footer>
                <span>
                  <b className="footer-brand">سُفرة</b> · إدارة غداء العمل
                </span>
                <span>
                  <Clock size={12} /> جميع المواعيد بتوقيت اليمن
                </span>
              </footer>
            </main>
          </div>
        </>
      ) : (
        <>
          <header className="employee-header">
            <a className="employee-skip" href="#employee-main">انتقل إلى المحتوى</a>
            <Brand onClick={() => navigate("/employee")} />
            <nav className="employee-nav">
              <a href="#lunch">غداء اليوم</a>
              <a href="#meals">اختيار الوجبة</a>
              <a href="#fairness">سجل اختياراتي</a>
            </nav>
            <div className="employee-account">
              <Avatar name={session.user.name} />
              <span className="employee-account-name">{session.user.name}<small>حساب موظف</small></span>
              <button
                aria-label="تغيير كلمة المرور"
                onClick={() => setModal("password")}
              >
                <KeyRound size={17} />
              </button>
              <button aria-label="تسجيل الخروج" onClick={logout}>
                <LogOut size={17} />
              </button>
            </div>
          </header>
          <main className="employee-container" id="employee-main">
            {offline && (
              <div className="warning" role="alert">
                {offline}
                <button disabled={!!busy} onClick={() => run("refresh", refresh)}>إعادة الاتصال <RefreshCw size={14}/></button>
              </div>
            )}
            <EmployeeHome
              today={today}
              now={now}
              user={session.user}
              busy={busy}
              offline={!!offline}
              run={run}
              refresh={refresh}
              notify={notify}
            />
          </main>
          <footer className="employee-footer">
            <Brand />
            <p>{today.company} · خدمات الموظفين</p>
            <span>جميع المواعيد بتوقيت اليمن</span>
            <button onClick={() => setModal("policy")}>
              سياسة الحضور والخصوصية <ArrowUpLeft size={13} />
            </button>
          </footer>
        </>
      )}
      {toast && <Toast text={toast} onClose={() => setToast("")} />}
      {modal && (
        <Modal
          title={
            modal === "password"
              ? "تغيير كلمة المرور"
              : "سياسة الحضور والخصوصية"
          }
          onClose={() => setModal(null)}
        >
          {modal === "password" ? (
            <PasswordForm
              onDone={(csrf) => {
                setCsrf(csrf);
                setModal(null);
                notify("تم تغيير كلمة المرور وإنهاء الجلسات الأخرى.");
              }}
            />
          ) : (
            <>
              <p>
                تؤكد مشاركتك بنفسك قبل 11:00 بتوقيت اليمن. لا يستطيع المشرف
                تأكيد حضورك، ويُغلق التصويت 11:15.
              </p>
              <p>
                يُحفظ حسابك وتأكيدك واختيارك في قاعدة الشركة. تُفحص إحداثيات GPS
                على الخادم ولا تُحفظ، ويُحفظ الوقت وطريقة التأكيد وإصدار
                السياسة.
              </p>
              <div className="modal-note">
                GPS قابل للتزييف. التأكيد المبكر لا يثبت استلام الوجبة، ولا يضمن
                منع الخصومات؛ يلزم اعتماد الشركة.
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function EmployeePhoto({ src, alt, priority = false, className }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img src={src} alt={alt} className={className} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} onError={() => setFailed(true)}/> : <div className="employee-image-placeholder" role="img" aria-label={alt}><Utensils size={35}/><span>صورة الوجبة غير متاحة</span></div>;
}

export function EmployeeHome({
  today: d,
  now,
  user,
  busy,
  offline,
  run,
  refresh,
  notify,
}) {
  const [proof, setProof] = useState(null),
    [ack, setAck] = useState(false),
    [detail, setDetail] = useState(null),
    [mealQuery, setMealQuery] = useState("");
  useEffect(() => {
    setProof(null);
    setAck(false);
  }, [d.day, d.policyVersion]);
  const attended = !!d.own.attendance,
    closed = now >= d.attendanceDeadline,
    votingClosed = now >= d.voteDeadline,
    total = d.meals.reduce((n, m) => n + m.points, 0),
    winner = d.meals.find((m) => m.meal_id === d.winnerId),
    verified = proof && now < proof.expiresAt;
  const selectedMeal = d.meals.find(m => m.meal_id === d.own.vote?.meal_id);
  const filteredMeals = d.meals.filter(m => (m.name + " " + m.restaurant).includes(mealQuery.trim()));
  const verify = () =>
    run("verify", async () => {
      let body = {};
      if (d.verification.mode !== "network") {
        try {
          const p = await new Promise((resolve, reject) => {
            if (!navigator.geolocation)
              return reject(Error("الموقع غير مدعوم في المتصفح."));
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 0,
            });
          });
          body = {
            position: {
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
              accuracy: p.coords.accuracy,
              timestamp: p.timestamp,
            },
          };
        } catch (e) {
          if (d.verification.mode !== "either")
            throw Error(
              e.code === 1
                ? "اسمح بالموقع للتحقق من نطاق الشركة."
                : e.code === 3
                  ? "انتهت مهلة تحديد الموقع. حاول مجدداً."
                  : "تعذر تحديد الموقع. استخدم HTTPS وتحقق من إعدادات الجهاز.",
            );
        }
      }
      const data = await api("/presence/verify", { method: "POST", body });
      setProof(data);
      notify("تم التحقق على الخادم. أكّد مشاركتك خلال دقيقة.");
    });
  const attend = () =>
    run("attendance", async () => {
      await api("/attendance", {
        method: "POST",
        body: { ...(d.verification.mode === 'self' ? {} : {proof: proof?.proof}), acknowledged: true },
      });
      setProof(null);
      await refresh();
      notify("حضورك مؤكد. اختر الوجبة التي تناسب يومك.");
    });
  const vote = (id) =>
    run("vote:" + id, async () => {
      await api("/votes", { method: "POST", body: { mealId: id } });
      await refresh();
      notify(
        d.own.weight === 2
          ? "احتُسب اختيارك بنقطتين بفضل ميزان الإنصاف."
          : "تم حفظ اختيارك على الخادم.",
      );
    });
  return (
    <>
      <div className="employee-page-heading">
        <div><span className="employee-kicker">{d.company} / بوابة الموظف</span><h1>غداء العمل</h1></div>
        <span className="employee-date"><CalendarDays size={16}/>{dateText(now)}</span>
      </div>
      <section className="employee-hero" id="lunch">
        <div className="employee-hero-copy">
          <span className="employee-eyebrow"><span />{winner ? "اكتمل اختيار اليوم" : !d.published ? "قائمة اليوم قيد الإعداد" : votingClosed ? "انتهى التصويت" : "قائمة اليوم متاحة"}</span>
          <h2>أهلاً، {user.name}<br/>{winner ? "تم اعتماد وجبة اليوم." : "استراحة غداء تبدأ باختيارك."}</h2>
          <p>{winner ? `اختار الفريق ${winner.name} من ${winner.restaurant}. يمكنك مراجعة التفاصيل أدناه.` : "أكّد مشاركتك في غداء اليوم، ثم اختر الوجبة المناسبة لك من قائمة الموردين."}</p>
          <div className="employee-hero-actions">
            <a className="employee-primary" href={attended || closed ? '#meals' : '#attendance'}>{winner ? "عرض وجبة اليوم" : attended ? "اختيار الوجبة" : closed ? "عرض القائمة" : "تأكيد مشاركتي"}<ArrowLeft size={17}/></a>
            <span><Clock size={14}/>الحضور ١١:٠٠ · التصويت ١١:١٥</span>
          </div>
        </div>
        <div className="employee-hero-visual">
          <div className="employee-hero-ring" aria-hidden="true"/>
          <div className="employee-hero-plate"><EmployeePhoto src={image({image:'photo-1512058564366-18510be2db19'})} alt="طبق الأرز — صورة ترحيبية لسُفرة" priority/></div>
          <span className="employee-hero-signature"><Utensils size={15}/> سُفرة <span>استراحة تجمعنا</span></span>
        </div>
      </section>
      <div className="employee-status-bar" aria-label="ملخص مشاركتك">
        <div><span className={`employee-status-icon ${attended ? 'done' : ''}`}><CheckCircle2 size={21}/></span><span><small>حالة المشاركة</small><strong>{attended ? "مؤكدة لليوم" : closed ? "لم تُسجّل المشاركة" : "بانتظار تأكيدك"}</strong></span></div>
        <div><span className={`employee-status-icon ${selectedMeal ? 'done' : ''}`}><Utensils size={21}/></span><span><small>اختيارك</small><strong>{selectedMeal?.name || (votingClosed ? "لم يتم الاختيار" : "لم تختر وجبة بعد")}</strong></span></div>
        <div><span className="employee-status-icon"><Users size={21}/></span><span><small>مشاركة الفريق</small><strong>{fmt(d.count)} موظفاً مؤكداً</strong></span></div>
      </div>
      <div className="employee-workspace">
      <section id="attendance" className={`employee-gate ${attended ? "is-confirmed" : ""}`}>
        <div className="employee-gate-heading">
          <span className="employee-gate-icon">
            {attended ? (
              <CheckCircle2 size={28} />
            ) : closed ? (
              <Lock size={27} />
            ) : (
              <Fingerprint size={28} />
            )}
          </span>
          <div>
            <span className="employee-mini-label">
              ٠١ / تأكيد المشاركة
            </span>
            <h2>
              {attended
                ? "تم تأكيد مشاركتك"
                : !d.published
                  ? "خيارات الغداء قيد التجهيز"
                  : closed
                    ? "أُغلق تسجيل غداء اليوم"
                    : "تسجيل غداء اليوم"}
            </h2>
            <p>
              {attended
                ? `سُجل تأكيدك الساعة ${timeText(d.own.attendance.at)} وأُضيفت مشاركتك إلى عدد اليوم.`
                : !d.published
                  ? "بانتظار اعتماد المشرف للوجبات والموردين. ستتحدث الصفحة تلقائياً."
                  : closed
                    ? "لم تؤكد قبل ١١:٠٠، لذلك لن تدخل في عدد طلب اليوم."
                    : "تأكيدك شخصي، ولا يستطيع أي شخص تسجيل حضورك بالنيابة."}
            </p>
          </div>
          <span className={`employee-time-chip ${closed ? "expired" : ""}`}>
            <Clock size={15} />
            {closed ? (
              "انتهى الوقت"
            ) : (
              <>
                <b dir="ltr">{remaining(now, d.attendanceDeadline)}</b> حتى
                ١١:٠٠
              </>
            )}
          </span>
        </div>
        {!attended && !closed && d.published && (
          <div className="employee-gate-body">
            {d.verification.mode === 'self' ? (
              <div className="employee-self-confirm">
                <p>بالضغط على الزر، أؤكد أنني سأشارك في غداء اليوم. يُحفظ التأكيد باسمي ووقت التسجيل.</p>
                <button className="employee-primary employee-fingerprint-action" disabled={!!busy || offline} onClick={attend}>
                  {busy === 'attendance' ? <LoaderCircle className="spin" size={28}/> : <Fingerprint size={32}/>}
                  <span>{busy === 'attendance' ? 'جارٍ تسجيل مشاركتك…' : 'أنا حاضر ومستعد للغداء'}<small>اضغط لتأكيد المشاركة</small></span>
                  <ArrowLeft size={19}/>
                </button>
                <small>تأكيد ذاتي من حسابك · لا تُطلب بصمة الجهاز أو إذن الموقع</small>
              </div>
            ) : !d.verification.configured ? (
              <div className="employee-notice">
                <Info size={17} /><div><strong>بانتظار إعداد التحقق من الحضور</strong><p>لم يحدد مسؤول الغداء {d.verification.mode === 'gps' ? 'موقع المبنى' : d.verification.mode === 'network' ? 'شبكة الشركة المسموحة' : 'موقع المبنى أو شبكة الشركة'} بعد. اطلب منه استكمال «إعدادات الشركة» لتتمكن من تأكيد مشاركتك.</p></div>
              </div>
            ) : (
              <>
                <div
                  className={`employee-verify ${verified ? "verified" : ""}`}
                >
                  <span>
                    {d.verification.mode === "network" ? (
                      <Wifi size={21} />
                    ) : (
                      <MapPin size={21} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {verified
                        ? "تم التحقق من نطاق الشركة"
                        : d.verification.mode === "network"
                          ? "اتصل بشبكة الشركة"
                          : "تحقق من وجودك في نطاق الشركة"}
                    </strong>
                    <small>
                      {verified
                        ? "تحقق مؤقت صالح لمدة دقيقة"
                        : d.verification.mode === "network"
                          ? "يتحقق الخادم من اتصالك الفعلي"
                          : "سيطلب المتصفح إذن موقعك، ولن تُحفظ الإحداثيات"}
                    </small>
                  </div>
                  <button disabled={!!busy || offline} onClick={verify}>
                    {busy === "verify" ? (
                      <>
                        <LoaderCircle size={15} className="spin" /> جارٍ التحقق
                      </>
                    ) : verified ? (
                      <>
                        <Check size={15} /> إعادة التحقق
                      </>
                    ) : (
                      <>
                        تحقق الآن <ArrowUpLeft size={15} />
                      </>
                    )}
                  </button>
                </div>
                <div className="employee-confirm-row">
                  <label className="employee-ack">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                    />
                    أقر بأنني حاضر في الشركة وسأشارك في غداء اليوم، وأن تأكيدي
                    مسؤولية شخصية.
                  </label>
                  <button
                    className="employee-primary"
                    disabled={!!busy || offline || !verified || !ack}
                    onClick={attend}
                  >
                    {busy === "attendance" ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <>
                        <Fingerprint size={20} /> أنا حاضر ومستعد للغداء{" "}
                        <ArrowLeft size={17} />
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {attended && (
          <div className="employee-confirmed-strip">
            <CheckCheck size={19} />
            <span>مشاركتك محفوظة. يمكنك متابعة اختيار وجبتك.</span>
            <a href="#meals">
              اختَر وجبتك <ArrowLeft size={15} />
            </a>
          </div>
        )}
        <div className="employee-gate-caption">
          <ShieldCheck size={13} /> يُغلق الحضور ١١:٠٠ بوقت الخادم. التأكيد لا
          يثبت استلام الوجبة لاحقاً.
        </div>
      </section>
      <aside className="employee-day-plan" aria-label="مواعيد غداء اليوم">
        <span className="employee-mini-label">تنظيم يومك</span><h2>مواعيد الغداء</h2>
        <ol>
          <li className={attended ? 'complete' : ''}><span className="plan-point">{attended ? <Check size={13}/> : '١'}</span><div><time>١١:٠٠ صباحاً</time><strong>إغلاق تأكيد المشاركة</strong><p>{attended ? "أتممت هذه الخطوة" : "أكد حضورك قبل إغلاق التسجيل"}</p></div></li>
          <li className={selectedMeal ? 'complete' : ''}><span className="plan-point">{selectedMeal ? <Check size={13}/> : '٢'}</span><div><time>١١:١٥ صباحاً</time><strong>اعتماد اختيار الفريق</strong><p>{selectedMeal ? "اختيارك محفوظ وقابل للتغيير حتى الإغلاق" : "تنتهي مهلة التصويت وتُحسم النتيجة"}</p></div></li>
        </ol>
        <div className="employee-plan-note"><ShieldCheck size={17}/><p>التأكيد من حسابك فقط.<br/>تُطبّق المواعيد بتوقيت اليمن.</p></div>
      </aside>
      </div>
      <section className="employee-meals" id="meals">
        <div className="employee-section-title">
          <div>
            <span className="employee-mini-label">
              ٠٢ / قائمة اليوم
            </span>
            <h2>
              اختر وجبتك
            </h2>
            <p>
              {winner
                ? `حسم الفريق القرار: ${winner.name}. نتمنى لكم غداءً طيباً.`
                : attended ? "اختر وجبة واحدة. يمكنك تعديل اختيارك حتى إغلاق التصويت." : "تصفّح الخيارات وأكّد مشاركتك لتتمكن من التصويت."}
            </p>
          </div>
          <span className="employee-vote-chip">
            <span />
            {votingClosed ? (
              "انتهى تصويت اليوم"
            ) : (
              <>
                التصويت ينتهي ١١:١٥{" "}
                <b dir="ltr">{remaining(now, d.voteDeadline)}</b>
              </>
            )}
          </span>
        </div>
        {!d.published ? (
          <div className="employee-empty">
            <Utensils size={34} />
            <h3>لم تُنشر قائمة اليوم بعد</h3>
            <p>ستظهر الوجبات هنا تلقائياً بعد اعتمادها من مسؤول الغداء.</p>
          </div>
        ) : (
          <>
            <div className="employee-menu-toolbar"><span>{fmt(d.meals.length)} خيارات متاحة{selectedMeal && <> · <b>اختيارك محفوظ</b></>}</span><label className="employee-meal-search"><Search size={17}/><input aria-label="البحث في وجبات اليوم" placeholder="ابحث عن وجبة أو مورد…" value={mealQuery} onChange={e=>setMealQuery(e.target.value)}/>{mealQuery && <button aria-label="مسح البحث" onClick={()=>setMealQuery('')}><X size={15}/></button>}</label></div>
            {!filteredMeals.length && <div className="employee-empty"><Search size={28}/><h3>لا توجد نتائج مطابقة</h3><p>جرّب اسم وجبة أو مورد آخر.</p><button className="employee-text-link" onClick={()=>setMealQuery('')}>عرض كل الوجبات</button></div>}
            <div className="employee-meal-grid">
              {filteredMeals.map((m) => {
                const selected = d.own.vote?.meal_id === m.meal_id,
                  pct = total ? Math.round((m.points / total) * 100) : 0,
                  won = m.meal_id === d.winnerId;
                return (
                  <article
                    key={m.meal_id}
                    className={`employee-meal ${selected ? "selected" : ""} ${won ? "won" : ""}`}
                  >
                    <div className="employee-meal-photo">
                      <EmployeePhoto src={image(m)} alt={`صورة وجبة ${m.name}`}/>
                      {selected && !won && <span className="employee-selected-label"><CheckCircle2 size={14}/>اختيارك الحالي</span>}
                      {won && (
                        <span className="employee-winner">
                          <CheckCircle2 size={15} /> وجبة اليوم
                        </span>
                      )}
                      <span className="employee-price">
                        <b>{fmt(m.quantity)}</b> وجبة محددة
                      </span>
                    </div>
                    <div className="employee-meal-content">
                      <span className="employee-restaurant">
                        <Utensils size={12} /> {m.restaurant}
                      </span>
                      <h3>{m.name}</h3>
                      <p>{m.description}</p>
                      <div className="employee-vote-count">
                        <span>
                          {fmt(m.voters)} مصوّت{" "}
                          <small>· {fmt(m.points)} نقطة</small>
                        </span>
                        <b>{fmt(pct)}٪</b>
                      </div>
                      <div className="employee-vote-track" role="progressbar" aria-label={`نسبة نقاط ${m.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                        <i style={{ width: pct + "%" }} />
                      </div>
                      <button
                        className={`employee-vote-button ${selected ? "chosen" : ""}`}
                        aria-pressed={selected}
                        disabled={
                          !!busy || offline || !attended || votingClosed
                        }
                        onClick={() => vote(m.meal_id)}
                      >
                        {busy === "vote:" + m.meal_id ? (
                          <LoaderCircle className="spin" size={17} />
                        ) : votingClosed ? (
                          won ? (
                            <>
                              <CheckCircle2 size={17} /> اختيار الفريق اليوم
                            </>
                          ) : (
                            "انتهى التصويت"
                          )
                        ) : selected ? (
                          <>
                            <CheckCircle2 size={17} /> هذا اختياري{" "}
                            {d.own.weight === 2 && "×٢"}
                          </>
                        ) : attended ? (
                          <>
                            أصوّت لهذه الوجبة <ArrowUpLeft size={16} />
                          </>
                        ) : (
                          "أكّد مشاركتك أولاً"
                        )}
                      </button>
                      <button
                        className="employee-details-link"
                        onClick={() => setDetail(m)}
                      >
                        المكونات والحساسية <ChevronLeft size={13} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="employee-arena-note">
              <Info size={14} /> يمكنك تغيير اختيارك حتى الإغلاق. أعلى مجموع
              نقاط يحدد اختيار الفريق.
            </div>
          </>
        )}
      </section>
      <section className="employee-fairness" id="fairness">
        <div className="employee-fairness-copy">
          <span className="employee-mini-label">سجل المشاركة</span>
          <h2>اختياراتك السابقة</h2>
          <p>
            لم يفز اختيارك ثلاثة أيام متتالية؟ في اليوم الرابع يصبح وزن صوتك
            نقطتين وفق سياسة الإنصاف.
          </p>
          <span className="employee-fairness-pill">
            <Scale size={17} />{" "}
            {d.own.weight === 2
              ? "ميزة الإنصاف مفعّلة لك اليوم"
              : "وزن صوتك اليوم نقطة واحدة"}
          </span>
        </div>
        <div className="employee-fairness-history">
          <div className="employee-weight">
            <Scale size={24} />
            <span>قوة صوتك اليوم</span>
            <b>×{d.own.weight}</b>
          </div>
          {d.own.history.map((h) => {
            const lost = h.choice && h.winner && h.choice !== h.winner;
            return (
              <div className="employee-history-row" key={h.day}>
                <span>{dateText(h.day + "T12:00:00+03:00")}</span>
                <small>
                  {!h.choice
                    ? "لم تصوّت"
                    : !h.winner
                      ? "دون نتيجة"
                      : lost
                        ? "لم يفز اختيارك"
                        : "فاز اختيارك"}
                </small>
                <span className={lost ? "history-lost" : "history-neutral"}>
                  {lost ? (
                    <X size={13} />
                  ) : h.choice && h.winner ? (
                    <Check size={13} />
                  ) : (
                    <span>—</span>
                  )}
                </span>
              </div>
            );
          })}
          <p>يوم دون تصويت أو يوم فوز يوقف تسلسل الخسارة.</p>
        </div>
      </section>
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          {image(detail) && (
            <img
              className="modal-meal"
              src={image(detail)}
              alt="صورة توضيحية للوجبة"
            />
          )}
          <p>{detail.description}</p>
          <div className="modal-note">
            {detail.allergens || "يجب تأكيد المكونات والحساسية مع المورد."}
          </div>
          <p>
            المورد: {detail.restaurant} · الكمية المحددة: {fmt(detail.quantity)} وجبة.
            الصور توضيحية. لحساسية الطعام، رتّب بديلاً آمناً مع المشرف قبل
            الطلب.
          </p>
        </Modal>
      )}
    </>
  );
}

// ADMIN_AREA
