import { getChain } from "@/chain";
import { json, route } from "@/lib/http";

let cache: { at: number; body: object } | null = null;

/** Live Base head for the UI's instrument bar: finalized vs latest block and the finality lag. */
export const GET = route(async () => {
  if (cache && Date.now() - cache.at < 10_000) return json(cache.body, { cache: "public, max-age=10" });
  const { primary } = getChain(8453);
  const [fin, latest] = await Promise.all([primary.finalizedBlock(), primary.latestBlock()]);
  const body = { chain_id: 8453, latest: latest.number.toString(), finalized: fin.number.toString(), finality_lag_s: latest.timestamp - fin.timestamp, latest_time: latest.timestamp };
  cache = { at: Date.now(), body };
  return json(body, { cache: "public, max-age=10" });
});
