import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Kept — promises made, evidence tracked, commitments verified", template: "%s · Kept" },
  description:
    "Kept turns public crypto promises into structured commitments, checks them with deterministic code against chain data, and keeps a cited, versioned, replayable record of every result.",
  metadataBase: process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL) : undefined,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-line">
          <nav className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-6 text-sm">
            <Link href="/" className="mono font-semibold tracking-tight flex items-center gap-2">
              <span className="text-accent">[</span>kept<span className="text-accent">]</span>
            </Link>
            <Link href="/projects" className="text-muted hover:text-ink">Projects</Link>
            <Link href="/try" className="text-muted hover:text-ink">Try it</Link>
            <Link href="/grifter" className="text-muted hover:text-ink">Grifter</Link>
            <Link href="/docs" className="text-muted hover:text-ink">API</Link>
            <span className="flex-1" />
            <Link href="/admin" className="text-faint hover:text-ink mono text-xs">admin</Link>
          </nav>
        </header>
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-8">{children}</main>
        <footer className="border-t border-line">
          <div className="max-w-7xl mx-auto px-4 py-6 text-xs text-faint flex flex-wrap gap-x-6 gap-y-2">
            <span>Code decides facts. SERV reads the promises.</span>
            <span>Breaches are mechanical facts about stated conditions, never judgments of intent.</span>
            <span>Not investment advice.</span>
            <Link href="/docs#verify" className="hover:text-ink">Verify a receipt yourself</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
