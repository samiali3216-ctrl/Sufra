import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { createApp } from "./app.js";
import { cutoff, previousDay } from "../src/domain.js";

test('self-confirmation is explicit, identity-bound, one-time and deadline enforced', async () => {
  let now = Date.parse('2026-10-28T10:30:00+03:00');
  const origin = 'http://localhost:3000', system = createApp({dbPath:':memory:',origin,clock:()=>now});
  const http = system.app.listen(0,'127.0.0.1');
  await new Promise(r=>http.once('listening',r));
  const base = `http://127.0.0.1:${http.address().port}/api`;
  function client() {
    let cookie='',csrf='';
    return async (path,body,method='POST') => {
      const r=await fetch(base+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},...(body ? {body:JSON.stringify(body)} : {})});
      if(r.headers.get('set-cookie')) cookie=r.headers.get('set-cookie').split(';')[0];
      const data=await r.json(); if(data.csrf)csrf=data.csrf;
      return {status:r.status,data};
    };
  }
  const admin=client(), employee=client(), pass='Self confirm test password 123!';
  try {
    assert.equal((await admin('/setup',{username:'manager',name:'مدير الاختبار',password:pass})).status,201);
    assert.equal(JSON.parse(system.db.prepare('SELECT payload FROM settings').get().payload).verification,'self');
    const invite=await admin('/admin/employees',{username:'self.employee',name:'موظف الاختبار',department:''});
    await employee('/auth/activate',{token:invite.data.invite.split('#')[1],password:pass});
    assert.equal((await employee('/attendance',{acknowledged:true})).status,409);
    system.db.prepare('UPDATE meals SET confirmed=1').run();
    await admin('/admin/day/publish',{confirmed:true});
    assert.equal((await admin('/attendance',{acknowledged:true})).status,403);
    assert.equal((await employee('/attendance',{acknowledged:true,userId:'someone-else'})).status,400);
    assert.equal((await employee('/attendance',{acknowledged:false})).status,400);
    const s=(await admin('/admin/settings',null,'GET')).data;
    delete s.policyVersion;
    await admin('/admin/settings',{...s,verification:'gps'},'PUT');
    assert.equal((await employee('/attendance',{acknowledged:true})).status,403);
    await admin('/admin/settings',{...s,verification:'self'},'PUT');
    assert.equal((await employee('/attendance',{acknowledged:true})).status,201);
    assert.equal(system.db.prepare('SELECT method FROM attendance').get().method,'self');
    assert.equal((await employee('/attendance',{acknowledged:true})).status,409);
    system.db.prepare('DELETE FROM attendance').run();
    now=Date.parse('2026-10-28T11:00:00+03:00');
    assert.equal((await employee('/attendance',{acknowledged:true})).status,409);
    assert.equal(system.db.prepare('SELECT count(*) n FROM attendance').get().n,0);
  } finally { await new Promise(r=>http.close(r)); system.close(); }
});

