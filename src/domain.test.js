import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankDay,
  seedDay,
  seedHistory,
  dayKey,
  cutoff,
  selfAttend,
  castVote,
  finalize,
  pickWinner,
  voteWeight,
  previousDay,
  withinOffice,
  attendanceCSV,
} from "./domain.js";
const day = "2026-10-27",
  at = (t) => Date.parse(`${day}T${t}:00+03:00`);
const request = {
  id: "e25",
  day,
  now: at("10:59"),
  verifiedAt: at("10:59"),
  method: "demo",
  acknowledged: true,
};
test("Aden day rolls over independently of UTC", () =>
  assert.equal(dayKey(Date.parse("2026-10-26T21:01:00Z")), day));
test("employee may self-confirm before deadline", () =>
  assert.ok(selfAttend(blankDay(), request).attendance.e25));
test("attendance closes exactly at 11:00", () =>
  assert.throws(
    () =>
      selfAttend(blankDay(), { ...request, now: cutoff(day, "attendance") }),
    /انتهى/,
  ));
test("cannot confirm somebody else", () =>
  assert.throws(
    () => selfAttend(blankDay(), { ...request, id: "e1" }),
    /شخص آخر/,
  ));
test("duplicate self-confirmation rejected", () =>
  assert.throws(
    () => selfAttend(selfAttend(blankDay(), request), request),
    /بالفعل/,
  ));
test("unverified, stale and unacknowledged confirmations rejected", () => {
  for (const changes of [
    { method: null },
    { verifiedAt: at("10:57") },
    { acknowledged: false },
  ])
    assert.throws(() => selfAttend(blankDay(), { ...request, ...changes }));
});
test("a previous-day request is rejected", () =>
  assert.throws(() =>
    selfAttend(blankDay(), { ...request, day: previousDay(day) }),
  ));
test("three consecutive losing days earn double weight", () =>
  assert.equal(voteWeight(seedHistory(day), "e25", day), 2));
test("a missing day or a winning vote resets the streak", () => {
  const h = seedHistory(day);
  assert.equal(voteWeight(h.slice(0, 2), "e25", day), 1);
  assert.equal(
    voteWeight(
      h.map((r) => ({ ...r, winner: "green" })),
      "e25",
      day,
    ),
    1,
  );
});
test("non-attendee cannot vote", () =>
  assert.throws(() =>
    castVote(blankDay(), {
      id: "e25",
      mealId: "green",
      now: at("11:01"),
      day,
      history: [],
    }),
  ));
test("changing choice replaces the weighted vote", () => {
  let r = selfAttend(seedDay(day), request);
  for (const mealId of ["green", "shawarma"])
    r = castVote(r, {
      id: "e25",
      mealId,
      now: at("11:01"),
      day,
      history: seedHistory(day),
    });
  assert.equal(Object.keys(r.votes).length, 25);
  assert.deepEqual(r.votes.e25, { mealId: "shawarma", weight: 2 });
});
test("voting is allowed until 11:15 and rejected at boundary", () => {
  const r = selfAttend(blankDay(), request);
  assert.ok(
    castVote(r, {
      id: "e25",
      mealId: "green",
      now: at("11:14"),
      day,
      history: [],
    }),
  );
  assert.throws(() =>
    castVote(r, {
      id: "e25",
      mealId: "green",
      now: at("11:15"),
      day,
      history: [],
    }),
  );
});
test("winner is not finalized early; finalization is idempotent", () => {
  const r = seedDay(day);
  assert.equal(finalize(r, at("11:14"), day), r);
  const f = finalize(r, at("11:15"), day);
  assert.equal(f.result.winner, "mandi");
  assert.equal(finalize(f, at("11:16"), day), f);
});
test("tie is resolved by lower price and empty election has no winner", () => {
  const r = blankDay();
  r.votes = {
    a: { mealId: "mandi", weight: 2 },
    b: { mealId: "green", weight: 2 },
  };
  assert.equal(pickWinner(r).id, "green");
  assert.equal(finalize(blankDay(), at("11:16"), day).result.winner, null);
});
test("geofence rejects inaccurate, stale and outside readings", () => {
  const now = at("10:30"),
    office = { lat: 15.3, lon: 44.2, radius: 100 };
  const p = {
    timestamp: now,
    coords: { latitude: 15.3, longitude: 44.2, accuracy: 10 },
  };
  assert.equal(withinOffice(p, office, now).ok, true);
  assert.equal(
    withinOffice({ ...p, coords: { ...p.coords, accuracy: 200 } }, office, now)
      .ok,
    false,
  );
  assert.equal(
    withinOffice({ ...p, timestamp: now - 61000 }, office, now).ok,
    false,
  );
  assert.equal(
    withinOffice({ ...p, coords: { ...p.coords, latitude: 16 } }, office, now)
      .ok,
    false,
  );
});
test("unconfirmed people become absent after deadline in export", () => {
  const csv = attendanceCSV(seedDay(day), day, at("11:01"));
  assert.equal((csv.match(/غائب عن الغداء/g) || []).length, 8);
  assert.equal((csv.match(/حضور ذاتي/g) || []).length, 24);
});
