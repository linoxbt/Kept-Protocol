/**
 * x402 payments for the agent API. Built lazily from runtime env (never at build time), so a
 * missing pay-to address can never leave the endpoint unprotected: it answers 503 instead.
 * Settlement happens only after a successful (< 400) response, via withX402.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { env } from "./env";

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
    let wrapped = cache.get(path);
    if (!wrapped) {
      const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: e.X402_FACILITATOR_URL })).register(e.X402_NETWORK as `${string}:${string}`, new ExactEvmScheme());
      wrapped = withX402(handler, { [path]: { accepts: [{ scheme: "exact", price: e.X402_PRICE, network: e.X402_NETWORK as `${string}:${string}`, payTo: e.X402_PAY_TO }], description, mimeType: "application/json" } }, server);
      cache.set(path, wrapped);
    }
    return wrapped(req);
  };
}
