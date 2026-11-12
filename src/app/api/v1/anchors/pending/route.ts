import { json, route } from "@/lib/http";
import { pendingRoot } from "@/services/anchor";

/** The Merkle root the next anchor will attest, published ahead of time for transparency. */
export const GET = route(async () => {
  const p = await pendingRoot();
  return json({ merkle_root: p.root, receipt_count: p.count }, { sign: true });
});
