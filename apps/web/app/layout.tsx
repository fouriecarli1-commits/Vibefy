import type { Metadata } from 'next';
import Link from 'next/link';
import { JetBrains_Mono, Poppins } from 'next/font/google';
import { SiteNav } from '@/components/site-nav';
import './globals.css';

/*
 * The brand faces, actually loaded.
 *
 * Poppins was named in the font stack and fetched by nothing, so every page
 * rendered in whatever the visitor's system happened to use — which is most of
 * the reason the product looked unfinished. `next/font` downloads and
 * self-hosts them at build time, so there is no third-party request at runtime
 * and no layout shift while a face arrives.
 *
 * The mono face is not decoration. This product's content is scores, rule ids,
 * hashes, key identifiers and timestamps, and those are read by comparing
 * characters rather than by reading words. Tabular figures are the difference
 * between a column of numbers you can scan and one you have to squint at.
 */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'VibefyCode — the vibe app rating system',
    template: '%s · VibefyCode',
  },
  description:
    'VibefyCode assesses AI-built apps against a published rubric and issues a revocable, point-in-time "Verified by VibefyCode" mark. Scope-limited assessment, not a security guarantee.',
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
    <html lang="en" className={`${poppins.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-surface text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-4 focus:py-2"
        >
          Skip to content
        </a>

        <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur">
          <nav aria-label="Primary">
            <SiteNav />
          </nav>
        </header>

        <main id="main" className="mx-auto max-w-6xl px-6 py-12">
          {children}
        </main>

        <footer className="mt-16 border-t border-line">
          <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-muted">
            <p className="max-w-3xl">
              A VibefyCode assessment is a point-in-time, scope-limited, AI-assisted and
              human-reviewed evaluation against a published rubric version on a stated date. It is
              not a penetration test, a security audit, or a guarantee of any kind. Absence of a
              finding is not evidence of absence of a defect.
            </p>
            <p className="mt-4 flex flex-wrap gap-4">
              <Link href="/directory">Directory</Link>
              <Link href="/methodology">Methodology</Link>
              <Link href="/legal">Legal</Link>
              <Link href="/legal/rating-methodology-and-independence">Independence policy</Link>
              <Link href="/legal/responsible-disclosure">Responsible disclosure</Link>
              <Link href="/verify">Check a badge</Link>
            </p>
            <p className="mt-4">© {new Date().getFullYear()} VibefyCode</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
