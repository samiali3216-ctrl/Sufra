import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { createApp } from "../server/app.js";
import React from "react";
test("real API + React employee site: invitation, self-confirmation, voting, search, polling and logout", async () => {
  let now = Date.parse("2026-10-28T10:30:00+03:00");
  const origin = "http://localhost:3000",
    system = createApp({ dbPath: ":memory:", origin, clock: () => now }),
    http = system.app.listen(0, "127.0.0.1");
  await new Promise((r) => http.once("listening", r));
  const base = `http://127.0.0.1:${http.address().port}`,
    nativeFetch = globalThis.fetch;
  let adminCookie = "",
    adminCsrf = "";
  async function admin(path, body, method = "POST") {
    const r = await nativeFetch(base + "/api" + path, {
      method,
      headers: {
        Origin: origin,
        Cookie: adminCookie,
        "X-CSRF-Token": adminCsrf,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (r.headers.get("set-cookie"))
      adminCookie = r.headers.get("set-cookie").split(";")[0];
    const data = await r.json();
    if (data.csrf) adminCsrf = data.csrf;
    assert.ok(r.ok, JSON.stringify(data));
    return data;
  }
  const pass = "Employee UI test password 926!";
  await admin("/setup", {
    username: "manager",
    password: pass,
    name: "مسؤول الاختبار",
  });
  const meals = await admin("/admin/meals", null, "GET");
  for (const { id, ...m } of meals)
    await admin(
      "/admin/meals/" + id,
      { ...m, enabled: true, confirmed: true },
      "PUT",
    );
  const s = await admin("/admin/settings", null, "GET");
  delete s.policyVersion;
  await admin(
    "/admin/settings",
    { ...s, verification:'self', office: null },
    "PUT",
  );
  const created = await admin("/admin/employees", {
    username: "employee.ui",
    name: "أسامة الاختبار",
    department: "التقنية",
  });
  await admin("/admin/day/publish", { confirmed: true });
  const dom = new JSDOM(
    '<!doctype html><html lang="ar" dir="rtl"><body><div id="root"></div></body></html>',
    { url: created.invite },
  );
  for (const key of [
    "window",
    "document",
    "HTMLElement",
    "Node",
    "localStorage",
    "navigator",
    "FormData",
  ])
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: dom.window[key],
    });
  window.scrollTo = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok) =>
        ok({
          coords: { latitude: 15.3, longitude: 44.2, accuracy: 10 },
          timestamp: now,
        }),
    },
  });
  let employeeCookie = "";
  globalThis.fetch = async (url, opts = {}) => {
    const response = await nativeFetch(base + String(url), {
      ...opts,
      headers: { ...opts.headers, Origin: origin, Cookie: employeeCookie },
    });
    if (response.headers.get("set-cookie"))
      employeeCookie = response.headers.get("set-cookie").split(";")[0];
    return response;
  };
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  let view;
  try {
    const { render, screen, fireEvent, waitFor, act } =
      await import("@testing-library/react");
    const { default: Portal } = await vite.ssrLoadModule("/src/Portal.jsx");
    view = render(React.createElement(Portal));
    await screen.findByRole("button", { name: "تفعيل حسابي" });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), {
      target: { value: pass },
    });
    fireEvent.change(screen.getByLabelText("تأكيد كلمة المرور"), {
      target: { value: pass },
    });
    fireEvent.click(screen.getByRole("button", { name: "تفعيل حسابي" }));
    await screen.findByRole("button", { name: /أنا حاضر ومستعد للغداء/ });
    const confirm = screen.getByRole("button", {
      name: /أنا حاضر ومستعد للغداء/,
    });
    assert.equal(confirm.disabled, false);
    assert.equal(screen.queryByRole('button',{name:/تحقق الآن/}),null);
    fireEvent.click(confirm);
    await screen.findByRole("heading", { name: "تم تأكيد مشاركتك" });
    const search = screen.getByRole('textbox',{name:'البحث في وجبات اليوم'});
    fireEvent.change(search,{target:{value:'وجبة غير موجودة'}});
    await screen.findByRole('heading',{name:'لا توجد نتائج مطابقة'});
    assert.equal(screen.queryAllByRole('button',{name:/أصوّت لهذه الوجبة/}).length,0);
    fireEvent.click(screen.getByRole('button',{name:'عرض كل الوجبات'}));
    assert.equal(screen.getAllByRole('button',{name:/أصوّت لهذه الوجبة/}).length,3);
    assert.equal(
      system.db.prepare("SELECT count(*) n FROM attendance").get().n,
      1,
    );
    assert.equal(system.db.prepare('SELECT method FROM attendance').get().method,'self');
    fireEvent.click(
      screen.getAllByRole("button", { name: /أصوّت لهذه الوجبة/ })[2],
    );
    await screen.findByRole("button", { name: /هذا اختياري/ });
    assert.equal(system.db.prepare("SELECT count(*) n FROM votes").get().n, 1);
    assert.equal(screen.queryByRole("button", { name: /إضافة موظف/ }), null);
    now = Date.parse("2026-10-28T11:16:00+03:00");
    await waitFor(
      () =>
        assert.ok(
          screen.getByRole("button", { name: /اختيار الفريق اليوم/ }).disabled,
        ),
      { timeout: 8000 },
    );
    assert.ok(
      system.db
        .prepare("SELECT finalized_at FROM days WHERE day=?")
        .get("2026-10-28").finalized_at,
    );
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" }));
    await screen.findByRole("button", { name: "تسجيل الدخول" });
    assert.equal(
      system.db
        .prepare("SELECT count(*) n FROM sessions WHERE user_id=?")
        .get(created.user.id).n,
      0,
    );
    fireEvent.change(screen.getByLabelText("اسم المستخدم"), {
      target: { value: "manager" },
    });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), {
      target: { value: pass },
    });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الدخول" }));
    await screen.findByRole("button", { name: "الفريق والدعوات" });
    await screen.findByRole('heading',{name:'نظرة عامة'});
    assert.equal(screen.getAllByRole('progressbar').length,3);
    assert.ok(screen.getByText('تأكيد ذاتي بضغطة زر من حساب الموظف.'));
    fireEvent.click(screen.getByRole("button", { name: "الفريق والدعوات" }));
    await screen.findByRole("button", { name: "إضافة موظف" });
    fireEvent.click(screen.getByRole("button", { name: "إضافة موظف" }));
    const fullName = screen.getByLabelText("الاسم الكامل");
    fullName.focus();
    fireEvent.change(fullName, { target: { value: "موظف من لوحة الإدارة" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });
    assert.equal(
      document.activeElement,
      fullName,
      "one-second clock renders must not steal form focus",
    );
    fireEvent.change(screen.getByLabelText("اسم المستخدم بالإنجليزية"), {
      target: { value: "admin.created" },
    });
    fireEvent.change(screen.getByLabelText("القسم"), {
      target: { value: "المالية" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /إنشاء الحساب وإصدار الدعوة/ }),
    );
    await screen.findByRole("heading", { name: "رابط التفعيل جاهز" });
    assert.ok(
      system.db
        .prepare("SELECT id FROM users WHERE username=?")
        .get("admin.created"),
    );
    fireEvent.click(screen.getByRole('button',{name:'إغلاق'}));
    const employeeSearch=screen.getByRole('textbox',{name:'البحث عن موظف'});
    fireEvent.change(employeeSearch,{target:{value:'اسم غير موجود'}});
    await screen.findByRole('heading',{name:'لا توجد نتائج مطابقة'});
    fireEvent.click(screen.getByRole('button',{name:'الوجبات والموردون'}));
    const mealSearch=await screen.findByRole('textbox',{name:'البحث في قائمة الوجبات'});
    assert.equal(mealSearch.value,'','changing admin section resets the search');
    await waitFor(()=>assert.equal(screen.getAllByRole('button',{name:'تعديل الوجبة والمورد'}).length,3));
    fireEvent.change(mealSearch,{target:{value:'مورد غير موجود'}});
    await screen.findByRole('heading',{name:'لا توجد نتائج مطابقة'});
    fireEvent.change(mealSearch,{target:{value:meals[0].restaurant}});
    assert.equal(screen.getAllByRole('button',{name:'تعديل الوجبة والمورد'}).length,1);
    fireEvent.click(screen.getByRole('button',{name:'تعديل الوجبة والمورد'}));
    const quantity=screen.getByLabelText('الكمية المطلوبة من الوجبة');
    fireEvent.change(quantity,{target:{value:'44'}});
    fireEvent.click(screen.getByRole('button',{name:/حفظ الوجبة/}));
    await waitFor(()=>assert.equal(system.db.prepare('SELECT quantity FROM meals WHERE id=?').get(meals[0].id).quantity,44));
    assert.equal(system.db.prepare('SELECT quantity FROM day_meals WHERE meal_id=?').get(meals[0].id).quantity,30,'catalog editing keeps published quantity');
    fireEvent.click(screen.getByRole('button',{name:'الحضور والتقارير'}));
    await screen.findByRole('heading',{name:'سجل أحداث اليوم'});
    fireEvent.change(screen.getByRole('textbox',{name:'البحث في الحضور'}),{target:{value:'لا يوجد'}});
    await screen.findByRole('heading',{name:'لا توجد نتائج مطابقة'});
  } finally {
    view?.unmount();
    await vite.close();
    globalThis.fetch = nativeFetch;
    await new Promise((r) => http.close(r));
    system.close();
    dom.window.close();
  }
});
