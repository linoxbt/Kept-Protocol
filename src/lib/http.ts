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

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
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
  return clientIpInfo(req).ip;
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

/** Idempotency keys are scoped to the caller's credential, so one caller can never replay another's response. */
function idempotencyScope(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const cookie = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)kept_session=([^;]*)/)?.[1] ?? "";
  return createHash("sha256").update(`${auth}\n${cookie}`).digest("hex").slice(0, 32);
}

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

/** Wraps a handler with error mapping and, for POSTs carrying Idempotency-Key, response replay. */
export function route<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    const url = new URL(req.url);
    const raw = req.method === "POST" ? req.headers.get("idempotency-key") : null;
    try {
      if (raw && raw.length > 200) throw new Problem(400, "Invalid Idempotency-Key", "keys are at most 200 characters");
      const key = raw ? `${idempotencyScope(req)}:${raw}` : null;
      if (key) {
        const [hitRow] = await db()<{ status: number; body: string }[]>`select status, body from idempotency_keys where key = ${key} and route = ${url.pathname}`;
        if (hitRow) return new Response(hitRow.body, { status: hitRow.status, headers: { "content-type": "application/json", "idempotent-replayed": "true" } });
      }
      const res = await handler(req, ctx);
      if (key && res.status < 500) {
        const body = await res.clone().text();
        await db()`insert into idempotency_keys (key, route, status, body) values (${key}, ${url.pathname}, ${res.status}, ${body}) on conflict do nothing`;
      }
      return res;
    } catch (e) {
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
