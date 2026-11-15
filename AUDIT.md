# Audit status

Status of every finding from the staff-engineer audit of 12 November 2026. **Fixed** means the
code is changed, covered by tests where testable, and deployed through the Railway auto-deploy.
**Needs owner** means the fix requires an account action or money that only the project owner can
provide; the code side is done.

| ID | Severity | Finding | Status | How |
|---|---|---|---|---|
| S0 | Critical | SERV API key pasted in chat | **Needs owner** | Rotate at console.openserv.ai and set the new `SERV_API_KEY` on Railway (web + worker). |
| S1 | High | Rate limits trusted the client-written X-Forwarded-For entry | Fixed | `clientIpInfo` (`src/lib/http.ts`) uses Netlify's client IP only when proven by the `x-kept-edge` token (strict mode on), else Railway's `x-real-ip`, else the right-most hop. Verified live: `client_ip_source: edge` through Netlify, `real-ip` for a forged direct request. Tests: `tests/unit/security.test.ts`. |
| S2 | High | Bearer admin auth unlimited, scrypt per request | Fixed | `verifyCredential` (`src/lib/auth.ts`): 10 failures/15 min per IP and 60 globally, checked before scrypt; uniform delay on failure. Test in `lifecycle.test.ts`. |
| S3 | High | Signing key plaintext in DB + public Postgres TCP proxy | Fixed | Public Postgres TCP proxy deleted (port verified closed). Stored secrets sealed with AES-256-GCM under `KEPT_SECRETS_KEK`, now set directly (not by reference) on both kept-web and kept-worker so each can be sealed independently. Owner step remaining: seal `KEPT_SECRETS_KEK` on both services in the Railway dashboard (variable ⋯ → Seal); Railway offers sealing only in the dashboard. |
| S4 | Medium-High | Idempotency replay before auth, not scoped | Fixed | Keys are scoped to a hash of the caller's credential. Test in `lifecycle.test.ts`. |
| S5 | Medium | No security headers | Fixed | CSP (pages), `X-Frame-Options: DENY`, nosniff, Referrer-Policy, Permissions-Policy, COOP; `x-powered-by` removed. Verified live. |
| S6 | Medium | Webhook delivery open to DNS rebinding | Fixed | Delivered through the same pinned-lookup dispatcher as source capture. |
| S7 | Low | Admin setup first-come-first-served | Fixed | Setup needs a one-time token printed in the server log. |
| S8 | Low | Sessions not revocable | Fixed | Sessions carry an epoch; sign-out revokes all. Test in `lifecycle.test.ts`. |
| S9 | Low | Webhook and session secrets plaintext | Fixed (with S3 owner step) | Webhook secrets sealed with the same KEK as other secrets. |
| S10 | Low | Admin link in public footer | Fixed | Replaced with a public Status link. |
| B1 | High | Burn shortfall could never become Breached | Fixed | Resumable full recount on the second provider (`confirm_recounts`), a few million blocks per check. Test in `lifecycle.test.ts`. |
| B2 | Medium | Long synchronous routes behind the proxy timeout | Fixed | Verify, confirm, versions, Hindcast, preview checks and Grifter runs return 202 + a job (`/api/v1/jobs/{id}`); the UI polls. Test in `lifecycle.test.ts`. |
| B3 | Medium | x402 payments recorded before settlement | Fixed | Recorded from the facilitator's settlement header only (payer, network, transaction). |
| B4 | Medium | Webhooks could be delivered twice | Fixed | Deliveries claimed with `FOR UPDATE SKIP LOCKED` and a lease. |
| B5 | Low | Integration suite failed without a DB | Fixed | Skips when Postgres is unreachable. |
| B6 | Low | `paid()` cache ignored env changes | Fixed | Cache keyed by pay-to, network, price and facilitator. |
| B7 | Low | Docs page read env at build time | Fixed | Payment example renders per request. |
| B8 | Low | Agent rate limit used raw XFF | Fixed | Uses `clientIp`. |
| B9 | **Critical (found during fixing)** | Agent card was prerendered at build time and published the public development signer | Fixed | Route runs per request; the live e2e test checks the card matches `/api/v1/health`. |
| M1 | Critical | Production had no data | Fixed | The full live demo ran on Base mainnet with the deployment's own operator key: KDEMO deployed (`0x173a2e89d6d48ee0d023192f93020095d1e13641`); promise confirmed (`kc_01M7APJDJ4CX04CKD65F9NYQGK`, Verified, signed and anchored); team wallet sent 4,000,000 KDEMO (tx `0xb4e98b691162a5b0b75dcf61dfe6f183f213ccc11312955ee1987af38679c7b0`): At risk, then Breached after finality and second-provider confirmation; the promise was rewritten as v2 and Precedent flagged the retroactive relaxation. |
| M2 | High | Anchoring never ran | Fixed | The worker registered the EAS schema and anchored the first receipts on Base mainnet (tx `0x33efc21e828d118c7174ae10cf9b5c3e42127eb889a1882dc0553839d83f2548`); `kept-verify` confirms the Merkle inclusion. |
| M3 | High | x402 endpoint answered 503 | Fixed | `X402_PAY_TO` set to the owner's address; payments settle in USDC on Base mainnet (`eip155:8453`) through PayAI's public facilitator; the endpoint answers 402 with `exact` 0.01 USDC. |
| M4 | High | Default RPCs have no archive access | Fixed (keyless), faster with keys | Requests the primary refuses as archive reads are retried on Tenderly's public archive gateway (`src/chain/fallback.ts`); scanning is time-budgeted and resumable, so a year-old window backfills over about 1-2 hours of ticks. Also fixed: publicnode's archive refusal arrived as HTTP 403 and was not recognised. Verified live: transfers from June 2024 read in 0.8 s per 3,000 blocks. Paid keys (owner) only speed this up. |
| M5 | Medium | Disputed / Expired / Awaiting evidence never set | Fixed | Disputes implemented end to end (public form, admin queue, status overlay, webhooks); Awaiting evidence during backfill and recount; Expired removed (it had no meaning distinct from Verified, final). |
| M6 | Medium | Treasury / governance / fee not monitored | Fixed (stated) | Docs and README state they are recorded but not monitored in this release. |
| M7 | Medium | No manual-draft UI | Fixed | Admin console form, grounded against the snapshot like model drafts. |
| M8 | Medium | ERC-8004 not registered onchain | Fixed (stated) | Called "ERC-8004-style" everywhere; README states it is not registered. |
| M9 | Medium | CI never observed | Fixed | GitHub Actions `ci` green on every push (lint, typecheck, tests with Postgres, Grifter, build). |
| M10 | Low | Stale README, vercel.json, monitor.yml | Fixed | README and `.env.example` rewritten for Railway + Netlify; unused files removed. |
| M11 | Low | kept-web references missing worker variables | Fixed | Removed the four empty references from kept-web and a leftover probe variable from the worker. |
| P1 | Medium | Slow first verdict on old commitments | Partly fixed | Backfill progress shown as Awaiting evidence with a percentage; scan budget configurable (`KEPT_MAX_SCAN_BLOCKS`). A paid indexer (M4) is the real fix. |
| P2 | Medium | Grifter suite ran on every view | Fixed | Cached per build (`"use cache"`). |
| P3 | Low | Version diff per render | Fixed | Cached per (commitment, latest version). |
| P4 | Low | Deadline alerts scanned all commitments | Fixed | Filtered in SQL. |
| P5 | Low | Hero canvas always animating | Fixed | ~30 fps, stops off-screen and in hidden tabs, static under reduced motion. |
| P6 | Low | Two hops (Netlify → Railway) | Accepted | Kept as the public domain; static assets are immutable-cached by browsers. |
| N1 | Medium | Netlify edge token header not deployed | Fixed | Netlify now adds `x-kept-edge` to every proxied request (deployed through Netlify's build with the generated config; the token is not in the repository and is not served). `KEPT_EDGE_STRICT=1` on kept-web: only requests carrying the token get Netlify's client IP; a direct call to the Railway origin with a forged header falls back to Railway's own `x-real-ip`. |

---

## Second audit, 14 November 2026

An independent review (five reviewers, none anchored on the first audit) found new problems. Status
of each, as of 15 November. **Fixed** means changed, tested, pushed and deployed.

| ID | Severity | Finding | Status | How |
|---|---|---|---|---|
| S1 | Critical | SERV key pasted in chat (same as S0) | **Needs owner** | Rotate at console.openserv.ai; set on both Railway services. |
| S2 | High | One hostile page froze the process (quadratic HTML regexes) | Fixed | Linear HTML-to-text, byte-identical output (5,000 randomized cases and the live Degen and Alien Base pages, so content hashes are unchanged); 10 MB hostile pages under 0.6 s. |
| S3 | High | SERV daily budget could be overspent | Fixed | Every call reserves its worst-case cost under an advisory lock before it is sent; feature charges budgeted; failed calls charged; unpriced models refused; live Grifter metered. Test: 40 concurrent reservations, room for 7, exactly 7 held. |
| S4 | Medium | Sign-in limiter raceable; scrypt blocked the event loop; easy global lockout | Fixed | Atomic count-before-check (30 parallel guesses, exactly 10 checked); async scrypt; global ceiling 300 per 15 min. |
| S5 | Medium | IPv6 clients bypassed per-IP limits | Fixed | Limits key IPv6 on its /64. |
| S6 | Medium | No body size cap; idempotency table unbounded and shared by anonymous callers | Fixed | 256 KB JSON / 16 KB forms (413, verified live); idempotency only for authenticated 2xx, claimed before running, 24 h TTL. |
| S7 | Low-Medium | Public disputes unmoderated; evidence URLs accept `javascript:` | Open | React neutralises `javascript:` hrefs at render; https-only and moderation are next. |
| S8 | Low | Open redirect after sign-in | Fixed | Redirect must resolve to a path on this site. |
| S9 | Low | Hardening gaps (CSP inline scripts, web holds operator key, worker as root) | Partly fixed | Worker runs as `node`; CSP nonces and moving the operator key out of the web process are open. |
| B1 | High | Breach blamed on the transfer that crossed the aggregate threshold | Fixed | Breach needs breach-capable subjects' own outflow to exceed the limit; the second provider confirms every transfer in the proof. |
| B2 | High | Vesting had zero tolerance (730-day contract vs. "24 months" = Breached) | Fixed | `vesting_schedule_v1` v2 allows max(1 day, 0.5% of duration); genuinely early releases still breach. |
| B3 | High | kept-verify and browser verify trusted the receipt's own signer and Kept's Merkle data | Fixed | Signer pinned (`--signer` or the agent card; dev key rejected); leaf = recomputed hash; root read from the EAS attestation on Base via the user's RPC. Verified on a live receipt. |
| B4 | Medium | Precedent diff missed internal-address and attribution changes | Open | Next: add them to the policy fields. |
| B5 | High | Hindcast replayed unscanned history and forced "confirmed" | Fixed | Replays stop where scanned evidence stops; receipts state they were not re-confirmed. |
| B6 | Medium | Standing breach depended on the recorded status | Open | Next: evaluate earlier versions over evidence up to the new version's publish time. |
| B7 | Medium | Burning locked tokens counted as a lock breach | Open | Next method version. |
| B8 | Medium | Degen burn target has thin margin over "about 5 million a day" | Open | Needs a stated tolerance in the curated entry. |
| B9 | Medium | Demo history shows a Breached → Verified flip from before the standing-breach rule | Disclosed | Stated in SUBMISSION; the log is append-only by design. |
| B10 | High | Background work orphaned by restarts stayed "running" forever; worker ignored SIGTERM | Fixed | 30 s heartbeats, monitor fails work silent for 3 min; node is PID 1 and stops cleanly (seen in production logs). |
| B11 | Medium | Advisory locks over a pool; anchoring not idempotent | Fixed | Locks on one reserved connection; the signed attestation hash is recorded before broadcast and reconciled by hash. |
| B12 | Medium | Check lease could expire mid-check; hash chain could fork | Open | |
| B13 | Medium | Partial-evidence breach receipts recorded the covered range, not the computed range | Open | |
| B14 | Medium | Confirming a draft twice created two commitments | Fixed | Refused with the existing id; unique index. |
| B15 | Medium | Migrations raced web deploys | Fixed | Web migrates at boot, worker in-process, serialised by a lock. |
| B17 | Medium | No error boundaries | Fixed | `error.tsx`, `global-error.tsx`, home sections degrade; verified by stopping Postgres. |
| B18 | Medium | `/try?url=` re-ran a paid extraction on every load | Fixed | The URL becomes `/try?preview=<id>`. |
| B19 | Medium/Low | Polling gave up on one transient 502 | Fixed | Retries transient errors. |
| B21 | Low | Soft 404s; Hindcast page rendered for unknown ids | Partly fixed | Hindcast 404s; other pages still answer 200 with "No record here" and `noindex`. |
| B22 | High | A model could skip grounding by naming a field in `derived` | Fixed | Only code-recomputable derivations accepted for model drafts. |
| B23 | Medium-High | A page with many injection sentences produced zero drafts | Open | |
| — | High | Hindcast and Grifter empty on the live site | Fixed | The worker keeps one demo replay and one stored offline Grifter run. |
| — | High | Fewer seeded real projects than the PRD's target | Open | 2 real projects (3 commitments) plus the demo. |
| — | Medium | Inaccurate claims in README and SUBMISSION | Fixed | Corrected (billing tiers, signatures, SERV stats, test count, demo history). |
