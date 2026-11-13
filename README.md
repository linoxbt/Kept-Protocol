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
| **Disputes** | Anyone can dispute a record with evidence. A reviewer accepts it (the commitment shows *Disputed*, with the mechanical result still in the reason), rejects it, or resolves it; every decision is kept and shown. |
| **Agent API** (x402) | `GET /api/v1/agent/commitments?token=…` is paid per query over x402 and returns signed records with `coverage: none | partial | full`, so "no record" is never read as "clean". |

### Status rules

- Statuses: *Pending*, *Awaiting evidence* (history still being scanned, or a shortfall being recounted), *Verified*, *At risk*, *Breached*, *Unverifiable*, *Disputed*.
- **Breached** requires a violation at a *finalized* block, by an *attributed* address, confirmed by a *second, independent* RPC provider. Anything less is **At risk**. A shortfall (a burn below target) is confirmed by recounting the whole period on the second provider; long periods are recounted a few million blocks per check until done.
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

The sentence the UI shows as *what exactly is checked* is written by code from the spec (`src/core/describe.ts`), never taken from the model: in live testing SERV's own summary inverted a lock's direction while its structured fields were right.

Confidence is computed, never asked for: grounding passed, the two Multipath runs agree, and the code rules agree. Every call is metered (`serv_calls`: model, prompt version and SHA-256, tokens, latency, estimated cost), with a daily budget. The landing page shows SERV calls per commitment.

Transport policy: 429 → exponential backoff honouring `Retry-After`; 5xx and Shadow Agent 502 → two retries, then review; 60 s timeout (180 s for extraction, where an uncached Kronos audit plus Shadow Agent revisions took about 116 s in testing); 400 → no retry; 401 → halt; five consecutive failures open the circuit for five minutes. A refused, truncated or invalid response is a failure, never data.

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

Requirements: Node 22.19+, Postgres 14+.

```bash
npm ci
cp .env.example .env.local          # fill in DATABASE_URL at least
npm run db:migrate
npm run dev                         # http://localhost:3000
```

Without `SERV_API_KEY`, new extractions pause; monitoring, receipts, Precedent and Hindcast all work, and reviewers can write grounded manual drafts from the admin console.

Secrets bootstrap themselves: on first start with a database, Kept generates its receipt-signing key, anchoring operator key, session secret, cron secret and a one-time admin setup token, and stores them in its own database (AES-256-GCM encrypted when `KEPT_SECRETS_KEK` is set). An environment variable always wins. The first admin opens `/admin/setup` with the setup token printed in the server log and sets a password.

| Script | Does |
|---|---|
| `npm test` | 67 unit and integration tests. Integration tests need Postgres at `DATABASE_URL_TEST` and are skipped when none is reachable. `KEPT_E2E_URL=… npx vitest run tests/e2e` runs read-only HTTP checks against a deployment. |
| `npm run grifter` | Runs the adversarial suite offline. `-- --live` sends every source to SERV; `--save` stores the run. |
| `npm run worker` | Long-running monitor: due checks, source watching, deadline alerts, webhooks, and automatic EAS anchoring once the operator key is funded. |
| `npm run anchor` | Attests the pending Merkle root on Base through EAS by hand. `-- --register-schema` runs once. |
| `npm run verify-receipt -- <file or URL>` | Independently verifies a receipt (see below). |
| `npm run demo -- deploy \| seed \| breach \| rewrite` | The live-breach demo on Kept's own labelled token. |

### Deploy

The reference deployment:

- **Web and API:** Railway runs `next start` (no function time limits; long work runs as background jobs that the UI polls).
- **Worker:** Railway runs `Dockerfile.worker`, which migrates the database and then ticks every 60 s. Any HTTP cron can also call `GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET`; deliveries and anchoring are locked, so two schedulers never double-send.
- **Database:** Railway Postgres on the private network only (no public TCP proxy).
- **Public domain:** Netlify proxies `/*` to the Railway web service (`netlify.toml`). At deploy time, `KEPT_EDGE_TOKEN=… node scripts/netlify-edge-config.mjs > netlify.toml` adds the `x-kept-edge` header that lets the app trust Netlify's client-IP header for rate limits; only the token's SHA-256 is in the repository.
- **Anchoring:** `/api/v1/health` shows the operator address. Send it a little ETH on Base and the worker anchors pending receipts every 6 hours (`ANCHOR_INTERVAL_S`).

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

- The agent card is an ERC-8004-style registration file; Kept is not yet registered in an on-chain ERC-8004 identity registry.
- x402 payments settle in USDC on Base mainnet through PayAI's public facilitator; the facilitator is a third party that relays each signed payment on-chain. Without configuration the code defaults to Base Sepolia (x402.org) for testing.
- Base only in this release; methods read ERC-20 `Transfer` logs. Treasury, governance and fee-distribution commitments are classified and recorded but not yet monitored.
- History: free public endpoints serve recent blocks only. When the primary refuses a historical request, Kept retries it on an archive-capable fallback (`BASE_RPC_URL_ARCHIVE`, default Tenderly's public Base gateway, 1,000 blocks per log query), so old windows are checked, about 150,000 blocks per check. A paid archive RPC as `BASE_RPC_URL` makes backfill much faster.
- A database is not immutable, and Kept never claims it is. Integrity comes from the hash chain, the signatures and the on-chain anchors, which third parties can check.
- Prices on the landing page are hypotheses to test with the first launchpad pilot, not market data.

Not investment advice. MIT licensed.
