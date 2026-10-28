import {
  randomBytes,
  createHash,
  scrypt as rawScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { BlockList, isIP } from "node:net";
const scrypt = promisify(rawScrypt);
export const token = () => randomBytes(32).toString("base64url");
export const hash = (s) => createHash("sha256").update(s).digest("hex");
export async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function passwordMatches(password, stored) {
  const [, salt, expected] = stored?.split(":") || [];
  const actual = await scrypt(password, salt || "invalid-user-fixed-salt", 64);
  const target = Buffer.from(expected || "00".repeat(64), "hex");
  return (
    target.length === actual.length && timingSafeEqual(actual, target) && !!salt
  );
}
export function networkMatches(address, ranges) {
  const ip = address?.replace(/^::ffff:/, "");
  if (!isIP(ip) || ip === "::1" || ip.startsWith("127.")) return false;
  const list = new BlockList();
  for (const entry of ranges) {
    const [network, prefix] = entry.split("/");
    const kind = isIP(network);
    if (!kind) continue;
    try {
      if (prefix === undefined)
        list.addAddress(network, kind === 4 ? "ipv4" : "ipv6");
      else
        list.addSubnet(network, Number(prefix), kind === 4 ? "ipv4" : "ipv6");
    } catch {}
  }
  return list.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
}
export function validNetwork(entry) {
  const [ip, prefix, ...rest] = entry.split("/");
  const kind = isIP(ip);
  return (
    !!kind &&
    !rest.length &&
    !(ip === "::1" || ip.startsWith("127.")) &&
    (prefix === undefined ||
      (/^\d+$/.test(prefix) &&
        Number(prefix) > 0 &&
        Number(prefix) <= (kind === 4 ? 32 : 128)))
  );
}
