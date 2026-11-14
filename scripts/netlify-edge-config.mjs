#!/usr/bin/env node
/**
 * Prints the netlify.toml to deploy, with the x-kept-edge header added to the proxy rule. The token
 * comes from KEPT_EDGE_TOKEN (or a file named by KEPT_EDGE_TOKEN_FILE) and is never committed: the
 * repository holds only its SHA-256 (src/lib/http.ts). Usage:
 *   KEPT_EDGE_TOKEN_FILE=/secure/edge-token node scripts/netlify-edge-config.mjs > deploy/netlify.toml
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const token = (process.env.KEPT_EDGE_TOKEN ?? (process.env.KEPT_EDGE_TOKEN_FILE ? readFileSync(process.env.KEPT_EDGE_TOKEN_FILE, "utf8") : "")).trim();
if (!/^[0-9a-f]{32,}$/.test(token)) {
  console.error("set KEPT_EDGE_TOKEN or KEPT_EDGE_TOKEN_FILE to the edge token (hex)");
  process.exit(1);
}
const toml = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
const out = toml.replace(/headers = \{[^}]*\}/, `headers = { X-From = "netlify", X-Kept-Edge = "${token}" }`);
if (out === toml) {
  console.error("netlify.toml has no proxy headers line to extend");
  process.exit(1);
}
console.error(`edge token sha256 ${createHash("sha256").update(token).digest("hex")}`);
process.stdout.write(out);
