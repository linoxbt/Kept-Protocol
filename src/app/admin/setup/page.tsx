import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { adminSetupOpen } from "@/lib/auth";

export const metadata = { title: "Admin setup" };

export default function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <Suspense fallback={null}>
      <Setup searchParams={searchParams} />
    </Suspense>
  );
}

async function Setup({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  if (!(await adminSetupOpen())) redirect("/admin/login");
  const { error } = await searchParams;
  return (
    <form method="post" action="/api/admin/setup" className="max-w-sm mx-auto mt-16 space-y-4">
      <p className="label">One-time setup</p>
      <h1 className="text-3xl tracking-tight">Set the admin password</h1>
      <p className="text-sm text-muted">This page works once. After you set a password it locks, and reviewers sign in with it.</p>
      <input className="input" type="password" name="password" placeholder="password (12+ characters)" minLength={12} required autoFocus />
      <input className="input" type="password" name="confirm" placeholder="repeat password" minLength={12} required />
      {error === "short" ? <p className="text-xs text-breached">Use at least 12 characters.</p> : null}
      {error === "mismatch" ? <p className="text-xs text-breached">The passwords do not match.</p> : null}
      <button className="btn w-full justify-center">Set password and sign in</button>
    </form>
  );
}
