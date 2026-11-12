import { SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
}
