/**
 * Anchors every unanchored receipt: Merkle root → EAS attestation on Base.
 *   npm run anchor -- --register-schema   one-time: registers the anchor schema (idempotent)
 *   npm run anchor                         attests the pending root
 * Needs ANCHOR_PRIVATE_KEY (funded with a little ETH on the target chain) and DATABASE_URL.
 * ANCHOR_CHAIN_ID=84532 targets Base Sepolia.
 */
import { closeDb } from "../src/db/client";
import { anchorPending, registerAnchorSchema, schemaUid } from "../src/services/anchor";

async function main() {
  const chainId = Number(process.env.ANCHOR_CHAIN_ID ?? 8453);
  if (process.argv.includes("--register-schema")) {
    const r = await registerAnchorSchema(chainId);
    console.log(r.tx ? `registered schema ${r.uid} in ${r.tx}` : `schema ${r.uid} already registered`);
    return;
  }
  console.log(`schema ${process.env.EAS_SCHEMA_UID ?? schemaUid()} on chain ${chainId}`);
  const r = await anchorPending(undefined, chainId);
  console.log(r ? `anchored ${r.count} receipt(s): root ${r.root}, EAS uid ${r.uid}, tx ${r.tx}` : "nothing to anchor");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
