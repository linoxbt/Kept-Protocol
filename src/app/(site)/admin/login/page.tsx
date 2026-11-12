import { Suspense } from "react";
export const metadata = { title: "Admin login" };

export default function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  return (
    <form method="post" action="/api/admin/login" className="max-w-sm mx-auto panel p-6 space-y-4 mt-10">
      <h1 className="subtitle">Admin</h1>
      <p className="text-xs text-muted">Reviewers confirm drafts, run checks and replays. Everything evidential stays public and append-only.</p>
      <input className="input mono" type="password" name="key" placeholder="admin key" required autoFocus />
      <Suspense fallback={<input type="hidden" name="next" value="/admin" />}>
        <ErrorNote searchParams={searchParams} />
      </Suspense>
      <button className="btn w-full justify-center">Sign in</button>
    </form>
  );
}

async function ErrorNote({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const q = await searchParams;
  return (
    <>
      <input type="hidden" name="next" value={q.next ?? "/admin"} />
      {q.error === "locked" ? <p className="text-xs text-breached">Too many failed attempts. Try again in 15 minutes.</p> : q.error ? <p className="text-xs text-breached">That password is not valid.</p> : null}
    </>
  );
}
