import { isAdminRequest, revokeSessions, SESSION_COOKIE } from "@/lib/auth";

/** Signing out revokes every outstanding admin session, not just this browser's cookie. */
export async function POST(req: Request) {
  if (await isAdminRequest(req).catch(() => false)) await revokeSessions();
  return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
}
