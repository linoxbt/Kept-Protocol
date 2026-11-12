import { cookies } from "next/headers";
import { SESSION_COOKIE, validSession } from "./auth";

/** For server components. Reads a runtime API, so call it inside a Suspense boundary. */
export async function isAdminSession(): Promise<boolean> {
  const c = await cookies();
  return validSession(c.get(SESSION_COOKIE)?.value);
}
