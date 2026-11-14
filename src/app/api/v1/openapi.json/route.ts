import { baseUrl } from "@/lib/http";
import { openapi } from "@/lib/openapi";

export async function GET(req: Request) {
  return Response.json(openapi(baseUrl(req)), { headers: { "cache-control": "public, max-age=300" } });
}
