import { db } from "@/db/client";
import { clientIpInfo, json } from "@/lib/http";
import { servAvailable } from "@/services/serv";
import { getSigner, isDevSigner } from "@/receipts/signer";
import { codeCommit } from "@/lib/env";
import { secretsEncrypted } from "@/lib/secrets";
import { anchorStatus } from "@/services/anchor";
import { demoStatus } from "@/services/demo";

export async function GET(req: Request) {
  let database = "ok";
  try {
    await db()`select 1`;
  } catch {
    database = "unavailable";
  }
  const signer = getSigner().address;
  const [anchoring, demo] = database === "ok" ? await Promise.all([anchorStatus().catch(() => null), demoStatus()]) : [null, null];
  return json(
    {
      status: database === "ok" ? "ok" : "degraded",
      database,
      serv: servAvailable() ? "configured" : "paused",
      signer,
      dev_signer: isDevSigner(signer),
      secrets_encrypted_at_rest: secretsEncrypted(),
      anchoring,
      live_demo: demo ? { stage: demo.stage, chain_id: demo.chain_id, token: demo.token, commitment_id: demo.commitment_id ?? null } : { stage: "not started" },
      client_ip_source: clientIpInfo(req).source,
      commit: codeCommit(),
    },
    { status: database === "ok" ? 200 : 503 },
  );
}
