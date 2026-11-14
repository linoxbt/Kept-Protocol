/**
 * x402 payments for the agent API. Built lazily from runtime env (never at build time), so a
 * missing pay-to address can never leave the endpoint unprotected: it answers 503 instead.
 * Settlement happens only after a successful (< 400) response, via withX402. A payment is
 * recorded only from the facilitator's settlement result (payer, network, transaction), so
 * revenue accounting never counts a request whose settlement failed.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { db } from "@/db/client";
import { env } from "./env";
import { baseUrl } from "./http";
import { newId } from "./ids";

type Handler = (req: NextRequest) => Promise<NextResponse>;

const cache = new Map<string, Handler>();

export function paid(path: string, description: string, handler: Handler): Handler {
  return async (req: NextRequest) => {
    const e = env();
    if (!e.X402_PAY_TO) {
      return NextResponse.json(
        { type: "https://kept.dev/problems/payments-not-configured", title: "Payments not configured", status: 503, detail: "X402_PAY_TO is not set on this deployment" },
        { status: 503, headers: { "content-type": "application/problem+json" } },
      );
    }
    // Behind the edge proxy the request URL is the internal origin; advertise the public one.
    const resource = `${baseUrl()}${path}`;
    const cacheKey = [path, resource, e.X402_PAY_TO, e.X402_NETWORK, e.X402_PRICE, e.X402_FACILITATOR_URL].join("|");
    let wrapped = cache.get(cacheKey);
    if (!wrapped) {
      const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: e.X402_FACILITATOR_URL })).register(e.X402_NETWORK as `${string}:${string}`, new ExactEvmScheme());
      wrapped = withX402(handler, { [path]: { accepts: [{ scheme: "exact", price: e.X402_PRICE, network: e.X402_NETWORK as `${string}:${string}`, payTo: e.X402_PAY_TO }], description, mimeType: "application/json", resource } }, server);
      cache.set(cacheKey, wrapped);
    }
    const res = await wrapped(req);
    await recordSettlement(res, path, e.X402_PRICE).catch((err) => console.error("[kept] could not record x402 payment", err));
    return res;
  };
}

async function recordSettlement(res: Response, path: string, price: string): Promise<void> {
  const header = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  if (!header) return;
  const s = decodePaymentResponseHeader(header);
  if (!s.success) return;
  await db()`insert into agent_payments (id, payer, network, amount, tx_hash, endpoint)
             values (${newId("kpay")}, ${s.payer ?? null}, ${s.network}, ${price}, ${s.transaction || null}, ${path})`;
}
