import { NextResponse, type NextRequest } from "next/server";
import { getAddress, isAddress } from "viem";
import { baseUrl, clientIp } from "@/lib/http";
import { signBody } from "@/receipts/signer";
import { agentLookup } from "@/services/queries";
import { hit } from "@/services/ratelimit";
import { paid } from "@/lib/x402";

export const maxDuration = 60;

/**
 * Agent lookup, paid per query over x402. Unknown tokens return 200 with coverage "none", so an
 * agent never reads "no record" as "clean". Responses are signed (Kept-Signature).
 */
async function handler(req: NextRequest): Promise<NextResponse> {
  const u = new URL(req.url);
  const chainId = Number(u.searchParams.get("chain_id") ?? 8453);
  const token = u.searchParams.get("token") ?? "";
  if (!isAddress(token, { strict: false }) || ![8453, 84532].includes(chainId)) {
    return NextResponse.json({ title: "Bad request", status: 400, detail: "chain_id must be 8453 or 84532 and token a valid address" }, { status: 400, headers: { "content-type": "application/problem+json" } });
  }
  const limit = await hit(`agent:${clientIp(req)}`, 120, 60);
  if (!limit.allowed) return NextResponse.json({ title: "Too many requests", status: 429 }, { status: 429 });
  const data = await agentLookup(chainId, getAddress(token), baseUrl(req));
  const body = JSON.stringify(data);
  const { signature, signer } = await signBody(body);
  return new NextResponse(body, { status: 200, headers: { "content-type": "application/json", "kept-signature": signature, "kept-signer": signer, "cache-control": "no-store" } });
}

export const GET = paid("/api/v1/agent/commitments", "Kept commitment records and receipts for a token", handler);
