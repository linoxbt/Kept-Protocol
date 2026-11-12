/**
 * Admin authentication. Writes (confirming drafts, running checks, versions, Hindcast jobs,
 * webhooks) need the admin: a Bearer key (KEPT_ADMIN_KEY, if set) or the admin password, or the
 * HMAC-signed, HttpOnly session cookie set at login. Everything evidential is public to read.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/db/client";
import { env } from "./env";
import { Problem } from "./http";
import { verifyPassword } from "./secrets";

export const SESSION_COOKIE = "kept_session";
const SESSION_TTL_S = 12 * 3600;
const DEV_ADMIN_KEY = "dev-admin-key-change-me-0000000000";

function devMode(): boolean {
  return env().NODE_ENV !== "production" || process.env.KEPT_ALLOW_DEV_KEYS === "1";
}

function secret(): string {
  const e = env();
  return e.KEPT_SESSION_SECRET ?? createHash("sha256").update(`session:${e.KEPT_ADMIN_KEY ?? DEV_ADMIN_KEY}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function adminPasswordHash(): Promise<string | null> {
  try {
    const [r] = await db()<{ value: string }[]>`select value from kept_secrets where name = 'ADMIN_PASSWORD_HASH'`;
    return r?.value ?? null;
  } catch {
    return null;
  }
}

/** True when no admin credential exists yet, so /admin/setup may create one. */
export async function adminSetupOpen(): Promise<boolean> {
  if (env().KEPT_ADMIN_KEY) return false;
  return (await adminPasswordHash()) === null;
}

export async function checkAdminKey(candidate: string): Promise<boolean> {
  if (!candidate) return false;
  const key = env().KEPT_ADMIN_KEY;
  if (key && safeEqual(candidate, key)) return true;
  const hash = await adminPasswordHash();
  if (hash && verifyPassword(candidate, hash)) return true;
  return devMode() && !key && !hash && safeEqual(candidate, DEV_ADMIN_KEY);
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

export function sessionCookieHeader(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
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

export async function isAdminRequest(req: Request): Promise<boolean> {
  if (validSession(cookieValue(req, SESSION_COOKIE))) return true;
  const auth = req.headers.get("authorization");
  return !!auth?.startsWith("Bearer ") && (await checkAdminKey(auth.slice(7).trim()));
}

export async function requireAdmin(req: Request): Promise<void> {
  if (!(await isAdminRequest(req))) {
    throw new Problem(401, "Unauthorized", "this action needs the admin (Authorization: Bearer <admin password or key>) or an admin session", {
      "www-authenticate": 'Bearer realm="kept"',
    });
  }
}

export function reviewerName(req: Request): string {
  return (req.headers.get("x-kept-reviewer") ?? "admin").slice(0, 80);
}
