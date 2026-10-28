import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

export const token = () => randomBytes(32).toString("base64url");
export const hash = (s) => createHash("sha256").update(s).digest("hex");

export async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const hex = [...new Uint8Array(derived)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${salt}:${hex}:100000`;
}

export async function passwordMatches(password, stored) {
  const parts = stored?.split(":") || [];
  if (parts[0] !== "pbkdf2") return false;
  const [, salt, expected, iterations] = parts;
  if (!salt) return false;
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: Number(iterations) || 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const actual = [...new Uint8Array(derived)].map(b => b.toString(16).padStart(2, '0')).join('');
  try {
    return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex")) && !!salt;
  } catch {
    return false;
  }
}

function isIP(str) {
  if (typeof str !== "string") return 0;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(str)) {
    return str.split(".").every(o => Number(o) >= 0 && Number(o) <= 255) ? 4 : 0;
  }
  if (/^[0-9a-fA-F:]+$/.test(str) && str.includes(":")) return 6;
  return 0;
}

function ipToInt(ip) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function checkSubnet(ip, network, prefix) {
  const ipInt = ipToInt(ip);
  const netInt = ipToInt(network);
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

export function networkMatches(address, ranges) {
  const ip = address?.replace(/^::ffff:/, "");
  if (!isIP(ip) || ip === "::1" || ip.startsWith("127.")) return false;
  for (const entry of ranges) {
    const [network, prefix] = entry.split("/");
    const kind = isIP(network);
    if (!kind) continue;
    if (kind === 4 && isIP(ip) === 4) {
      if (prefix === undefined) {
        if (ip === network) return true;
      } else {
        if (checkSubnet(ip, network, Number(prefix))) return true;
      }
    }
  }
  return false;
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
