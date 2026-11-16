/**
 * Project-side workflows. A wallet declaration is a message signed by the address itself (EOA or,
 * through ERC-1271, a smart account such as a Safe), verified onchain-aware before it is stored,
 * then reviewed by a person. Contact and pilot requests are stored for the reviewer.
 */
import { createPublicClient, getAddress, http, isAddress, verifyMessage, type Hex } from "viem";
import { base } from "viem/chains";
import { db, type Sql } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { RateLimited } from "./preview";
import { hit } from "./ratelimit";
import { Invalid, NotFound } from "./sources";

export const DECLARATION_ROLES = ["team", "treasury", "vesting", "lock", "burn executor", "other"] as const;

/** The exact text a project signs. Built the same way in the browser and here. */
export function declarationMessage(input: { project: string; address: string; role: string; date: string }): string {
  return [
    "Kept wallet declaration",
    `Project: ${input.project}`,
    `Address: ${input.address}`,
    `Role: ${input.role}`,
    `Date: ${input.date}`,
    "I control this address and declare it as the project's for the role above.",
  ].join("\n");
}

export async function submitDeclaration(
  input: { project: string; address: string; role: string; date: string; signature: string; contact?: string | null; evidenceUrl?: string | null; requester: string },
  sql: Sql = db(),
) {
  if (!isAddress(input.address, { strict: false })) throw new Invalid("that is not a valid address");
  const address = getAddress(input.address);
  if (!(DECLARATION_ROLES as readonly string[]).includes(input.role)) throw new Invalid("unknown role");
  const signedAt = Date.parse(`${input.date}T00:00:00Z`);
  if (!Number.isFinite(signedAt) || Math.abs(Date.now() - signedAt) > 2 * 86_400_000) throw new Invalid("the date in the message must be today (UTC)");
  if (!/^0x[0-9a-fA-F]+$/.test(input.signature)) throw new Invalid("the signature must be a 0x… hex string");
  const limit = await hit(`declare:${input.requester}`, 5, 86_400, sql);
  if (!limit.allowed) throw new RateLimited(limit.resetAt);
  const message = declarationMessage({ project: input.project.trim(), address, role: input.role, date: input.date });
  // An ordinary wallet's signature is checked locally; anything else may be a smart account (a Safe),
  // checked onchain through ERC-1271 / ERC-6492.
  const local = await verifyMessage({ address, message, signature: input.signature as Hex }).catch(() => false);
  const ok =
    local ||
    (await createPublicClient({ chain: base, transport: http(env().BASE_RPC_URL) })
      .verifyMessage({ address, message, signature: input.signature as Hex })
      .catch(() => false));
  if (!ok) throw new Invalid("the signature does not match this address and message; sign the exact text shown, with that address");
  const [row] = await sql<{ id: string; status: string; created_at: Date }[]>`
    insert into wallet_declarations (id, project, address, role, message, signature, contact, evidence_url, requester_hash)
    values (${newId("kwd")}, ${input.project.trim()}, ${address}, ${input.role}, ${message}, ${input.signature}, ${input.contact ?? null}, ${input.evidenceUrl ?? null}, ${input.requester})
    returning id, status, created_at`;
  return row;
}

export async function openDeclarations(sql: Sql = db()) {
  return sql<{ id: string; project: string; address: string; role: string; message: string; signature: string; contact: string | null; evidence_url: string | null; created_at: Date }[]>`
    select id, project, address, role, message, signature, contact, evidence_url, created_at from wallet_declarations where status = 'open' order by created_at`;
}

export async function decideDeclaration(id: string, action: "accept" | "reject", note: string, reviewer: string, sql: Sql = db()) {
  const [r] = await sql`update wallet_declarations set status = ${action === "accept" ? "accepted" : "rejected"}, note = ${note}, decided_at = now()
                        where id = ${id} and status = 'open' returning id, status`;
  if (!r) throw new NotFound("no open declaration with that id");
  await sql`insert into admin_log (action, target, detail) values (${`${action}_declaration`}, ${id}, ${sql.json({ note, reviewer })})`;
  return r;
}

/** Accepted declarations for an address: evidence a reviewer can cite when confirming a commitment. */
export async function acceptedDeclarationsFor(address: string, sql: Sql = db()) {
  return sql<{ id: string; project: string; role: string; decided_at: Date }[]>`
    select id, project, role, decided_at from wallet_declarations where status = 'accepted' and lower(address) = ${address.toLowerCase()} order by decided_at desc`;
}

export async function submitContact(input: { kind: "pilot" | "contact"; name: string; organisation?: string | null; contact: string; message: string; requester: string }, sql: Sql = db()) {
  const limit = await hit(`contact:${input.requester}`, 3, 86_400, sql);
  if (!limit.allowed) throw new RateLimited(limit.resetAt);
  const [r] = await sql<{ id: string }[]>`
    insert into contact_requests (id, kind, name, organisation, contact, message, requester_hash)
    values (${newId("kcr")}, ${input.kind}, ${input.name}, ${input.organisation ?? null}, ${input.contact}, ${input.message}, ${input.requester}) returning id`;
  return r;
}

export async function openContacts(sql: Sql = db()) {
  return sql<{ id: string; kind: string; name: string; organisation: string | null; contact: string; message: string; created_at: Date }[]>`
    select id, kind, name, organisation, contact, message, created_at from contact_requests where not handled order by created_at`;
}

export async function markContactHandled(id: string, sql: Sql = db()) {
  await sql`update contact_requests set handled = true where id = ${id}`;
}