test("full-stack HTTP contract, identity isolation, deadlines, persistence and exports", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "luqma-test-")),
    dbPath = join(dir, "test.sqlite");
  let now = Date.parse("2026-10-28T10:30:00+03:00");
  const origin = "http://localhost:3000";
  const system = createApp({ dbPath, clock: () => now, origin, allowedOrigins:[origin,"http://127.0.0.1:3000"] });
  const server = system.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = "",
      csrf = "";
    return {
      async call(path, method = "GET", body, options = {}) {
        const response = await fetch(base + "/api" + path, {
          method,
          headers: {
            Origin: origin,
            ...(cookie ? { Cookie: cookie } : {}),
            ...(method !== "GET" && !options.noCSRF
              ? { "X-CSRF-Token": csrf }
              : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (response.headers.get("set-cookie"))
          cookie = response.headers.get("set-cookie").split(";")[0];
        const type = response.headers.get("content-type") || "";
        const data = type.includes("json")
          ? await response.json()
          : await response.text();
        if (data.csrf) csrf = data.csrf;
        return { status: response.status, data, headers: response.headers };
      },
      get cookie() {
        return cookie;
      },
    };
  };
  const admin = client(),
    one = client(),
    two = client(),
    anon = client();
  const pass = "Correct long test password 347!";
  let uid1, uid2, proof;
  async function createEmployee(username, c) {
    const r = await admin.call("/admin/employees", "POST", {
      username,
      name: username === "employee1" ? "الموظف الأول" : "الموظف الثاني",
      department: "التقنية",
    });
    assert.equal(r.status, 201);
    assert.equal(
      (
        await c.call("/auth/activate", "POST", {
          token: r.data.invite.split("#")[1],
          password: pass,
        })
      ).status,
      200,
    );
    return { id: r.data.user.id, invite: r.data.invite };
  }
  try {
    await t.test(
      "bootstrap creates only one admin; no default credentials",
      async () => {
        assert.equal((await anon.call("/today")).status, 401);
        assert.equal(
          (
            await admin.call("/setup", "POST", {
              username: "manager",
              name: "مدير الغداء",
              password: pass,
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await anon.call("/setup", "POST", {
              username: "second",
              name: "مدير آخر",
              password: pass,
            })
          ).status,
          409,
        );
        assert.equal(
          (await admin.call("/auth/session")).data.user.role,
          "admin",
        );
      },
    );
    await t.test("CSRF and foreign origin rejected", async () => {
      assert.equal(
        (
          await admin.call(
            "/admin/day/publish",
            "POST",
            { confirmed: true },
            { noCSRF: true },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await admin.call(
            "/admin/day/publish",
            "POST",
            { confirmed: true },
            { headers: { Origin: "https://foreign.invalid" } },
          )
        ).status,
        403,
      );
    });
    await t.test(
      "invitations are single use; users have independent identities",
      async () => {
        const first = await createEmployee("employee1", one);
        uid1 = first.id;
        uid2 = (await createEmployee("employee2", two)).id;
        assert.equal(
          (
            await anon.call("/auth/activate", "POST", {
              token: first.invite.split("#")[1],
              password: pass,
            })
          ).status,
          400,
        );
        assert.notEqual(
          (await one.call("/auth/session")).data.user.id,
          (await two.call("/auth/session")).data.user.id,
        );
      },
    );
    await t.test(
      "employee cannot access admin routes or confirm others",
      async () => {
        assert.equal((await one.call("/admin/employees")).status, 403);
        assert.equal(
          (await one.call("/admin/settings", "PUT", {})).status,
          403,
        );
        assert.equal(
          (
            await admin.call("/attendance", "POST", {
              proof: "x".repeat(43),
              acknowledged: true,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await one.call("/attendance", "POST", {
              userId: uid2,
              proof: "x".repeat(43),
              acknowledged: true,
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "unconfirmed catalog cannot publish; admin manages verified meals",
      async () => {
        assert.equal(
          (await admin.call("/admin/day/publish", "POST", { confirmed: true }))
            .status,
          409,
        );
        const meals = (await admin.call("/admin/meals")).data;
        for (const m of meals) {
          const { id, ...b } = m;
          assert.equal(
            (
              await admin.call("/admin/meals/" + id, "PUT", {
                ...b,
                enabled: !!b.enabled,
                confirmed: true,
              })
            ).status,
            200,
          );
        }
        const s = (await admin.call("/admin/settings")).data;
        delete s.policyVersion;
        assert.equal(
          (
            await admin.call("/admin/settings", "PUT", {
              ...s,
              verification: 'gps',
              office: { lat: 15.3, lon: 44.2, radius: 100 },
            })
          ).status,
          200,
        );
        assert.equal(
          (await admin.call("/admin/day/publish", "POST", { confirmed: true }))
            .status,
          200,
        );
      },
    );
    const position = () => ({
      latitude: 15.3,
      longitude: 44.2,
      accuracy: 10,
      timestamp: now,
    });
    await t.test(
      "server validates GPS and issues session-bound one-use proof",
      async () => {
        assert.equal(
          (
            await one.call("/presence/verify", "POST", {
              position: { ...position(), latitude: 16 },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await one.call("/presence/verify", "POST", {
              position: { ...position(), accuracy: 200 },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await one.call("/presence/verify", "POST", {
              position: { ...position(), timestamp: now - 70000 },
            })
          ).status,
          403,
        );
        const r = await one.call("/presence/verify", "POST", {
          position: position(),
        });
        assert.equal(r.status, 200);
        proof = r.data.proof;
        assert.equal(
          (await two.call("/attendance", "POST", { proof, acknowledged: true }))
            .status,
          403,
        );
        assert.equal(
          (await one.call("/attendance", "POST", { proof, acknowledged: true }))
            .status,
          201,
        );
        assert.equal(
          (await one.call("/attendance", "POST", { proof, acknowledged: true }))
            .status,
          403,
        );
        assert.equal((await two.call("/today")).data.own.attendance, null);
      },
    );
    await t.test(
      "server computes double vote from three previous finalized losing days",
      async () => {
        for (let n = 3; n >= 1; n--) {
          const date = previousDay("2026-10-28", n),
            a = cutoff(date, "attendance"),
            v = cutoff(date, "voting");
          system.db
            .prepare("INSERT INTO days VALUES(?,1,900,?,?,?,'mandi',1)")
            .run(date, a, v, v);
          for (const m of system.db.prepare("SELECT * FROM meals").all())
            system.db
              .prepare("INSERT INTO day_meals(day,meal_id,name,description,price,restaurant,allergens,image) VALUES(?,?,?,?,?,?,?,?)")
              .run(
                date,
                m.id,
                m.name,
                m.description,
                m.price,
                m.restaurant,
                m.allergens,
                m.image,
              );
          system.db
            .prepare("INSERT INTO attendance VALUES(?,?,?,?,?)")
            .run(date, uid1, a - 60000, "gps", "1");
          system.db
            .prepare("INSERT INTO votes VALUES(?,?,?,?,?)")
            .run(date, uid1, "green", 1, a);
        }
        assert.equal((await one.call("/today")).data.own.weight, 2);
      },
    );
    await t.test(
      "non-attendee cannot vote; client cannot choose its weight",
      async () => {
        assert.equal(
          (await two.call("/votes", "POST", { mealId: "green" })).status,
          403,
        );
        assert.equal(
          (await one.call("/votes", "POST", { mealId: "green", weight: 2 }))
            .status,
          400,
        );
        assert.equal(
          (await one.call("/votes", "POST", { mealId: "green" })).status,
          200,
        );
        assert.equal(
          (await one.call("/votes", "POST", { mealId: "shawarma" })).status,
          200,
        );
        assert.equal(
          system.db
            .prepare("SELECT count(*) n FROM votes WHERE day=?")
            .get("2026-10-28").n,
          1,
        );
        assert.equal(
          (await one.call("/today")).data.own.vote.meal_id,
          "shawarma",
        );
        assert.equal((await one.call("/today")).data.own.vote.weight, 2);
      },
    );
    await t.test(
      "deadline uses server time and rejects outstanding proof at 11:00",
      async () => {
        const r = await two.call("/presence/verify", "POST", {
          position: position(),
        });
        assert.equal(r.status, 200);
        now = Date.parse("2026-10-28T11:00:00+03:00");
        assert.equal(
          (
            await two.call("/attendance", "POST", {
              proof: r.data.proof,
              acknowledged: true,
            })
          ).status,
          409,
        );
        const report = (await admin.call("/admin/report")).data;
        assert.equal(report.people.find((p) => p.id === uid2).status, "absent");
        assert.equal(report.count, 1);
        assert.equal(
          (await one.call("/votes", "POST", { mealId: "green" })).status,
          200,
        );
      },
    );
    await t.test(
      "automatic finalization at 11:15 freezes winner and vote count",
      async () => {
        now = Date.parse("2026-10-28T11:15:00+03:00");
        assert.equal(
          (await one.call("/votes", "POST", { mealId: "mandi" })).status,
          409,
        );
        const d = (await one.call("/today")).data;
        assert.equal(d.winnerId, "green");
        assert.equal(d.finalized, true);
        assert.equal(d.count, 1);
        const order = (await admin.call("/admin/order")).data;
        assert.equal(order.total, 800);
        assert.equal(order.ceiling, 900);
        assert.equal(order.saving, 100);
      },
    );
    await t.test("private reports, CSV escaping and audit events", async () => {
      assert.equal((await one.call("/admin/export")).status, 403);
      const r = await admin.call("/admin/export");
      assert.equal(r.status, 200);
      assert.match(r.data, /غائب عن الغداء/);
      const report = (await admin.call("/admin/report")).data;
      assert.ok(report.audit.some((a) => a.event === "day.finalized"));
      assert.ok(
        report.audit.some((a) => a.event === "attendance.self_confirmed"),
      );
    });
    await t.test(
      "password change revokes other sessions and preserves the current login",
      async () => {
        const sibling = client();
        assert.equal(
          (
            await sibling.call("/auth/login", "POST", {
              username: "employee1",
              password: pass,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await one.call("/auth/password", "POST", {
              currentPassword: pass,
              password: pass + " changed",
            })
          ).status,
          200,
        );
        assert.equal((await sibling.call("/today")).status, 401);
        assert.equal((await one.call("/today")).status, 200);
        assert.equal(
          (
            await sibling.call("/auth/login", "POST", {
              username: "employee1",
              password: pass,
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await sibling.call("/auth/login", "POST", {
              username: "employee1",
              password: pass + " changed",
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      "published menu and financial snapshots survive supplier edits",
      async () => {
        const m = (await admin.call("/admin/meals")).data.find(
          (m) => m.id === "green",
        );
        const { id, ...body } = m;
        assert.equal(
          (
            await admin.call("/admin/meals/" + id, "PUT", {
              ...body,
              enabled: true,
              confirmed: true,
              price: 700,
            })
          ).status,
          200,
        );
        assert.equal((await admin.call("/admin/order")).data.total, 800);
      },
    );
    await t.test(
      "disabling employee revokes sessions without removing financial history",
      async () => {
        assert.equal(
          (
            await admin.call("/admin/employees/" + uid1, "PATCH", {
              active: false,
            })
          ).status,
          200,
        );
        assert.equal((await one.call("/today")).status, 401);
        assert.equal((await admin.call("/admin/order")).data.count, 1);
      },
    );
    await t.test("meal CRUD accepts quantity without price, preserves published quantities and enforces roles", async () => {
      const body = { name:"وجبة جديدة", description:"مكونات وجبة جديدة", restaurant:"مورد جديد", allergens:"",image:"",enabled:true,confirmed:true,quantity:42 };
      assert.equal((await two.call("/admin/meals","POST",body)).status,403);
      assert.equal((await admin.call("/admin/meals","POST",{...body,quantity:0},{headers:{Origin:"http://127.0.0.1:3000"}})).status,400);
      assert.equal((await admin.call("/admin/meals","POST",body,{headers:{Origin:"http://evil.example"}})).status,403);
      assert.equal((await admin.call("/admin/meals","POST",{...body,quantity:0})).status,400);
      const created = await admin.call("/admin/meals","POST",body);
      assert.equal(created.status,201);
      const id = created.data.id;
      assert.equal((await admin.call('/admin/meals/'+id,'PUT',{...body,image:'javascript:alert(1)'})).status,400);
      assert.equal((await admin.call('/admin/meals/'+id,'PUT',{...body,image:'https://example.com/lunch.jpg'})).status,200);
      assert.equal((await admin.call('/admin/meals')).data.find(m=>m.id===id).image,'https://example.com/lunch.jpg');
      assert.equal((await admin.call("/admin/meals")).data.find(m=>m.id===id).quantity,42);
      assert.equal((await admin.call("/admin/meals/"+id,"PUT",{...body,quantity:55})).status,200);
      assert.equal((await admin.call("/admin/meals")).data.find(m=>m.id===id).quantity,55);
      assert.equal((await admin.call("/admin/meals/"+id,"DELETE")).status,200);
      assert.equal((await admin.call("/admin/meals/"+id,"DELETE")).status,404);
      assert.equal(system.db.prepare("SELECT quantity FROM day_meals WHERE day='2026-10-28' AND meal_id='green'").get().quantity,30);
    });
    await t.test('image uploads require admin, reject fake files and serve saved images',async()=>{
      const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
      assert.equal((await two.call('/admin/images','POST',{data:png})).status,403);
      assert.equal((await admin.call('/admin/images','POST',{data:Buffer.from('<svg>bad</svg>').toString('base64')})).status,400);
      assert.equal((await admin.call('/admin/images','POST',{data:Buffer.alloc(4*1024*1024+1).toString('base64')})).status,400);
      const uploaded=await admin.call('/admin/images','POST',{data:png});
      assert.equal(uploaded.status,201);
      assert.match(uploaded.data.url,/^\/uploads\/[a-f0-9-]+\.png$/);
      const response=await fetch(base+uploaded.data.url);
      assert.equal(response.status,200);
      assert.match(response.headers.get('content-type'),/image\/png/);
      assert.equal(Buffer.from(await response.arrayBuffer()).toString('base64'),png);
      const m=(await admin.call('/admin/meals')).data.find(m=>m.id==='green');
      const {id,...body}=m;
      assert.equal((await admin.call('/admin/meals/'+id,'PUT',{...body,enabled:true,confirmed:true,image:uploaded.data.url})).status,200);
    });
    await t.test("logout invalidates the server session", async () => {
      assert.equal((await two.call("/auth/logout", "POST", {})).status, 200);
      assert.equal((await two.call("/today")).status, 401);
    });
    await t.test(
      "scheduler publishes the next day and finalizes a zero-vote day without inventing a winner",
      async () => {
        const s = (await admin.call("/admin/settings")).data;
        delete s.policyVersion;
        assert.equal(
          (
            await admin.call("/admin/settings", "PUT", {
              ...s,
              autoPublish: true,
            })
          ).status,
          200,
        );
        now = Date.parse("2026-10-29T10:00:00+03:00");
        system.sync();
        assert.equal(
          system.db
            .prepare("SELECT published FROM days WHERE day=?")
            .get("2026-10-29").published,
          1,
        );
        now = Date.parse("2026-10-29T11:15:00+03:00");
        system.sync();
        const d = system.db
          .prepare("SELECT * FROM days WHERE day=?")
          .get("2026-10-29");
        assert.equal(d.winner_id, null);
        assert.equal(d.final_count, 0);
        assert.ok(d.finalized_at);
      },
    );
    system.db.prepare("DELETE FROM meals WHERE id='mandi'").run();
  } finally {
    await new Promise((r) => server.close(r));
    system.close();
  }
  try {
    const restored = createApp({ dbPath, clock: () => now, origin });
    assert.equal(restored.db.prepare("SELECT id FROM meals WHERE id='mandi'").get(),undefined);
    assert.equal(
      restored.db
        .prepare("SELECT count(*) n FROM attendance WHERE day=?")
        .get("2026-10-28").n,
      1,
    );
    assert.equal(
      restored.db
        .prepare("SELECT winner_id FROM days WHERE day=?")
        .get("2026-10-28").winner_id,
      "green",
    );
    restored.close();
  } finally {
    if (
      !resolve(dir).startsWith(resolve(tmpdir()) + sep) ||
      !basename(dir).startsWith("luqma-test-")
    )
      throw Error("Refusing to remove an unexpected test path");
    rmSync(dir, { recursive: true, force: true });
  }
});
