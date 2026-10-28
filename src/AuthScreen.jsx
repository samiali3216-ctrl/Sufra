import React, { useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Info,
  LoaderCircle,
  Lock,
  ShieldCheck,
  Utensils,
  Users,
  Scale,
  X,
} from "lucide-react";
import { api } from "./api.js";
import { Brand, SecretInput } from "./Portal.jsx";

export default function AuthScreen({ mode, onSuccess }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [help, setHelp] = useState(null);
  const [activation] = useState(() => window.location.hash.slice(1));
  const errorRef = useRef(null);
  const copy = {
    login: {
      title: "تسجيل الدخول إلى سُفرة",
      description: "أهلاً بعودتك. غداء الفريق يبدأ من هنا.",
      button: "تسجيل الدخول",
    },
    setup: {
      title: "إنشاء مساحة الشركة",
      description: "أهلاً بك. لنجهّز حساب المشرف الأول.",
      button: "إنشاء مساحة الشركة",
    },
    join: {
      title: "أهلاً بك على مائدتنا",
      description: "خطوة أخيرة، وتصبح جزءاً من الفريق.",
      button: "تفعيل حسابي",
    },
  }[mode];
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const b = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (mode !== "login" && b.password !== b.confirm)
        throw Error("كلمتا المرور غير متطابقتين. راجعهما وحاول مجدداً.");
      delete b.confirm;
      const data = await api(
        mode === "setup"
          ? "/setup"
          : mode === "join"
            ? "/auth/activate"
            : "/auth/login",
        {
          method: "POST",
          body:
            mode === "join" ? { token: activation, password: b.password } : b,
        },
      );
      onSuccess(data);
    } catch (e) {
      setError(e.message);
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="signin-page">
      <aside className="signin-brand-panel" aria-label="عن سُفرة">
        <div className="signin-panel-top">
          <Brand />
          <p>مرحباً بك في مساحة غداء الفريق</p>
        </div>
        <div className="signin-brand-center">
          <div className="signin-emblem" aria-hidden="true">
            <svg viewBox="0 0 240 240" fill="none">
              <path
                d="M64 40v65c0 16 30 16 30 0V40M79 40v157M49 40v49M109 40v49M147 195V43c-33 29-35 71 0 81"
                stroke="currentColor"
                strokeWidth="11"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M166 49h38v38m-2-36-33 34"
                stroke="currentColor"
                strokeWidth="10"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h2>غداء الفريق، من مكان واحد</h2>
          <p>حضور واضح. اختيار منصف. وطاولة تجمعنا.</p>
          <div className="signin-feature-list">
            <span>
              <CheckCircle2 size={15} /> حضور ذاتي
            </span>
            <span>
              <Scale size={15} /> تصويت منصف
            </span>
            <span>
              <Users size={15} /> فريق أقرب
            </span>
          </div>
        </div>
        <div className="signin-panel-bottom">
          <span>سُفرة</span>
          <span>غداء أذكى. يوم أجمل.</span>
        </div>
      </aside>
      <main className="signin-form-panel">
        <div className="signin-mobile-brand">
          <Brand />
        </div>
        <section className="signin-form-wrap" aria-labelledby="signin-title">
          <div className="signin-step-label">
            <span />
            {mode === "setup"
              ? "لنبدأ من هنا"
              : mode === "join"
                ? "دعوتك وصلت. مكانك محفوظ."
                : "مساحتك اليومية"}
          </div>
          <h1 id="signin-title">{copy.title}</h1>
          <p className="signin-description">{copy.description}</p>
          {error && (
            <div
              className="signin-error"
              ref={errorRef}
              tabIndex={-1}
              role="alert"
            >
              <Info size={17} />
              <span>{error}</span>
              <button
                type="button"
                aria-label="إغلاق الخطأ"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {mode === "join" && !activation ? (
            <div className="signin-error" role="alert">
              <Info size={17} />
              <span>
                رابط الدعوة غير مكتمل. اطلب من المشرف رابط تفعيل جديداً.
              </span>
            </div>
          ) : (
            <form onSubmit={submit} aria-label={copy.title} aria-busy={busy}>
              <fieldset disabled={busy}>
                {mode === "setup" && (
                  <label>
                    اسم المشرف
                    <input
                      name="name"
                      autoComplete="name"
                      minLength={2}
                      maxLength={100}
                      placeholder="اسمك الكامل"
                      required
                    />
                  </label>
                )}
                {mode !== "join" && (
                  <label>
                    اسم المستخدم
                    <input
                      name="username"
                      dir="ltr"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,63}"
                      placeholder="your.username"
                      required
                    />
                  </label>
                )}
                <SecretInput newPassword={mode !== "login"} />
                {mode !== "login" && (
                  <>
                    <SecretInput
                      label="تأكيد كلمة المرور"
                      name="confirm"
                      newPassword
                    />
                    <p className="signin-password-hint">
                      12 محرفاً على الأقل. اختر كلمة مرور خاصة بهذا الحساب.
                    </p>
                  </>
                )}
              </fieldset>
              {mode === "login" && (
                <div className="signin-form-links">
                  <button
                    type="button"
                    onClick={() =>
                      setHelp(help === "password" ? null : "password")
                    }
                    aria-expanded={help === "password"}
                    aria-controls="signin-help"
                  >
                    هل نسيت كلمة المرور؟
                  </button>
                </div>
              )}
              <button className="signin-submit" type="submit" disabled={busy}>
                {busy ? (
                  <>
                    <LoaderCircle size={18} className="spin" />
                    <span>
                      جارٍ {mode === "login" ? "تسجيل الدخول" : "تجهيز حسابك"}…
                    </span>
                  </>
                ) : (
                  <>
                    <span>{copy.button}</span>
                    <ArrowLeft size={17} />
                  </>
                )}
              </button>
            </form>
          )}
          {mode === "login" && (
            <div className="signin-invitation">
              <span>ليس لديك حساب؟</span>
              <button
                type="button"
                onClick={() => setHelp(help === "invite" ? null : "invite")}
                aria-expanded={help === "invite"}
                aria-controls="signin-help"
              >
                انضم بدعوة من المشرف
              </button>
            </div>
          )}
          {help && (
            <div className="signin-help-panel" id="signin-help" role="status">
              <ShieldCheck size={19} />
              <div>
                <strong>
                  {help === "password"
                    ? "استعادة حسابك، بشكل آمن"
                    : "مكانك يبدأ بدعوة"}
                </strong>
                <p>
                  {help === "password"
                    ? "اطلب من مشرف الغداء إصدار رابط تفعيل جديد لحسابك. افتح الرابط واختر كلمة مرور جديدة؛ لن يطّلع المشرف على كلمة مرورك."
                    : "تواصل مع مشرف الغداء في شركتك ليضيف حسابك ويعطيك رابط تفعيل خاصاً. افتح الدعوة لإنشاء كلمة مرورك، ثم سجّل الدخول هنا."}
                </p>
              </div>
            </div>
          )}
          {mode === "setup" && (
            <div className="signin-setup-note">
              <Info size={15} /> الإعداد الأول متاح من جهاز الخادم فقط.
            </div>
          )}
          <div className="signin-trust">
            <Lock size={13} />
            <span>حسابك خاص. حضورك واختيارك محفوظان باسمك.</span>
          </div>
        </section>
        <div className="signin-form-footer">
          <span>© {new Date().getFullYear()} سُفرة</span>
          <span>
            بتوقيت اليمن <span className="footer-dot" />
          </span>
        </div>
      </main>
    </div>
  );
}
