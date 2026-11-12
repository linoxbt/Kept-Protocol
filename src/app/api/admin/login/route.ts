import { seeOther } from "@/lib/http";
import { checkAdminKey, createSession, sessionCookieHeader } from "@/lib/auth";
import { clientIp, problem, route } from "@/lib/http";
import { hit } from "@/services/ratelimit";

export const POST = route(async (req: Request) => {
  const limit = await hit(`login:${clientIp(req)}`, 10, 900);
  if (!limit.allowed) return problem(429, "Too many requests", "too many login attempts; wait 15 minutes");
  const form = await req.formData().catch(() => null);
  const key = String(form?.get("key") ?? "");
  const next = String(form?.get("next") ?? "/admin");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
  if (!(await checkAdminKey(key))) return seeOther(`/admin/login?error=1`);
  const s = createSession();
  return new Response(null, {
    status: 303,
    headers: {
      location: safeNext,
      "set-cookie": sessionCookieHeader(s.value, s.maxAge),
    },
  });
});
