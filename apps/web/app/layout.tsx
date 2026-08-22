import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Vibefy — the vibe app rating system',
    template: '%s · Vibefy',
  },
  description:
    'Vibefy assesses AI-built apps against a published rubric and issues a revocable, point-in-time "Verified by Vibefy" mark. Scope-limited assessment, not a security guarantee.',
  icons: {
    icon: [
      { url: '/brand/favicon-32.png', sizes: '32x32' },
      { url: '/brand/favicon-16.png', sizes: '16x16' },
    ],
    apple: '/brand/apple-touch-icon-180.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-surface text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-4 focus:py-2"
        >
          Skip to content
        </a>

        <header className="border-b border-line">
          <nav
            aria-label="Primary"
            className="mx-auto flex max-w-5xl flex-wrap items-center gap-6 px-6 py-4"
          >
            <Link href="/" className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/vibefy-mark.svg" alt="" width={36} height={36} aria-hidden="true" />
              <span className="text-lg font-bold tracking-tight">Vibefy</span>
            </Link>
            <div className="ml-auto flex flex-wrap items-center gap-5 text-sm">
              <Link href="/directory">Directory</Link>
              <Link href="/methodology">Methodology</Link>
              <Link href="/console">Console</Link>
              <Link href="/console/portfolio">Portfolio</Link>
              <Link href="/review">Review</Link>
              <Link href="/verify">Check a badge</Link>
              <Link href="/console/alerts">Alerts</Link>
              <Link href="/console/billing">Billing</Link>
              <Link
                href="/sign-in"
                className="rounded-lg border border-line-strong px-3 py-1.5 font-medium"
              >
                Sign in
              </Link>
            </div>
          </nav>
        </header>

        <main id="main" className="mx-auto max-w-5xl px-6 py-12">
          {children}
        </main>

        <footer className="mt-16 border-t border-line">
          <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-muted">
            <p className="max-w-3xl">
              A Vibefy assessment is a point-in-time, scope-limited, AI-assisted and human-reviewed
              evaluation against a published rubric version on a stated date. It is not a
              penetration test, a security audit, or a guarantee of any kind. Absence of a finding
              is not evidence of absence of a defect.
            </p>
            <p className="mt-4 flex flex-wrap gap-4">
              <Link href="/directory">Directory</Link>
              <Link href="/methodology">Methodology</Link>
              <Link href="/legal">Legal</Link>
              <Link href="/legal/rating-methodology-and-independence">Independence policy</Link>
              <Link href="/legal/responsible-disclosure">Responsible disclosure</Link>
              <Link href="/verify">Check a badge</Link>
            </p>
            <p className="mt-4">© {new Date().getFullYear()} Vibefy</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
