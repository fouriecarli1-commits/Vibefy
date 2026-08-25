import type { Metadata } from 'next';
import Link from 'next/link';
import { buildKeySet, loadRetiredKeys, loadSigningKey, verifyBadge } from '@vibefycode/badge';
import { readAsAnon } from '@/lib/sql';

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

  const record = badgeId
    ? await readAsAnon(async (client) => {
        const { rows } = await client.query<{
          payload: Record<string, unknown>;
          signature: string;
          status: string;
          slug: string;
          certified_origin: string;
        }>(
          `select payload, signature, status, slug, certified_origin
             from public.badge_verification where public_id = $1`,
          [badgeId],
        );
        return rows[0] ?? null;
      }).catch(() => null)
    : null;

  const result = record
    ? verifyBadge(
        { payload: record.payload, signature: record.signature },
        buildKeySet(loadSigningKey(), loadRetiredKeys()),
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
        <button
          type="submit"
          className="rounded-lg bg-accent px-5 py-2.5 font-medium text-on-accent"
        >
          Check
        </button>
      </form>

      {badgeId && !record && (
        <section role="alert" className="rounded-xl border border-line p-5">
          <h2 className="font-semibold text-bad">VibefyCode has never issued that badge</h2>
          <p className="mt-2 text-sm text-muted">
            No badge with that identifier exists. If you were shown a VibefyCode mark linking to it,
            treat the mark as unverified — and please{' '}
            <Link href="/legal/ip-takedown">tell us where you saw it</Link>.
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
      </section>
    </div>
  );
}
