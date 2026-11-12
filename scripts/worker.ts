/**
 * Long-running monitor for a container host (Railway, Fly, a VM). Runs one tick every
 * KEPT_TICK_SECONDS (default 60): due checks, source watching, deadline alerts, webhooks.
 * Several workers can run at once; checks are claimed with SKIP LOCKED.
 */
import { closeDb } from "../src/db/client";
import { assertProductionEnv } from "../src/lib/env";
import { bootstrapSecrets } from "../src/lib/secrets";
import { tick } from "../src/services/monitor";


const every = Number(process.env.KEPT_TICK_SECONDS ?? 60) * 1000;
let stopping = false;

async function loop() {
  while (!stopping) {
    const t0 = Date.now();
    try {
      const r = await tick({ maxChecks: 25, maxSources: 5, deadlineMs: Math.max(20_000, every - 5_000) });
      const errors = r.checks.filter((c) => c.error);
      console.log(
        JSON.stringify({ at: new Date().toISOString(), checks: r.checks.length, changed: r.checks.filter((c) => c.changed).length, errors: errors.length, sources: r.sources.length, webhooks: r.outbox, ms: r.ms }),
      );
      for (const e of errors) console.error(`check ${e.commitmentId} failed: ${e.error}`);
    } catch (e) {
      console.error("tick failed", e);
    }
    const wait = every - (Date.now() - t0);
    if (wait > 0 && !stopping) await new Promise((r) => setTimeout(r, wait));
  }
  await closeDb();
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => (stopping = true));

// Load the deployment's own secrets, then refuse to sign with the public development key.
bootstrapSecrets()
  .then(() => {
    assertProductionEnv();
    return loop();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
