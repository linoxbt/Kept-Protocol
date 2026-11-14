import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { fmtDate, Skeleton } from "@/components/ui";

export default function DemoPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<Skeleton h={300} />}>
      <Demo params={params} />
    </Suspense>
  );
}

/** A clearly labelled demo promise page. It stands in for a project's docs so Precedent can show a real change. */
async function Demo({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const [page] = await db()<{ title: string; body: string; updated_at: Date }[]>`select title, body, updated_at from demo_pages where slug = ${slug}`;
  if (!page) notFound();
  return (
    <article className="max-w-3xl">
      <p className="mono text-xs border border-disputed text-disputed inline-block px-2 py-0.5 mb-6">DEMO PROJECT PAGE — hosted by Kept, not a real team</p>
      <h1 className="title mb-3">{page.title}</h1>
      <p className="text-xs text-muted mono mb-8">last edited {fmtDate(page.updated_at, true)}</p>
      <div className="whitespace-pre-wrap leading-relaxed">{page.body}</div>
    </article>
  );
}
