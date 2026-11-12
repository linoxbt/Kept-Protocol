# Kept Protocol

**Promises made. Evidence tracked. Commitments verified.**

Kept turns public crypto promises into structured commitments, checks them with deterministic code against Base chain data, and keeps a cited, versioned, replayable record of every result. SERV Reasoning reads the promises. Code decides the facts. No AI output is ever the final word on what happened on-chain.

The feature that matters most: **projects quietly rewrite their promises after breaking them, and Kept catches it.** Every version of a promise is kept. When a revision excuses a transfer that already happened, Kept flags it: *condition relaxed after the event*.

Built for SERV Hackathon Edition 02 (Open Track).

---

## What it does

| Capability | What you get |
|---|---|
| **Extraction** (SERV) | Paste a docs URL or text. SERV locates promises, extracts structured fields and classifies how each can be verified. Every number, date and address must appear in the quote or be declared as derived, or the draft goes to review. |
| **Verification** (code) | Pure, versioned functions check each condition against finalized Base blocks: locks (`erc20_outflow_v1`), vesting schedules (`vesting_schedule_v1`) and burns (`burn_v1`). |
| **Fineprint receipts** | Every check produces a receipt: RFC 8785 canonical JSON, SHA-256, hash-chained per commitment, EIP-191-signed, Merkle-anchored on Base through EAS. Anyone can verify it without trusting Kept. |
| **Precedent** | Sources are re-captured and diffed. Wording-only changes attach a snapshot; policy changes become a new version only after review. Old versions are frozen at the database level. The retroactive-revision flag shows when a revision excuses an earlier transfer. |
| **Hindcast** | Replays every version over the same historical evidence and shows where the outcomes diverge, with a signed replay receipt. |
| **Grifter** | A 23-case adversarial suite against Kept's own pipeline: injection, ambiguous quantifiers, contradictions, unit and date traps, wallet poisoning, satisfied-looking-but-not, evidence spoofing, finality and provider disagreement. |
| **Try-it mode** | Anyone can test any URL without an account. Results are labelled *Unconfirmed preview*, never published, expire in 24 h, and can never show *Breached*. |
| **Agent API** (x402) | `GET /api/v1/agent/commitments?token=…` is paid per query over x402 and returns signed records with `coverage: none | partial | full`, so "no record" is never read as "clean". |

### Status rules

- **Breached** requires a violation at a *finalized* block, by an *attributed* address, confirmed by a *second, independent* RPC provider. Anything less is **At risk**.
- **Verified to date** and **Verified, final** are different claims; the UI never blurs them.
- An address suggested by a model or a user is `unconfirmed` and can never produce a breach.
- Kept never says "fraud", "scam", "rug" or "lied". A breach is a mechanical fact about a stated condition.

---

## How Kept uses SERV Reasoning

SERV is called only on the language side, at three call sites. It is never asked whether something happened on-chain, so if SERV is down, monitoring keeps running.

| # | Call site | Model (configurable) | SERV features | Output, validated by code |
|---|---|---|---|---|
| 1 | Locate commitments | `gpt-5.4-mini` | `serv_prompt_guard`, strict `json_schema` | Verbatim quotes. Code finds each one in the snapshot and drops any that is not an exact substring, or that overlaps text addressed to an AI. |
| 2 | Extract fields | `gpt-5.4-mini-serv-kronos` | **Kronos** (audits the reasoning prompt), **Shadow Agent** (`serv_shadow_agent` with a checkable hint), strict `json_schema` | Zod validation, then a grounding check: every number, date and address must appear in the excerpt or be listed in `derived`. EIP-55 checksums, look-alike (poisoning) detection, unit traps, third-party wallets. |
| 3 | Classify verifiability ×2 | `gpt-6-luna-serv-multipath` | **Multipath** over a numbered policy matrix | Two runs must agree, and must match the same matrix implemented in code (`src/extraction/rules.ts`). Disagreement sends the draft to review. |

Confidence is computed, never asked for: grounding passed, the two Multipath runs agree, and the code rules agree. Every call is metered (`serv_calls`: model, prompt version and SHA-256, tokens, latency, estimated cost), with a daily budget. The landing page shows SERV calls per commitment.

Transport policy: 429 → exponential backoff honouring `Retry-After`; 5xx and Shadow Agent 502 → two retries, then review; 400 → no retry; 401 → halt; five consecutive failures open the circuit for five minutes. A refused, truncated or invalid response is a failure, never data.

---

## Architecture

```
            ┌──────────── System 01: Promise Intelligence (SERV) ───────────┐
 URL/text → │ capture (SSRF-safe) → locate → extract → classify ×2 → grounding │ → draft
            └──────────────────────────────────────────────────────────────────┘
                                         │ human review / try-it preview
                                         ▼
            ┌──────────── System 02: Deterministic Verification (code) ───────┐
 Base RPC → │ evidence cache → method (pure fn) → 2nd-provider confirmation →  │
 (2 providers) status engine (attribution + finality rules)                  │
            └──────────────────────────────────────────────────────────────────┘
                                         ▼
            ┌──────────── System 03: Evidence & Monitoring ─────────────────────┐
            │ signed hash-chained receipts · append-only tables · outbox → webhooks │
            │ Precedent versions · Hindcast · Merkle root → EAS on Base           │
            └──────────────────────────────────────────────────────────────────────┘
```

