/**
 * HTTP helpers for route handlers: RFC 9457 problem details, signed JSON responses
 * (Kept-Signature: EIP-191 over the SHA-256 of the body), Zod request parsing, idempotency and a
 * single error mapper so every endpoint fails the same way.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { db } from "@/db/client";
import { CaptureError } from "@/extraction/capture";
import { signBody } from "@/receipts/signer";
import { ServError } from "@/serv/client";
import { RateLimited } from "@/services/preview";
import { Conflict, Invalid, NotFound } from "@/services/sources";

export class Problem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(detail ?? title);
  }
}

export function problem(status: number, title: string, detail?: string, instance?: string, headers: Record<string, string> = {}): Response {
  const body = { type: `https://kept.dev/problems/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, title, status, detail, instance };
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/problem+json", ...headers } });
}

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export async function json(data: unknown, init: { status?: number; sign?: boolean; headers?: Record<string, string>; cache?: string } = {}): Promise<Response> {
  const body = JSON.stringify(data, replacer);
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": init.cache ?? "no-store", ...(init.headers ?? {}) };
  if (init.sign) {
    const { signature, signer } = await signBody(body);
    headers["kept-signature"] = signature;
    headers["kept-signer"] = signer;
  }
  return new Response(body, { status: init.status ?? 200, headers });
}

/** Largest JSON body any endpoint accepts. Pasted try-it text is capped well below this by its schema. */
export const MAX_JSON_BYTES = 256 * 1024;
/** Largest form body (admin sign-in and setup). */
export const MAX_FORM_BYTES = 16 * 1024;

/**
 * Reads a request body with a hard byte cap, refusing early on a declared Content-Length and
 * aborting mid-stream otherwise, so a huge body is never buffered into memory. Route handlers
 * have no default limit (the edge can be bypassed by calling the origin directly).
 */
export async function readCapped(req: Request, max: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) throw new Problem(413, "Payload too large", `the request body is limited to ${Math.round(max / 1024)} KB`);
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Problem(413, "Payload too large", `the request body is limited to ${Math.round(max / 1024)} KB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads a small urlencoded or multipart form with the byte cap; null when it cannot be parsed. */
export async function readForm(req: Request): Promise<FormData | null> {
  const text = await readCapped(req, MAX_FORM_BYTES);
  try {
    return await new Response(text, { headers: { "content-type": req.headers.get("content-type") ?? "application/x-www-form-urlencoded" } }).formData();
  } catch {
    return null;
  }
}

/**
 * A redirect target from user input, accepted only if it resolves to a path on this site.
 * Prefix checks alone miss "/\t/evil.example": browsers strip the tab and leave "//evil.example".
 */
export function safeRedirectPath(next: string, fallback: string): string {
  if (!next.startsWith("/") || /[\u0000-\u001f\\]/.test(next)) return fallback;
  try {
    const base = "https://kept.invalid";
    const u = new URL(next, base);
    return u.origin === base ? `${u.pathname}${u.search}${u.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  const text = await readCapped(req, MAX_JSON_BYTES);
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Problem(400, "Invalid JSON", "the request body is not valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Problem(422, "Validation failed", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return parsed.data;
}

/**
 * SHA-256 of the secret header the Netlify edge adds to every proxied request (x-kept-edge). Only
 * the hash is in the repository; the token itself lives in the deployed Netlify configuration.
 * KEPT_EDGE_TOKEN_SHA256 overrides it.
 */
const EDGE_TOKEN_SHA256 = "e0c3408dc352cf92f43033e468fef7ee024213f619f74fd361911be0f9728c85";

/**
 * The caller's IP, from headers a client cannot forge:
 *  1. via the Netlify edge (proved by the x-kept-edge header), Netlify's x-nf-client-connection-ip;
 *  2. otherwise Railway's x-real-ip, which the platform sets to the connecting address;
 *  3. otherwise the right-most X-Forwarded-For hop (appended by the nearest proxy).
 * Until the edge sends its header (KEPT_EDGE_STRICT unset), x-nf-client-connection-ip is also
 * accepted unproven, so visitors behind the edge do not all share Netlify's address.
 * The left-most X-Forwarded-For entry is never used: the client writes it.
 */
export function clientIp(req: Request): string {
  return rateLimitIdentity(clientIpInfo(req).ip);
}

/**
 * The identity rate limits key on. An IPv6 client controls at least a /64 (2^64 addresses), so
 * limiting per full address would not limit it at all; IPv6 is keyed on its /64 prefix.
 * IPv4-mapped IPv6 is treated as the IPv4 address.
 */
export function rateLimitIdentity(ip: string): string {
  const a = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!a.includes(":")) return a;
  const mapped = a.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  const [head, tail] = a.includes("::") ? a.split("::") : [a, null];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  if (right.length && right[right.length - 1].includes(".")) right.splice(-1, 1, "0", "0"); // embedded IPv4 tail
  const groups = tail === null ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return a;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export function clientIpInfo(req: Request): { ip: string; source: "edge" | "edge-unverified" | "real-ip" | "xff" | "none" } {
  const nf = req.headers.get("x-nf-client-connection-ip")?.trim();
  const given = req.headers.get("x-kept-edge");
  if (nf && given) {
    const want = Buffer.from(process.env.KEPT_EDGE_TOKEN_SHA256 ?? EDGE_TOKEN_SHA256, "hex");
    const got = createHash("sha256").update(given).digest();
    if (want.length === got.length && timingSafeEqual(want, got)) return { ip: nf, source: "edge" };
  }
  if (nf && process.env.KEPT_EDGE_STRICT !== "1") return { ip: nf, source: "edge-unverified" };
  const real = req.headers.get("x-real-ip");
  if (real) return { ip: real.trim(), source: "real-ip" };
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length) return { ip: hops[hops.length - 1], source: "xff" };
  }
  return { ip: "unknown", source: "none" };
}

