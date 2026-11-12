import { createSession, sessionCookieHeader, verifyCredential } from "@/lib/auth";
import { route, seeOther } from "@/lib/http";

/** Form login. Failed attempts are limited per IP and globally (see verifyCredential). */
export const POST = route(async (req: Request) => {
  const form = await req.formData().catch(() => null);
  const key = String(form?.get("key") ?? "");
  const next = String(form?.get("next") ?? "/admin");
  const safeNext = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/admin";
  let ok: boolean;
  try {
    ok = await verifyCredential(req, key);
  } catch {
    return seeOther(`/admin/login?error=locked`);
  }
  if (!ok) return seeOther(`/admin/login?error=1`);
  const s = await createSession();
  return new Response(null, { status: 303, headers: { location: safeNext, "set-cookie": sessionCookieHeader(s.value, s.maxAge) } });
});
