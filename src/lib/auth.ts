/**
 * Admin authentication. Writes (confirming drafts, running checks, versions, Hindcast jobs,
 * webhooks, disputes) need the admin: a Bearer key (KEPT_ADMIN_KEY, if set) or the admin
 * password, or the HMAC-signed, HttpOnly session cookie set at login. Everything evidential is
 * public to read.
 *
 * Brute force: every failed credential check counts against the caller's IP (10 per 15 min) and a
 * global budget (60 per 15 min). Both are checked BEFORE the scrypt comparison, so guessing is
 * slow and cannot be used to burn CPU. Sessions carry an epoch; signing out bumps it and revokes
 * every outstanding session.
 */
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/db/client";
import { hit, peek } from "@/services/ratelimit";
import { env } from "./env";
import { clientIp, Problem } from "./http";
import { verifyPassword } from "./secrets";

export const SESSION_COOKIE = "kept_session";
const SESSION_TTL_S = 12 * 3600;
const DEV_ADMIN_KEY = "dev-admin-key-change-me-0000000000";
const FAIL_WINDOW_S = 900;
const FAIL_PER_IP = 10;
const FAIL_GLOBAL = 60;

function devMode(): boolean {
  return env().NODE_ENV !== "production" || process.env.KEPT_ALLOW_DEV_KEYS === "1";
}

function secret(): string {
  const e = env();
  return e.KEPT_SESSION_SECRET ?? createHash("sha256").update(`session:${e.KEPT_ADMIN_KEY ?? DEV_ADMIN_KEY}`).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
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

/** Setup needs the one-time token from the server log (or any token in development). */
export function setupTokenValid(candidate: string): boolean {
  const t = process.env.ADMIN_SETUP_TOKEN;
  if (!t) return devMode();
  return safeEqual(candidate.trim(), t);
}

async function checkAdminKey(candidate: string): Promise<boolean> {
  if (!candidate) return false;
  const key = env().KEPT_ADMIN_KEY;
  if (key && safeEqual(candidate, key)) return true;
  const hash = await adminPasswordHash();
  if (hash && verifyPassword(candidate, hash)) return true;
  return devMode() && !key && !hash && safeEqual(candidate, DEV_ADMIN_KEY);
}

/**
 * Checks a credential with brute-force protection. Throws 429 when the caller or the deployment
 * has used up its failure budget; records a failure otherwise.
 */
export async function verifyCredential(req: Request, candidate: string): Promise<boolean> {
  const ip = clientIp(req);
  const [mine, all] = await Promise.all([peek(`authfail:${ip}`, FAIL_PER_IP, FAIL_WINDOW_S), peek("authfail:*", FAIL_GLOBAL, FAIL_WINDOW_S)]);
  if (!mine.allowed || !all.allowed) {
    const reset = (mine.allowed ? all : mine).resetAt;
    throw new Problem(429, "Too many requests", "too many failed sign-in attempts; try again later", {
      "retry-after": String(Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000))),
    });
  }
  if (await checkAdminKey(candidate)) return true;
  await Promise.all([hit(`authfail:${ip}`, FAIL_PER_IP, FAIL_WINDOW_S), hit("authfail:*", FAIL_GLOBAL, FAIL_WINDOW_S)]);
  // Uniform delay so a failure costs the guesser time, not the server CPU.
  await new Promise((r) => setTimeout(r, 200 + randomInt(200)));
  return false;
}

let epochCache: { value: number; at: number } | null = null;

async function sessionEpoch(): Promise<number> {
  if (epochCache && Date.now() - epochCache.at < 5_000) return epochCache.value;
  let value = 0;
  try {
    const [r] = await db()<{ value: string }[]>`select value from kept_secrets where name = 'SESSION_EPOCH'`;
    value = Number(r?.value ?? 0) || 0;
  } catch {
    value = 0;
  }
  epochCache = { value, at: Date.now() };
  return value;
}

/** Revokes every outstanding admin session. */
export async function revokeSessions(): Promise<void> {
  await db()`insert into kept_secrets (name, value) values ('SESSION_EPOCH', '1')
             on conflict (name) do update set value = (kept_secrets.value::bigint + 1)::text`;
  epochCache = null;
}

function mac(epoch: number, exp: number): string {
  return createHmac("sha256", secret()).update(`admin.${epoch}.${exp}`).digest("hex");
}

export async function createSession(now = Math.floor(Date.now() / 1000)): Promise<{ value: string; maxAge: number }> {
  const exp = now + SESSION_TTL_S;
  return { value: `${exp}.${mac(await sessionEpoch(), exp)}`, maxAge: SESSION_TTL_S };
}

export async function validSession(value: string | undefined | null, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!value) return false;
  const [expStr, given] = value.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now || !given) return false;
  return safeEqual(given, mac(await sessionEpoch(), exp));
}

export function sessionCookieHeader(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(v.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function isAdminRequest(req: Request): Promise<boolean> {
  if (await validSession(cookieValue(req, SESSION_COOKIE))) return true;
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return verifyCredential(req, auth.slice(7).trim());
}

export async function requireAdmin(req: Request): Promise<void> {
  if (!(await isAdminRequest(req))) {
    throw new Problem(401, "Unauthorized", "this action needs the admin (Authorization: Bearer <admin key>) or an admin session", {
      "www-authenticate": 'Bearer realm="kept"',
    });
  }
}

export function reviewerName(req: Request): string {
  return (req.headers.get("x-kept-reviewer") ?? "admin").slice(0, 80);
}
