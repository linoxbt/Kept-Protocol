import { baseUrl } from "@/lib/http";
import { getSigner } from "@/receipts/signer";

/**
 * ERC-8004-style agent registration file. Publishes Kept's receipt-signing address so buyers can
 * check provenance of signed responses and receipts. The on-chain identity registration points here.
 */
export async function GET(req: Request) {
  const base = baseUrl(req);
  const body = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Kept Protocol",
    description: "Commitment verification: public crypto promises checked against chain data by deterministic code, with signed, reproducible receipts.",
    image: `${base}/icon.svg`,
    services: [
      { name: "web", endpoint: base },
      { name: "agent-api", endpoint: `${base}/api/v1/agent/commitments`, payment: "x402" },
      { name: "openapi", endpoint: `${base}/api/v1/openapi.json` },
    ],
    signer: { scheme: "eip191", address: getSigner().address, signs: ["receipts", "Kept-Signature response header"] },
    supportedTrust: ["reputation", "crypto-economic"],
  };
  return Response.json(body, { headers: { "cache-control": "public, max-age=300" } });
}
