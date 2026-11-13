# Audit status

Status of every finding from the staff-engineer audit of 12 November 2026. **Fixed** means the
code is changed, covered by tests where testable, and deployed through the Railway auto-deploy.
**Needs owner** means the fix requires an account action or money that only the project owner can
provide; the code side is done.

| ID | Severity | Finding | Status | How |
|---|---|---|---|---|
| S0 | Critical | SERV API key pasted in chat | **Needs owner** | Rotate at console.openserv.ai and set the new `SERV_API_KEY` on Railway (web + worker). |
| S1 | High | Rate limits trusted the client-written X-Forwarded-For entry | Fixed | `clientIpInfo` (`src/lib/http.ts`) uses Netlify's client IP proven by the `x-kept-edge` token, else Railway's `x-real-ip`, else the right-most hop. Until the edge token is deployed (see N1), Netlify's header is accepted unproven. Tests: `tests/unit/security.test.ts`. |
| S2 | High | Bearer admin auth unlimited, scrypt per request | Fixed | `verifyCredential` (`src/lib/auth.ts`): 10 failures/15 min per IP and 60 globally, checked before scrypt; uniform delay on failure. Test in `lifecycle.test.ts`. |
| S3 | High | Signing key plaintext in DB + public Postgres TCP proxy | Fixed | Public Postgres TCP proxy deleted (port verified closed; the app uses the private network). Stored secrets are sealed with AES-256-GCM under `KEPT_SECRETS_KEK`, set on the worker and referenced by the web service; existing rows were re-encrypted on start (`/api/v1/health` → `secrets_encrypted_at_rest`). Recommended: seal that variable in the Railway dashboard (⋯ → Seal). |
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
| M1 | Critical | Production had no data | Fixed | Operator funded on Base mainnet. The worker deployed Kept's labelled KDEMO token (`0x173a2e89d6d48ee0d023192f93020095d1e13641`), published and confirmed the demo promise (`kc_01M7APJDJ4CX04CKD65F9NYQGK`, Verified with a signed receipt) and continues on its own: the team-wallet transfer after 30 minutes, Breached after finality, then the rewrite and retroactive flag. |
| M2 | High | Anchoring never ran | Fixed | The worker registered the EAS schema and anchored the first receipts on Base mainnet (tx `0x33efc21e828d118c7174ae10cf9b5c3e42127eb889a1882dc0553839d83f2548`); `kept-verify` confirms the Merkle inclusion. |
| M3 | High | x402 endpoint answered 503 | Fixed | `X402_PAY_TO` set to the owner's address; payments settle in USDC on Base mainnet (`eip155:8453`) through PayAI's public facilitator; the endpoint answers 402 with `exact` 0.01 USDC. |
| M4 | High | Default RPCs have no archive access | Fixed (keyless), faster with keys | Requests the primary refuses as archive reads are retried on Tenderly's public archive gateway (`src/chain/fallback.ts`); scanning is time-budgeted and resumable, so a year-old window backfills over about 1-2 hours of ticks. Also fixed: publicnode's archive refusal arrived as HTTP 403 and was not recognised. Verified live: transfers from June 2024 read in 0.8 s per 3,000 blocks. Paid keys (owner) only speed this up. |
| M5 | Medium | Disputed / Expired / Awaiting evidence never set | Fixed | Disputes implemented end to end (public form, admin queue, status overlay, webhooks); Awaiting evidence during backfill and recount; Expired removed (it had no meaning distinct from Verified, final). |
| M6 | Medium | Treasury / governance / fee not monitored | Fixed (stated) | Docs and README state they are recorded but not monitored in this release. |
| M7 | Medium | No manual-draft UI | Fixed | Admin console form, grounded against the snapshot like model drafts. |
| M8 | Medium | ERC-8004 not registered on-chain | Fixed (stated) | Called "ERC-8004-style" everywhere; README states it is not registered. |
| M9 | Medium | CI never observed | Fixed | GitHub Actions `ci` green on every push (lint, typecheck, tests with Postgres, Grifter, build). |
| M10 | Low | Stale README, vercel.json, monitor.yml | Fixed | README and `.env.example` rewritten for Railway + Netlify; unused files removed. |
| M11 | Low | kept-web references missing worker variables | Fixed | Removed the four empty references from kept-web and a leftover probe variable from the worker. |
| P1 | Medium | Slow first verdict on old commitments | Partly fixed | Backfill progress shown as Awaiting evidence with a percentage; scan budget configurable (`KEPT_MAX_SCAN_BLOCKS`). A paid indexer (M4) is the real fix. |
| P2 | Medium | Grifter suite ran on every view | Fixed | Cached per build (`"use cache"`). |
| P3 | Low | Version diff per render | Fixed | Cached per (commitment, latest version). |
| P4 | Low | Deadline alerts scanned all commitments | Fixed | Filtered in SQL. |
| P5 | Low | Hero canvas always animating | Fixed | ~30 fps, stops off-screen and in hidden tabs, static under reduced motion. |
| P6 | Low | Two hops (Netlify → Railway) | Accepted | Kept as the public domain; static assets are immutable-cached by browsers. |
| N1 | Medium | Netlify edge token header not yet deployed | **Needs owner** | Netlify ignores `netlify.toml` in zip uploads, so the header needs a CLI or Git-linked deploy. Run `KEPT_EDGE_TOKEN=… node scripts/netlify-edge-config.mjs > netlify.toml` then `netlify deploy --prod`, then set `KEPT_EDGE_STRICT=1` on kept-web. Until then client IPs come from Netlify's header unproven (`edge-unverified`), which is spoofable only by someone calling the Railway origin directly. |