- **One Next.js 16 app** (App Router, Cache Components) serves the UI and the REST API. A worker process or any HTTP cron drives monitoring.
- **Postgres** is the only store. Five evidential tables are append-only, enforced by triggers: snapshots, versions, evidence, receipts and status changes. Receipts allow exactly one change, the one-time anchor assignment.
- `src/core`, `src/receipts` and `src/chain` may not import SERV or service code. This is an ESLint rule: verification cannot depend on AI.

```
src/core         pure verification methods, status engine, Precedent, Hindcast
src/receipts     canonical JSON, hashing, EIP-191 signing, Merkle proofs
src/chain        viem adapter (adaptive log chunking, finality, confirmation), fixture chain
src/serv         SERV client, versioned prompts, strict schemas
src/extraction   capture, pipeline, grounding and adversarial checks, policy rules, spec builder
src/services     evidence cache, checks, extraction/confirmation, versions, replay, webhooks, anchoring
src/grifter      adversarial golden suite and runner
src/app          UI pages and /api/v1 routes
scripts          migrate, worker, grifter, anchor, kept-verify, demo
```

---

## Run it

Requirements: Node 20+, Postgres 14+.

```bash
npm ci
cp .env.example .env.local          # fill in DATABASE_URL at least
npm run db:migrate
npm run dev                         # http://localhost:3000
```

Without `SERV_API_KEY`, new extractions pause; monitoring, receipts, Precedent and Hindcast all work, and reviewers can write grounded manual drafts. Production refuses to start without `DATABASE_URL`, `KEPT_SIGNER_PRIVATE_KEY` and `KEPT_ADMIN_KEY`.

| Script | Does |
|---|---|
| `npm test` | 52 unit and integration tests. Integration tests need Postgres at `DATABASE_URL_TEST`. |
| `npm run grifter` | Runs the adversarial suite offline. `-- --live` sends every source to SERV; `--save` stores the run. |
| `npm run worker` | Long-running monitor: due checks, source watching, deadline alerts, webhooks. |
| `npm run anchor` | Attests the pending Merkle root on Base through EAS. `-- --register-schema` runs once. |
| `npm run verify-receipt -- <file or URL>` | Independently verifies a receipt (see below). |
| `npm run demo -- deploy \| seed \| breach \| rewrite` | The live-breach demo on Kept's own labelled token. |

### Deploy

- **Web and API:** Vercel. Set the environment from `.env.example`; Vercel Cron calls `/api/cron/tick` daily as a backstop.
- **Monitoring cadence:** run `Dockerfile.worker` on Railway or Fly, or enable `.github/workflows/monitor.yml` (every 10 minutes).
- **Database:** any managed Postgres (Supabase, Neon, RDS). Run `npm run db:migrate` once.

### The live demo (never against a real team)

```bash
DEMO_CHAIN_ID=84532 DEMO_DEPLOYER_KEY=0x… npm run demo -- deploy   # KDEMO + a demo team wallet
DEMO_TOKEN_ADDRESS=… DEMO_TEAM_KEY=… npm run demo -- seed          # promise page, project, commitment
npm run demo -- breach    # team wallet sends 4,000,000 KDEMO: At risk now, Breached after finality
npm run demo -- rewrite   # the page raises the allowance after the fact
# Admin console → Re-capture the source → confirm v2 → retroactive-revision flag + Hindcast
```

Measured on Base on 12 Nov 2026: blocks every 0.2 s, and `finalized` trails `latest` by about 20–25 minutes. The demo shows *At risk* the moment the transfer lands and *Breached* once it is final.

---

## Verify a receipt yourself

```bash
curl -s https://<kept>/api/v1/receipts/kr_… > receipt.json
npm run verify-receipt -- receipt.json --rpc https://base-rpc.publicnode.com
```

`kept-verify` recomputes the SHA-256 of the canonical JSON, recovers the EIP-191 signer, checks the Merkle inclusion proof once anchored, then re-fetches every Transfer log in the receipt's block range from *your* RPC, reruns the named method version, and confirms the same result. Each receipt page also has a **Verify in this browser** button. The signer address is published at `/.well-known/agent-card.json`.

---

## API

OpenAPI 3.1 at `/api/v1/openapi.json`; human docs at `/docs`. Public reads carry `Kept-Signature`, an EIP-191 signature over the SHA-256 of the body. Errors are RFC 9457 problem details. POSTs accept `Idempotency-Key`. Webhooks are HMAC-signed (`Kept-Webhook-Signature: t=…,v1=…`) and delivered from a transactional outbox.

---

## Limitations, stated plainly

- Base only in this release; methods read ERC-20 `Transfer` logs. Treasury, governance and fee-distribution commitments are classified and recorded but not yet monitored.
- Windows that start months back need an archive-capable RPC. Free public endpoints serve recent blocks only, and Kept says so in the check error instead of guessing.
- A database is not immutable, and Kept never claims it is. Integrity comes from the hash chain, the signatures and the on-chain anchors, which third parties can check.
- Prices on the landing page are hypotheses to test with the first launchpad pilot, not market data.

Not investment advice. MIT licensed.
