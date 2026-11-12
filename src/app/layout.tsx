import type { Metadata } from "next";
import Link from "next/link";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Kept — promises made, evidence tracked, commitments verified", template: "%s · Kept" },
  description:
    "Kept turns public crypto promises into structured commitments, checks them with deterministic code against chain data, and keeps a cited, versioned, replayable record of every result.",
  metadataBase: process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL) : undefined,
};

const NAV = [
  ["Projects", "/projects"],
  ["Try it", "/try"],
  ["Grifter", "/grifter"],
  ["API", "/docs"],
] as const;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen flex flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-xl">
          <nav className="container-k h-14 flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5 shrink-0" aria-label="Kept home">
              <Mark />
              <span className="text-[17px] font-medium tracking-[-0.03em]">Kept</span>
            </Link>
            <div className="hidden md:flex items-center gap-7">
              {NAV.map(([label, href]) => (
                <Link key={href} href={href} className="label !text-muted hover:!text-ink transition-colors">
                  {label}
                </Link>
              ))}
            </div>
            <span className="flex-1" />
            <span className="hidden sm:flex items-center gap-2 label">
              <span className="live-dot" /> Base mainnet
            </span>
            <Link href="/try" className="btn !h-9 !px-4">
              Check a project
            </Link>
          </nav>
          <div className="md:hidden container-k h-10 flex items-center gap-6 border-t border-line overflow-x-auto">
            {NAV.map(([label, href]) => (
              <Link key={href} href={href} className="label">
                {label}
              </Link>
            ))}
          </div>
        </header>
        <main className="flex-1 w-full">{children}</main>
        <footer className="border-t border-line mt-24">
          <div className="container-k py-14 grid gap-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <p className="subtitle max-w-md">
                Code decides facts. <span className="serif italic text-muted">SERV reads the promises.</span>
              </p>
              <p className="text-sm text-muted mt-4 max-w-md">
                Breaches are mechanical facts about stated conditions, never judgments of intent. Not investment advice.
              </p>
            </div>
            <div className="md:col-span-2 md:col-start-8 space-y-2.5">
              <p className="label mb-3">Product</p>
              <Link className="block text-sm text-muted hover:text-ink" href="/projects">Projects</Link>
              <Link className="block text-sm text-muted hover:text-ink" href="/try">Try it</Link>
              <Link className="block text-sm text-muted hover:text-ink" href="/grifter">Grifter</Link>
            </div>
            <div className="md:col-span-2 space-y-2.5">
              <p className="label mb-3">Developers</p>
              <Link className="block text-sm text-muted hover:text-ink" href="/docs">API</Link>
              <a className="block text-sm text-muted hover:text-ink" href="/api/v1/openapi.json">OpenAPI</a>
              <Link className="block text-sm text-muted hover:text-ink" href="/docs#verify">Verify a receipt</Link>
              <a className="block text-sm text-muted hover:text-ink" href="/.well-known/agent-card.json">Agent card</a>
            </div>
            <div className="md:col-span-1 space-y-2.5">
              <p className="label mb-3">Ops</p>
              <Link className="block text-sm text-muted hover:text-ink" href="/admin">Admin</Link>
            </div>
          </div>
          <div className="container-k overflow-hidden">
            <p className="select-none font-medium tracking-[-0.07em] leading-[0.78] text-[clamp(6rem,24vw,22rem)] text-transparent [-webkit-text-stroke:1px_var(--color-line-strong)] -mb-[0.12em]">
              kept
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="0.5" y="0.5" width="21" height="21" fill="none" stroke="var(--color-line-strong)" />
      <path d="M0.5 7V0.5H7M21.5 15v6.5H15" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
      <path d="M6.5 11.2l3 3 6-6.4" fill="none" stroke="var(--color-ink)" strokeWidth="1.6" />
    </svg>
  );
}
