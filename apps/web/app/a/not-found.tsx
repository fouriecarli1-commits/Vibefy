'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * What somebody sees when a badge points at a page we cannot find.
 *
 * Until now this fell through to the site-wide "Page not found. That page does
 * not exist, or it moved." — which is the worst sentence available here. The
 * person reading it clicked a trust mark on a stranger's website to check
 * whether it meant anything. Telling them our site is broken answers a question
 * they did not ask and leaves the one they did ask open, in the direction that
 * flatters whoever displayed the mark.
 *
 * So this page answers it: this identifier is not one we have issued. It is
 * careful about what that does and does not imply — it is a fact about our
 * records, not a judgement about the application — and it says what the two
 * innocent explanations are before it mentions the other one.
 *
 * It also shows the identifier that was requested, because the two people most
 * likely to be standing here are somebody who pasted a snippet incorrectly and
 * somebody checking a mark they suspect. Both need to see it.
 */
export default function BadgeNotFound() {
  const pathname = usePathname();
  const requested = decodeURIComponent(pathname.replace(/^\/a\//, '')) || '(none)';

  return (
    <article className="max-w-3xl space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">We have not issued this badge</h1>
        <p className="max-w-prose text-muted">
          Nothing in our records matches the identifier this link asked for. That is a fact about
          our records and not a judgement about the application you came from — but it does mean the
          mark you clicked is not currently backed by anything we can show you.
        </p>
      </header>

      <section className="rounded-xl border border-line bg-surface-muted p-5">
        <p className="text-sm text-muted">The identifier requested</p>
        <p className="mt-1 break-all font-mono text-sm">{requested}</p>
      </section>

      <section aria-labelledby="why" className="space-y-3">
        <h2 id="why" className="text-xl font-semibold">
          The usual reasons
        </h2>
        <ul className="max-w-prose list-disc space-y-2 pl-5 text-muted">
          <li>
            <strong className="text-fg">The snippet was altered.</strong> The embed code we hand out
            carries the identifier in two places, the image and the link. If one of them was
            retyped, shortened, or rewritten by a tool, the image can still load while the link
            points nowhere. This is the most common cause by a distance.
          </li>
          <li>
            <strong className="text-fg">The badge was withdrawn and removed.</strong> A suspended or
            revoked badge still has a page, and that page says so plainly. One deleted outright does
            not — so this is the rarer case.
          </li>
          <li>
            <strong className="text-fg">The mark was copied from somewhere else.</strong> Our badges
            are served from our own servers on every page load, and each one is licensed to a single
            origin. A mark saved as an image file and pasted onto another site has no page behind it
            because it was never issued for that site.
          </li>
        </ul>
      </section>

      <section aria-labelledby="what-now" className="space-y-3 rounded-xl border border-line p-5">
        <h2 id="what-now" className="text-lg font-semibold">
          What you can do
        </h2>
        <ul className="space-y-2 text-sm">
          <li>
            If this is your badge: open your application in <Link href="/console">the console</Link>{' '}
            and copy the snippet again in full. Do not edit it — the licence does not permit an
            altered mark, and an edited link is how you got here.
          </li>
          <li>
            If you are checking somebody else&apos;s: the <Link href="/directory">directory</Link>{' '}
            lists every application with a live badge, and you can{' '}
            <Link href="/verify">check a signed payload</Link> against our published key.
          </li>
          <li>
            If you believe a mark is being displayed improperly,{' '}
            <Link href="/legal/ip-takedown">tell us</Link>.
          </li>
        </ul>
      </section>

      {/* The same section the verification page ends with, for the same reason.

          Somebody standing here clicked a trust mark on a stranger's website to
          find out what it meant. That they landed on a failure does not make
          them less curious — it makes them the one visitor certain to have
          wondered what VibefyCode is, and until now this page answered by
          offering them nowhere to go. */}
      <section
        aria-labelledby="what-this-is"
        className="space-y-3 rounded-xl border border-line-strong p-6"
      >
        <h2 id="what-this-is" className="text-lg font-semibold">
          What is VibefyCode?
        </h2>
        <p className="max-w-prose text-muted">
          An independent assessment of applications built quickly, often with AI. We test what we
          can reach from outside — with the owner&apos;s written authorisation and never their
          source code — score it against a <Link href="/methodology">published rubric</Link>, and a
          person reviews every result before anything is certified.
        </p>
        <p className="flex flex-wrap gap-4 text-sm">
          <Link href="/" className="nav-cta">
            Get your application assessed
          </Link>
          <Link href="/how-it-works" className="self-center">
            What happens to your app
          </Link>
        </p>
      </section>

      <footer className="border-t border-line pt-6 text-sm text-muted">
        <p>
          A VibefyCode assessment is scope-limited: it says what was checked and when, and nothing
          beyond that. <Link href="/how-it-works">What we do and do not test</Link>.
        </p>
      </footer>
    </article>
  );
}
