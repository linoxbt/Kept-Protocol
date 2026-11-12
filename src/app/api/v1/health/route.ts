import { db } from "@/db/client";
import { json } from "@/lib/http";
import { servAvailable } from "@/services/serv";
import { getSigner, isDevSigner } from "@/receipts/signer";
import { codeCommit } from "@/lib/env";

export async function GET() {
  let database = "ok";
  try {
    await db()`select 1`;
  } catch {
    database = "unavailable";
  }
  const signer = getSigner().address;
  return json(
    { status: database === "ok" ? "ok" : "degraded", database, serv: servAvailable() ? "configured" : "paused", signer, dev_signer: isDevSigner(signer), commit: codeCommit() },
    { status: database === "ok" ? 200 : 503 },
  );
}
