/** OpenAPI 3.1 description of Kept's public API. Served at /api/v1/openapi.json. */
export function openapi(base: string) {
  const problem = { $ref: "#/components/schemas/Problem" };
  const errors = { "4XX": { description: "Problem details (RFC 9457)", content: { "application/problem+json": { schema: problem } } } };
  const id = (name: string) => ({ name, in: "path", required: true, schema: { type: "string" } });
  const admin = [{ bearer: [] }];
  return {
    openapi: "3.1.0",
    info: {
      title: "Kept Protocol API",
      version: "1.0.0",
      description:
        "Commitment verification. Public reads are signed: Kept-Signature is an EIP-191 signature over the SHA-256 of the response body by Kept-Signer. POSTs accept Idempotency-Key. Errors are RFC 9457 problem details.",
    },
    servers: [{ url: base }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Admin key" } },
      schemas: {
        Problem: { type: "object", properties: { type: { type: "string" }, title: { type: "string" }, status: { type: "integer" }, detail: { type: "string" }, instance: { type: "string" } } },
        Status: { type: "string", enum: ["pending", "awaiting_evidence", "verified", "at_risk", "breached", "unverifiable", "expired", "disputed"] },
      },
    },
    paths: {
      "/api/v1/health": { get: { summary: "Health, signer address and SERV state", responses: { 200: { description: "OK" } } } },
      "/api/v1/projects": {
        get: { summary: "List projects with status counts", responses: { 200: { description: "Projects" } } },
        post: { summary: "Create a project", security: admin, responses: { 201: { description: "Created" }, ...errors } },
      },
      "/api/v1/projects/{id}": { get: { summary: "Project with commitments and sources", parameters: [id("id")], responses: { 200: { description: "Project" }, ...errors } } },
      "/api/v1/sources": { post: { summary: "Capture a URL or text for a project and start extraction", security: admin, responses: { 201: { description: "Snapshot and extraction" }, ...errors } } },
      "/api/v1/sources/{id}/recapture": { post: { summary: "Re-capture a source; classifies the change (Precedent)", security: admin, parameters: [id("id")], responses: { 200: { description: "Watch result" }, ...errors } } },
      "/api/v1/extractions/{id}": { get: { summary: "Extraction drafts (previews are public)", parameters: [id("id")], responses: { 200: { description: "Extraction" }, ...errors } } },
      "/api/v1/extractions/manual": { post: { summary: "Reviewer-written draft, grounded against a snapshot", security: admin, responses: { 201: { description: "Extraction" }, ...errors } } },
      "/api/v1/commitments": { post: { summary: "Confirm a draft as version 1 and start monitoring", security: admin, responses: { 201: { description: "Commitment" }, ...errors } } },
      "/api/v1/commitments/{id}": { get: { summary: "Commitment with current status", parameters: [id("id")], responses: { 200: { description: "Commitment" }, ...errors } } },
      "/api/v1/commitments/{id}/verify": { post: { summary: "Run a check now", security: admin, parameters: [id("id")], responses: { 200: { description: "Check result and receipt" }, ...errors } } },
      "/api/v1/commitments/{id}/versions": {
        get: { summary: "Version history", parameters: [id("id")], responses: { 200: { description: "Versions" } } },
        post: { summary: "Confirm a policy change as the next version", security: admin, parameters: [id("id")], responses: { 201: { description: "Version" }, ...errors } },
      },
      "/api/v1/commitments/{id}/diff": {
        get: {
          summary: "Field diff, word diff and retroactive-revision flags between two versions",
          parameters: [id("id"), { name: "from", in: "query", schema: { type: "integer" } }, { name: "to", in: "query", schema: { type: "integer" } }],
          responses: { 200: { description: "Diff" }, ...errors },
        },
      },
      "/api/v1/hindcast": { post: { summary: "Replay versions over historical evidence", security: admin, responses: { 201: { description: "Run and receipt" }, ...errors } } },
      "/api/v1/hindcast/{id}": { get: { summary: "A replay run", parameters: [id("id")], responses: { 200: { description: "Run" }, ...errors } } },
      "/api/v1/receipts/{id}": { get: { summary: "Receipt JSON as hashed and signed, with inclusion proof once anchored", parameters: [id("id")], responses: { 200: { description: "Receipt" }, ...errors } } },
      "/api/v1/anchors/pending": { get: { summary: "Merkle root of receipts awaiting anchoring", responses: { 200: { description: "Root" } } } },
      "/api/v1/anchors/{id}": { get: { summary: "An anchor: Merkle root, EAS UID, transaction", parameters: [id("id")], responses: { 200: { description: "Anchor" }, ...errors } } },
      "/api/v1/feed": { get: { summary: "Recent status changes", responses: { 200: { description: "Feed" } } } },
      "/api/v1/webhooks": { post: { summary: "Register a signed webhook; the secret is returned once", security: admin, responses: { 201: { description: "Webhook" }, ...errors } } },
      "/api/v1/tryit": { post: { summary: "Try-it preview extraction (public, rate-limited, never published)", responses: { 201: { description: "Unconfirmed preview" }, ...errors } } },
      "/api/v1/tryit/{id}/check": { post: { summary: "Run a preview check on one draft; attribution stays unconfirmed", parameters: [id("id")], responses: { 200: { description: "Unconfirmed preview result" }, ...errors } } },
      "/api/v1/agent/commitments": {
        get: {
          summary: "Agent lookup by token, paid per query over x402",
          parameters: [
            { name: "chain_id", in: "query", schema: { type: "integer", enum: [8453, 84532] } },
            { name: "token", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Signed records with coverage none|partial|full" }, 402: { description: "Payment required (x402)" }, ...errors },
        },
      },
      "/api/v1/grifter/runs": {
        get: { summary: "Recent Grifter runs", responses: { 200: { description: "Runs" } } },
        post: { summary: "Run the adversarial suite", security: admin, responses: { 201: { description: "Report" } } },
      },
      "/.well-known/agent-card.json": { get: { summary: "ERC-8004-style agent registration file with Kept's signer address", responses: { 200: { description: "Agent card" } } } },
    },
  };
}
