/**
 * Long-running monitor for a container host (Railway, Fly, a VM). Runs one tick every
 * KEPT_TICK_SECONDS (default 60): due checks, source watching, deadline alerts, webhooks.
 * Several workers can run at once; checks are claimed with SKIP LOCKED.
 */
import { closeDb } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { assertProductionEnv } from "../src/lib/env";
import { bootstrapSecrets } from "../src/lib/secrets";
import { tick } from "../src/services/monitor";


// An empty or invalid value falls back to 60 s (Number("") is 0, which would spin).
const every = (Number(process.env.KEPT_TICK_SECONDS) > 0 ? Number(process.env.KEPT_TICK_SECONDS) : 60) * 1000;
let stopping = false;
let wake: (() => void) | null = null;

/** Sleep that a shutdown signal can cut short. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(t);
      resolve();
    };
  });
}

async function loop() {
  while (!stopping) {
    const t0 = Date.now();
    try {
      const r = await tick({ maxChecks: 25, maxSources: 5, deadlineMs: Math.max(20_000, every - 5_000) });
      const errors = r.checks.filter((c) => c.error);
      console.log(
        JSON.stringify({ at: new Date().toISOString(), checks: r.checks.length, changed: r.checks.filter((c) => c.changed).length, errors: errors.length, sources: r.sources.length, webhooks: r.outbox, anchor: r.anchor, demo: r.demo, curated: r.curated?.added.length || r.curated?.failed.length ? r.curated : undefined, ms: r.ms }),
      );
      for (const e of errors) console.error(`check ${e.commitmentId} failed: ${e.error}`);
    } catch (e) {
      console.error("tick failed", e);
    }
    const wait = every - (Date.now() - t0);
    if (wait > 0 && !stopping) await sleep(wait);
  }
  await closeDb();
  console.log("worker stopped cleanly");
}

// Finish the current tick (claims are released by its own transactions), then exit. This runs
// because node is PID 1 in the container (no shell in between to swallow the signal).
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    stopping = true;
    wake?.();
  });

// Migrate (under a lock shared with the web service), load the deployment's own secrets, then
// refuse to sign with the public development key.
(process.env.DATABASE_URL ? migrate(process.env.DATABASE_URL) : Promise.resolve([]))
  .then(() => bootstrapSecrets())
  .then(() => {
    assertProductionEnv();
    return loop();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
