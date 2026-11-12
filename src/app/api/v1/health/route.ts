import { db } from "@/db/client";
import { clientIpInfo, json } from "@/lib/http";
import { servAvailable } from "@/services/serv";
import { getSigner, isDevSigner } from "@/receipts/signer";
import { codeCommit } from "@/lib/env";
import { secretsEncrypted } from "@/lib/secrets";
import { anchorStatus } from "@/services/anchor";

export async function GET(req: Request) {
  let database = "ok";
  try {
    await db()`select 1`;
  } catch {
    database = "unavailable";
  }
  const signer = getSigner().address;
  const anchoring = database === "ok" ? await anchorStatus().catch(() => null) : null;
  return json(
    {
      status: database === "ok" ? "ok" : "degraded",
      database,
      serv: servAvailable() ? "configured" : "paused",
      signer,
      dev_signer: isDevSigner(signer),
      secrets_encrypted_at_rest: secretsEncrypted(),
      anchoring,
      client_ip_source: clientIpInfo(req).source,
      commit: codeCommit(),
    },
    { status: database === "ok" ? 200 : 503 },
  );
}
