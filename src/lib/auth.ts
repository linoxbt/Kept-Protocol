/**
 * Admin authentication. Writes (confirming drafts, running checks, versions, Hindcast jobs,
 * webhooks) need the admin key, sent as `Authorization: Bearer <key>` or held in an HMAC-signed,
 * HttpOnly session cookie set by /api/admin/login. Everything evidential is public to read.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { Problem } from "./http";

export const SESSION_COOKIE = "kept_session";
const SESSION_TTL_S = 12 * 3600;
const DEV_ADMIN_KEY = "dev-admin-key-change-me-0000000000";

export function adminKey(): string | null {
  const e = env();
  if (e.KEPT_ADMIN_KEY) return e.KEPT_ADMIN_KEY;
  return e.NODE_ENV === "production" && process.env.KEPT_ALLOW_DEV_KEYS !== "1" ? null : DEV_ADMIN_KEY;
}

function secret(): string {
  const e = env();
  return e.KEPT_SESSION_SECRET ?? createHash("sha256").update(`session:${adminKey() ?? "none"}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkAdminKey(candidate: string): boolean {
  const key = adminKey();
  return !!key && safeEqual(candidate, key);
}

export function createSession(now = Math.floor(Date.now() / 1000)): { value: string; maxAge: number } {
  const exp = now + SESSION_TTL_S;
  const mac = createHmac("sha256", secret()).update(`admin.${exp}`).digest("hex");
  return { value: `${exp}.${mac}`, maxAge: SESSION_TTL_S };
}

export function validSession(value: string | undefined | null, now = Math.floor(Date.now() / 1000)): boolean {
  if (!value) return false;
  const [expStr, mac] = value.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now || !mac) return false;
  const expected = createHmac("sha256", secret()).update(`admin.${exp}`).digest("hex");
  return safeEqual(mac, expected);
}

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function isAdminRequest(req: Request): boolean {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && checkAdminKey(auth.slice(7).trim())) return true;
  return validSession(cookieValue(req, SESSION_COOKIE));
}

export function requireAdmin(req: Request): void {
  if (!isAdminRequest(req)) throw new Problem(401, "Unauthorized", "this action needs the admin key (Authorization: Bearer …) or an admin session", { "www-authenticate": 'Bearer realm="kept"' });
}

export function reviewerName(req: Request): string {
  return (req.headers.get("x-kept-reviewer") ?? "admin").slice(0, 80);
}
