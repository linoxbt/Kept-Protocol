# Kept Protocol: SERV Hackathon 02 submission

**Track:** Open Track
**Live app:** https://kept-protocol.netlify.app
**Repository:** https://github.com/linoxbt/Kept-Protocol (MIT)
**Live demo record (Base mainnet):** https://kept-protocol.netlify.app/commitments/kc_01M7APJDJ4CX04CKD65F9NYQGK
**Agent API (x402, Base mainnet USDC):** `GET https://kept-protocol.netlify.app/api/v1/agent/commitments?chain_id=8453&token=0x…`

Built from scratch during the hackathon (first commit 12 November 2026).

---

## Short write-up (for the submission form)

**What it does.** Crypto projects make public promises: "team tokens are locked for 12 months",
"we will burn 10% of supply by Q2", "vesting starts after a 6-month cliff". When those promises are
broken, projects often quietly edit the page afterwards. Kept turns public promises into
structured commitments, checks them against finalized Base chain data with deterministic code, and
keeps a signed, hash-chained, Base-anchored receipt for every result. Every version of a promise is
kept, so when a project relaxes its promise after the tokens moved, Kept flags it as a retroactive
revision, and the breach stands.

**How it uses SERV Reasoning.** SERV reads the language; code decides the facts. Three call sites:

1. **Locate** (`gpt-5.4-mini` with the `serv_prompt_guard` tool, strict JSON schema): finds every
   commitment in a document as a verbatim quote. Code then checks each quote is an exact substring of
   the captured source and drops anything overlapping text that addresses an AI.
2. **Extract** (`gpt-5.4-mini-serv-kronos` with **Kronos** and the **Shadow Agent** tool): turns a quote
   into structured fields (token, subjects, comparator, amount, window). Code grounds every number,
   date and address against the quote, checks EIP-55 checksums and look-alike addresses, and catches
   unit traps.
3. **Classify ×2** (`gpt-6-luna-serv-multipath` with **Multipath**): decides which verification method
   applies. Both runs must agree with each other and with the same policy matrix implemented in code;
   any disagreement sends the draft to a human reviewer.

SERV is never asked whether something happened on-chain. Every call is metered (model, prompt
version, tokens, latency, cost) under a daily budget, and if SERV is down, monitoring continues.
Grifter, a 23-case adversarial suite (prompt injection, ambiguous quantifiers, wallet poisoning,
contradictions, finality traps), runs the pipeline against a deliberately fooled model and proves the
code catches what the model misses.

**Which track.** Open Track.

---

## Why it should win (judging: creativity, user readiness, revenue potential)

**Creativity.** Kept doesn't just check promises: it catches the rewrite. Precedent versions every
promise, and Hindcast replays all versions over the same chain history. A retroactive relaxation is
flagged with the transfer it excuses, and the breach under the earlier version stands. The receipt
format (RFC 8785 JSON, SHA-256 hash chain, EIP-191 signature, Merkle root attested on Base via EAS)
means nobody has to trust Kept: `npm run verify-receipt` re-fetches the logs from any RPC and reruns the
method.

**User readiness.** It's live on Base mainnet now, with no login needed to read:

- **Try it:** paste any docs URL or text and see SERV's extraction plus a chain check, labelled
  "Unconfirmed preview", rate-limited and never published.
- **Live demo on mainnet:** Kept's own labelled token, promise, breach and rewrite. It went
  Verified → At risk (unfinalized) → Breached (final, second-provider confirmed) → retroactive
  revision flagged.
- **Disputes:** anyone can dispute a record; a reviewer decides, and every decision is public.
- **Reviewer console:** review queue, manual drafts, webhooks, Grifter runs.
- **Infrastructure:** security headers, rate limits on real client IPs, secrets encrypted at rest,
  background jobs, append-only database tables. 67 automated tests and CI on every push.

**Revenue potential.** Four paying customer types, all wired:

- **Agents:** pay per query over x402. Live now: `exact` 0.01 USDC on Base mainnet. Responses are
  signed and report `coverage: none | partial | full`, so "no record" is never read as "clean".
- **Launchpads:** $1,200 per launched project per year for public promise pages and alerts.
- **Pro users:** $49 per month for watchlists, alerts, Hindcast and exports.
- **Data buyers:** $2,000+ per month for bulk API and history.

---

## Demo video script (2–3 minutes)

1. **0:00. The problem.** Show a token page with a lock promise. "Projects make promises, break them,
   then edit the page. Nobody keeps the receipts."
2. **0:20. Try it.** On /try, paste a docs URL. Show SERV's drafts: the exact quote highlighted, the
   fields, computed confidence ("grounding passed, two classifier runs agree"). Run the chain check.
3. **0:50. The live demo on Base mainnet.** Open the Kept Demo Labs commitment. Walk the status
   history: Verified → At risk "in a block that is not yet finalized" → Breached "4,000,000 KDEMO
   left … on day 1" → the rewrite.
4. **1:30. The catch.** The retroactive-revision banner, "see how the promise changed" (word diff),
   the breach still standing, and the Hindcast lanes.
5. **1:55. Trust nothing.** Open a receipt, press "Verify in this browser", then run
   `npm run verify-receipt` in a terminal: hash ✓, signer ✓, Merkle inclusion on Base ✓, rerun ✓.
6. **2:20. Revenue.** `curl` the agent endpoint and show the 402 with USDC on Base mainnet. Close on
   the pricing section.

## X post draft

> Built Kept for #SERVHackathon (Open Track) on @openservai SERV Reasoning.
>
> Projects break token promises, then quietly edit the page. Kept reads the promise with SERV
> (Kronos + Multipath + Shadow Agent), checks it against finalized Base blocks with code, and signs a
> receipt anchored on Base. Rewrites get flagged; the breach stands.
>
> Live on Base mainnet: https://kept-protocol.netlify.app

## Checklist (official requirements)

- [x] Uses SERV Reasoning (locate, extract with Kronos and Shadow Agent, classify with Multipath),
  verified live in production
- [x] Public code repository (MIT)
- [x] Demo link: https://kept-protocol.netlify.app
- [ ] Demo video (record from the script above)
- [x] Short write-up (above)
- [ ] Post on X and put the post's link in the form
- [ ] Submit at https://openserv.typeform.com/submissions02 by 15 November 2026, 23:59 UTC
