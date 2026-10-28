import { test } from "node:test";
import assert from "node:assert/strict";
import {
  networkMatches,
  validNetwork,
  passwordHash,
  passwordMatches,
} from "./security.js";
test("network allowlist accepts exact company subnets and rejects loopback/outside addresses", () => {
  assert.equal(validNetwork("192.168.10.0/24"), true);
  assert.equal(validNetwork("127.0.0.1"), false);
  assert.equal(validNetwork("0.0.0.0/0"), false);
  assert.equal(validNetwork("not-an-ip"), false);
  assert.equal(
    networkMatches("::ffff:192.168.10.35", ["192.168.10.0/24"]),
    true,
  );
  assert.equal(networkMatches("192.168.11.35", ["192.168.10.0/24"]), false);
  assert.equal(networkMatches("::1", ["::/64"]), false);
  assert.equal(networkMatches("203.0.113.9", ["203.0.113.9"]), true);
});
test("passwords are salted and validated without storing plaintext", async () => {
  const a = await passwordHash("long test password 123"),
    b = await passwordHash("long test password 123");
  assert.notEqual(a, b);
  assert.equal(a.includes("long test"), false);
  assert.equal(await passwordMatches("long test password 123", a), true);
  assert.equal(await passwordMatches("wrong password", a), false);
  assert.equal(await passwordMatches("any password", null), false);
});
