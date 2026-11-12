import { seeOther } from "@/lib/http";
import { db } from "@/db/client";
import { adminSetupOpen, createSession, sessionCookieHeader } from "@/lib/auth";
import { clientIp, problem, route } from "@/lib/http";
import { hashPassword } from "@/lib/secrets";
import { hit } from "@/services/ratelimit";

/** One-time admin setup: only while no admin credential exists. Locks itself once used. */
export const POST = route(async (req: Request) => {
  const limit = await hit(`setup:${clientIp(req)}`, 10, 900);
  if (!limit.allowed) return problem(429, "Too many requests", "wait 15 minutes");
  const form = await req.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  const confirm = String(form?.get("confirm") ?? "");
  const back = (e: string) => seeOther(`/admin/setup?error=${e}`);
  if (password.length < 12) return back("short");
  if (password !== confirm) return back("mismatch");
  if (!(await adminSetupOpen())) return seeOther("/admin/login");
  // `on conflict do nothing`: if two people race, only the first password is ever stored.
  const r = await db()`insert into kept_secrets (name, value) values ('ADMIN_PASSWORD_HASH', ${hashPassword(password)}) on conflict (name) do nothing`;
  if (r.count === 0) return seeOther("/admin/login");
  await db()`insert into admin_log (action) values ('admin_setup')`;
  const s = createSession();
  return new Response(null, { status: 303, headers: { location: "/admin", "set-cookie": sessionCookieHeader(s.value, s.maxAge) } });
});
