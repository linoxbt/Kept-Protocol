/**
 * Source capture. All source content is untrusted input.
 *
 * SSRF protection: only http(s) on ports 80/443; every DNS answer is checked against private,
 * loopback, link-local and reserved ranges INSIDE the connection's own lookup (so a rebinding
 * answer cannot slip in between check and connect); redirects are followed manually, at most 3,
 * each re-checked; 10 MB and 15 s limits.
 */
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { sha256Hex } from "@/receipts/receipt";

export const MAX_BYTES = 10 * 1024 * 1024;
export const TIMEOUT_MS = 15_000;

export class CaptureError extends Error {
  constructor(
    message: string,
    readonly code: "blocked" | "fetch_failed" | "too_large" | "not_text" | "empty" | "js_only",
  ) {
    super(message);
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (v === 6) {
    const a = ip.toLowerCase();
    if (a === "::" || a === "::1") return true;
    if (a.startsWith("::ffff:")) return isBlockedIp(a.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(a.replace(/^0+/, "")) || a.startsWith("64:ff9b") || a.startsWith("2001:db8");
  }
  return true;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

function safeLookup(hostname: string, options: { all?: boolean } & object, cb: LookupCb): void {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    const list = addresses as { address: string; family: number }[];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (bad || list.length === 0) {
      const e = new Error(`blocked address for ${hostname}`) as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return cb(e, "");
    }
    if ((options as { all?: boolean }).all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

/** Undici dispatcher whose DNS lookup refuses private, loopback and reserved addresses (rebinding-safe). */
export const safeDispatcher = new Agent({ connect: { lookup: safeLookup as never, timeout: TIMEOUT_MS }, bodyTimeout: TIMEOUT_MS, headersTimeout: TIMEOUT_MS });

export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CaptureError("not a valid URL", "blocked");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new CaptureError("only http and https URLs are allowed", "blocked");
  if (url.port && url.port !== "80" && url.port !== "443") throw new CaptureError("only ports 80 and 443 are allowed", "blocked");
  if (url.username || url.password) throw new CaptureError("URLs with credentials are not allowed", "blocked");
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && isBlockedIp(url.hostname.replace(/^\[|\]$/g, ""))) throw new CaptureError("private address", "blocked");
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(url.hostname)) throw new CaptureError("internal host", "blocked");
  return url;
}

export interface Captured {
  url: string | null;
  finalUrl: string | null;
  httpStatus: number | null;
  raw: string;
  text: string;
  sha256: string;
  capturedAt: Date;
}

export async function fetchSource(rawUrl: string): Promise<Captured> {
  let url = checkUrl(rawUrl);
  for (let hop = 0; hop <= 3; hop++) {
    let res;
    try {
      res = await undiciFetch(url, {
        dispatcher: safeDispatcher,
        redirect: "manual",
        headers: { "user-agent": "KeptBot/1.0 (+commitment verification)", accept: "text/html,text/plain,text/markdown;q=0.9,*/*;q=0.1" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const msg = e instanceof Error ? `${e.message}${(e as { cause?: Error }).cause ? `: ${(e as { cause?: Error }).cause?.message}` : ""}` : String(e);
      throw new CaptureError(/blocked/i.test(msg) ? "that host resolves to a private address" : `fetch failed: ${msg}`, /blocked/i.test(msg) ? "blocked" : "fetch_failed");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new CaptureError("redirect without location", "fetch_failed");
      url = checkUrl(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) throw new CaptureError(`the page returned HTTP ${res.status}; paste the text instead`, "fetch_failed");
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/|application\/(xhtml|json|xml)/i.test(type)) throw new CaptureError(`unsupported content type ${type}`, "not_text");
    const reader = res.body?.getReader();
    if (!reader) throw new CaptureError("empty response", "empty");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new CaptureError("page is larger than 10 MB", "too_large");
      }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const text = /html|xml/i.test(type) ? htmlToText(raw) : normalizeText(raw);
    if (text.length < 40) throw new CaptureError("the page has almost no readable text (it may need JavaScript); paste the text instead", "js_only");
    return { url: rawUrl, finalUrl: url.toString(), httpStatus: res.status, raw, text, sha256: sha256Hex(text), capturedAt: new Date() };
  }
  throw new CaptureError("too many redirects", "fetch_failed");
}

export function captureText(text: string): Captured {
  const normalized = normalizeText(text);
  if (normalized.length < 20) throw new CaptureError("the text is too short", "empty");
  return { url: null, finalUrl: null, httpStatus: null, raw: text, text: normalized, sha256: sha256Hex(normalized), capturedAt: new Date() };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };

export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre|header|footer|main|nav)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return normalizeText(s);
}

/** Stable normalization so the content hash changes only when the words change. */
export function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[ \t\f\v ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
