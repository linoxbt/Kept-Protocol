/** Client helper: follows a 202 response's `poll` URL until the background job finishes. */
export async function pollJob<T = Record<string, unknown>>(poll: string, opts: { intervalMs?: number; timeoutMs?: number; onTick?: (elapsedMs: number) => void } = {}): Promise<T> {
  const started = Date.now();
  const every = opts.intervalMs ?? 2_000;
  const timeout = opts.timeoutMs ?? 10 * 60_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, every));
    opts.onTick?.(Date.now() - started);
    const res = await fetch(poll, { cache: "no-store" });
    const job = (await res.json().catch(() => ({}))) as { status?: string; result?: T; error?: string; detail?: string };
    if (!res.ok) throw new Error(job.detail ?? `polling failed (${res.status})`);
    if (job.status === "done") return job.result as T;
    if (job.status === "failed") throw new Error(job.error ?? "the job failed");
    if (Date.now() - started > timeout) throw new Error("still running; refresh the page later to see the result");
  }
}

/** If a response is a 202 job, wait for the job; otherwise return the response body. */
export async function resolveJob<T = Record<string, unknown>>(json: Record<string, unknown>, onTick?: (elapsedMs: number) => void): Promise<T> {
  if (typeof json.poll === "string" && json.status === "running") return pollJob<T>(json.poll, { onTick });
  return json as T;
}
