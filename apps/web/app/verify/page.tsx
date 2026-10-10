import type { Metadata } from 'next';
import Link from 'next/link';
import { buildKeySet, loadRetiredKeys, loadSigningKey, verifyBadge } from '@vibefycode/badge';
import { lookUpBadgeVerification } from '@/lib/badge-verification';

export const metadata: Metadata = {
  title: 'Check a badge',
  description:
    'Verify a "Verified by VibefyCode" badge signature, and see what it does and does not mean.',
};

export const dynamic = 'force-dynamic';

/**
 * The badge checker.
 *
 * Someone who has been shown a badge and wants to know whether it is real. It
 * answers two separate questions, deliberately kept apart on the page, because
 * conflating them is the whole failure mode: is the signature genuine, and is
 * the badge live right now.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ badge?: string }>;
}) {
  const { badge: badgeId } = await searchParams;

  const lookup = badgeId ? await lookUpBadge(badgeId) : null;
  const record = lookup?.kind === 'issued' ? lookup.record : null;

  const result = record
    ? verifyBadge(
        { payload: record.payload, signature: record.signature },
        buildKeySet(loadSigningKey(), loadRetiredKeys().keys),
      )
    : null;

  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Check a badge</h1>
        <p className="text-muted">
          Paste the badge identifier from a "Verified by VibefyCode" mark — it is the part before{' '}
          <code>.svg</code> in the image URL — and this will tell you what VibefyCode actually
          attested, and whether it still stands.
        </p>
      </header>

      <form method="get" className="flex flex-wrap gap-3">
        <label htmlFor="badge" className="sr-only">
          Badge identifier
        </label>
        <input
          id="badge"
          name="badge"
          defaultValue={badgeId ?? ''}
          placeholder="Badge identifier"
          className="min-w-64 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2"
        />
        <button type="submit" className="rounded-lg bg-accent px-5 py-3 font-medium text-on-accent">
          Check
        </button>
      </form>

      {lookup?.kind === 'never_issued' && (
        <section role="alert" className="rounded-xl border border-line p-5">
          <h2 className="font-semibold text-bad">VibefyCode has never issued that badge</h2>
          <p className="mt-2 text-sm text-muted">
            No badge with that identifier exists. If you were shown a VibefyCode mark linking to it,
            treat the mark as unverified — and please{' '}
            <Link href="/legal/ip-takedown">tell us where you saw it</Link>.
          </p>
        </section>
      )}

      {lookup?.kind === 'unavailable' && (
        <section role="alert" className="rounded-xl border border-line p-5">
          <h2 className="font-semibold text-warn">We could not check that badge just now</h2>
          <p className="mt-2 text-sm text-muted">
            This is a fault on our side: our records would not answer, so we cannot tell you
            anything about this identifier either way. Please try again in a few minutes. Do not
            read this as a statement about the mark you were shown — we have not established
            anything about it.
          </p>
        </section>
      )}

      {record && result && (
        <div className="space-y-6">
          <section aria-labelledby="signature" className="rounded-xl border border-line p-5">
            <h2 id="signature" className="font-semibold">
              1. Is the signature genuine?
            </h2>
            <p className={`mt-2 font-medium ${result.signatureValid ? 'text-ok' : 'text-bad'}`}>
              {result.signatureValid ? 'Yes — VibefyCode issued this.' : 'No.'}
            </p>
            <p className="mt-2 text-sm text-muted">{result.explanation}</p>
          </section>

          <section aria-labelledby="standing" className="rounded-xl border border-line p-5">
            <h2 id="standing" className="font-semibold">
              2. Is the badge live right now?
            </h2>
            <p
              className={`mt-2 font-medium ${
                record.status === 'active'
                  ? 'text-ok'
                  : record.status === 'revoked'
                    ? 'text-bad'
                    : 'text-warn'
              }`}
            >
              {record.status === 'active'
                ? 'Yes — currently verified.'
                : `No — ${record.status}. It must not be displayed.`}
            </p>
            <p className="mt-2 text-sm text-muted">
              This is a separate question from the signature, and it is the one a signature cannot
              answer. Only this origin can, which is why the badge image is served from here rather
              than handed out as a file.
            </p>
            <p className="mt-3 text-sm">
              <Link href={`/a/${record.slug}`}>See the full verification page</Link>
            </p>
          </section>

          <section aria-labelledby="where" className="rounded-xl border border-line p-5">
            <h2 id="where" className="font-semibold">
              3. Where is it licensed to appear?
            </h2>
            <p className="mt-2 text-sm">
              <code>{record.certified_origin}</code>
            </p>
            <p className="mt-2 text-sm text-muted">
              A VibefyCode badge on any other website is being displayed outside its licence,
              whatever its signature says.
            </p>
          </section>
        </div>
      )}

      <section className="rounded-xl border border-line bg-surface-muted p-5 text-sm text-muted">
        <h2 className="font-semibold text-ink">Checking it without us</h2>
        <p className="mt-2">
          The signing keys are published at <code>/.well-known/vibefycode-badge-key</code> as a
          JWKS, and each badge's signed payload is at <code>/api/badge/&lt;identifier&gt;</code>.
          Any Ed25519 implementation can verify it offline. The response documents the exact
          canonicalisation, because two implementations must produce identical bytes or the
          signature check is meaningless.
        </p>
        <h2 className="mt-5 font-semibold text-ink">Building something that shows our mark</h2>
        <p className="mt-2">
          A signature says an assessment happened. It does not say the badge is still live, and
          suspension is how a mark stops meaning anything — so there are two more addresses, both
          public, both open to any origin, neither needing a key or an account.
        </p>
        <ul className="mt-2 space-y-2">
          <li>
            <code>/api/badge/&lt;identifier&gt;/status</code> — is this one live, what was it
            measured against, when, and when does it stop being current. Cached five minutes.
          </li>
          <li>
            <code>/api/badges/live</code> — every live badge in one document, cached an hour, so
            that anything checking a lot of sites can do it locally. There is deliberately no
            &ldquo;does this domain have a badge&rdquo; lookup: it would let a browser extension
            report every page its user visits to us, and this list does the same job without being
            able to.
          </li>
        </ul>
      </section>
    </div>
  );
}

/**
 * Three answers, because the old two could not be told apart.
 *
 * This read ended in `.catch(() => null)`, and `null` was rendered as "VibefyCode
 * has never issued that badge … treat the mark as unverified — and please tell
 * us where you saw it." So a connection the pool could not hand out, a statement
 * timeout, or the database being unreachable made this product accuse a paying
 * customer of displaying a fraudulent mark, to a stranger, and invite that
 * stranger to report them for it — on the strength of our own read failing.
 *
 * It is the same defect `loadAssurance` on `/a/[slug]` was corrected for the
 * night before, one route over, and it was missed because that fix was reasoned
 * about per page rather than swept for.
 */
type BadgeLookup =
  | { kind: 'issued'; record: BadgeRecord }
  | { kind: 'never_issued' }
  | { kind: 'unavailable' };

interface BadgeRecord {
  payload: Record<string, unknown>;
  signature: string;
  status: string;
  slug: string;
  certified_origin: string;
}

async function lookUpBadge(badgeId: string): Promise<BadgeLookup> {
  try {
    // Through `lookUpBadgeVerification`, which tries the direct connection and
    // then Supabase's own API. The view is readable by `anon`, so the API can
    // serve it with the public key and no database URL — which is the route
    // that is still up when a wrong connection string has turned every badge
    // grey. It logs when it falls back, so a working badge over a broken
    // connection string is still something somebody is told about.
    const { row } = await lookUpBadgeVerification(badgeId);
    return row === null ? { kind: 'never_issued' } : { kind: 'issued', record: row };
  } catch {
    // Deliberately carries no detail to the page. What went wrong on our side
    // is ours to read in the logs; a visitor needs to know only that we did not
    // establish anything.
    return { kind: 'unavailable' };
  }
}