/**
 * Idempotency keys are scoped to the caller's credential, so one caller can never replay another's
 * response. Anonymous callers share no credential, so they get no idempotency (null): their keys
 * would be replayable by anyone who guessed them, and would let anyone grow the table.
 */
function idempotencyScope(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  const cookie = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)kept_session=([^;]*)/)?.[1] ?? "";
  if (!auth && !cookie) return null;
  return createHash("sha256").update(`${auth}\n${cookie}`).digest("hex").slice(0, 32);
}

/** Placeholder status while the first request for a key is still running. */
const IDEMPOTENCY_IN_FLIGHT = 0;

export function toProblem(e: unknown, instance?: string): Response {
  if (e instanceof Problem) return problem(e.status, e.title, e.detail, instance, e.headers);
  if (e instanceof NotFound) return problem(404, "Not found", e.message, instance);
  if (e instanceof Invalid) return problem(422, "Unprocessable", e.message, instance);
  if (e instanceof Conflict) return problem(409, "Conflict", e.message, instance);
  if (e instanceof RateLimited) return problem(429, "Too many requests", e.message, instance, { "retry-after": String(Math.max(1, Math.ceil((e.resetAt.getTime() - Date.now()) / 1000))) });
  if (e instanceof CaptureError) return problem(e.code === "blocked" ? 400 : 422, "Source capture failed", e.message, instance);
  if (e instanceof ServError) {
    const status = e.kind === "not_configured" || e.kind === "circuit_open" || e.kind === "budget" ? 503 : e.kind === "rate_limited" ? 429 : 502;
    return problem(status, "SERV unavailable", `${e.message}. New extractions are paused; monitoring is unaffected.`, instance);
  }
  console.error("[kept] unhandled error", e);
  return problem(500, "Internal error", "something went wrong; the error was logged", instance);
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/**
 * Wraps a handler with error mapping and, for authenticated POSTs carrying Idempotency-Key, response
 * replay. The key is claimed with an insert BEFORE the handler runs, so two concurrent requests with
 * the same key cannot both run; only successful (2xx) responses are kept, for 24 hours.
 */
export function route<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    const url = new URL(req.url);
    const raw = req.method === "POST" ? req.headers.get("idempotency-key") : null;
    let claimed: string | null = null;
    try {
      if (raw && raw.length > 200) throw new Problem(400, "Invalid Idempotency-Key", "keys are at most 200 characters");
      const scope = raw ? idempotencyScope(req) : null;
      const key = scope ? `${scope}:${raw}` : null;
      if (key) {
        const sql = db();
        if (Math.random() < 0.02) await sql`delete from idempotency_keys where created_at < now() - interval '24 hours'`;
        // A claim left by a process that died mid-request (deploy, crash) is taken over after 5 minutes.
        const [mine] = await sql`insert into idempotency_keys (key, route, status, body) values (${key}, ${url.pathname}, ${IDEMPOTENCY_IN_FLIGHT}, '')
                                 on conflict (key, route) do update set created_at = now()
                                   where idempotency_keys.status = ${IDEMPOTENCY_IN_FLIGHT} and idempotency_keys.created_at < now() - interval '5 minutes'
                                 returning key`;
        if (!mine) {
          const [prev] = await sql<{ status: number; body: string }[]>`select status, body from idempotency_keys where key = ${key} and route = ${url.pathname}`;
          if (prev && prev.status !== IDEMPOTENCY_IN_FLIGHT) return new Response(prev.body, { status: prev.status, headers: { "content-type": "application/json", "idempotent-replayed": "true" } });
          throw new Problem(409, "Request in progress", "a request with this Idempotency-Key is still running; retry shortly");
        }
        claimed = key;
      }
      const res = await handler(req, ctx);
      if (claimed) {
        const key = claimed;
        claimed = null;
        // The request already succeeded or failed; a failure to record that must not change the response.
        try {
          if (res.status >= 200 && res.status < 300) {
            const body = await res.clone().text();
            await db()`update idempotency_keys set status = ${res.status}, body = ${body} where key = ${key} and route = ${url.pathname}`;
          } else {
            await db()`delete from idempotency_keys where key = ${key} and route = ${url.pathname}`;
          }
        } catch (e) {
          console.error("[kept] could not record idempotency result", e);
        }
      }
      return res;
    } catch (e) {
      if (claimed) await db()`delete from idempotency_keys where key = ${claimed} and route = ${url.pathname}`.catch(() => {});
      return toProblem(e, url.pathname);
    }
  };
}

export function baseUrl(req?: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  if (req) {
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  }
  return "http://localhost:3000";
}

/**
 * 303 redirect with a relative Location. Behind a proxy (Netlify → Railway) the request URL is the
 * internal address, so absolute redirects built from it would send browsers to the wrong host.
 */
export function seeOther(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
