import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  scopeStatement,
  AI_DISCLOSURE,
  MARKETING_CLIENT_DISCLOSURE,
  REMEDIATION_CLIENT_DISCLOSURE,
} from '@vibefycode/shared';
import { readAsAnon } from '@/lib/sql';
import { resolveVerifyOrigin } from '@/lib/verify-origin.server';

/**
 * The verification page.
 *
 * "Verified by VibefyCode" is defensible only because this page defines precisely
 * what was verified. The mark is a pointer; this is the substance — so the
 * scope-and-limitations block sits above the fold, before the score, not in a
 * footer where nobody reads it.
 */
export const dynamic = 'force-dynamic';

interface BadgeRecord {
  public_id: string;
  slug: string;
  status: 'active' | 'suspended' | 'expired' | 'revoked';
  score: string;
  rubric_version: string;
  assessed_at: string;
  issued_at: string;
  expires_at: string;
  certified_origin: string;
  signature: string;
  signing_key_id: string;
  app_name: string;
  owner_name: string;
  owner_is_marketing_client: boolean;
  owner_has_remediation: boolean;
}

async function loadBadge(slug: string): Promise<BadgeRecord | null> {
  return readAsAnon(async (client) => {
    const { rows } = await client.query<BadgeRecord>(
      `select public_id, slug, status, score, rubric_version, assessed_at, issued_at, expires_at,
              certified_origin, signature, signing_key_id, app_name, owner_name,
              owner_is_marketing_client, owner_has_remediation
         from public.badge_verification where slug = $1`,
      [slug],
    );
    return rows[0] ?? null;
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const badge = await loadBadge(slug).catch(() => null);
  if (!badge) return { title: 'Badge not found' };

  const assessedOn = new Date(badge.assessed_at).toISOString().slice(0, 10);
  const title = `${badge.app_name} — Verified by VibefyCode`;
  const description = `${badge.app_name} was assessed against VibefyCode Rubric v${badge.rubric_version} on ${assessedOn}. Scope-limited assessment, not a security guarantee.`;
  const origin = await resolveVerifyOrigin();

  return {
    title,
    description,
    robots: { index: badge.status === 'active', follow: true },
    alternates: { canonical: `${origin}/a/${badge.slug}` },
    // A verification URL is the one link this product has that people send to
    // each other — an owner showing somebody their result, or somebody asking
    // whether a mark is real. Pasted into a message it rendered as a bare
    // address, which is the difference between a product and a URL.
    //
    // The card says exactly what the page says, from the same two constants. A
    // share preview that promised more than the assessment does would be the
    // same over-claim the wordmark is forbidden from making, committed in the
    // place most likely to be seen and least likely to be read carefully.
    openGraph: {
      type: 'article',
      siteName: 'VibefyCode',
      url: `${origin}/a/${badge.slug}`,
      title,
      description,
      images: [{ url: `${origin}/brand/icon.png`, width: 1024, height: 1024, alt: 'VibefyCode' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${origin}/brand/icon.png`],
    },
  };
}

const STATUS_COPY: Record<BadgeRecord['status'], { label: string; tone: string; meaning: string }> =
  {
    active: {
      label: 'Currently verified',
      tone: 'text-ok',
      meaning:
        'This badge is live. It may be displayed on the certified origin below, and nowhere else.',
    },
    suspended: {
      label: 'Suspended',
      tone: 'text-warn',
      meaning:
        'This badge is not currently valid. It may have been suspended because a subscription lapsed, because a re-assessment found a material regression, or because the application stopped responding. It must not be displayed.',
    },
    expired: {
      label: 'Expired',
      tone: 'text-warn',
      meaning:
        'This assessment has passed its expiry date. What it found was true on the date below; it says nothing about the application today, and the badge must no longer be displayed.',
    },
    revoked: {
      label: 'Revoked',
      tone: 'text-bad',
      meaning:
        'VibefyCode withdrew this badge. It must not be displayed anywhere, and displaying it is a breach of the Badge Licence.',
    },
  };

export default async function VerificationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const badge = await loadBadge(slug);
  if (!badge) notFound();

  const assessedOn = new Date(badge.assessed_at).toISOString().slice(0, 10);
  const status = STATUS_COPY[badge.status];
  // The same resolution the embed snippet uses. It was reading the environment
  // directly and falling back to an empty string, so on a deployment with
  // neither variable set this page told a sceptic to fetch our public key from
  // "/.well-known/vibefycode-badge-key" — a path with no host in front of it.
  // The one instruction on the page whose whole purpose is that somebody can
  // follow it without trusting us.
  const verifyOrigin = await resolveVerifyOrigin();

  return (
    <article className="max-w-3xl space-y-10">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/badge/${badge.public_id}.svg`}
            alt={`Verified by VibefyCode — ${badge.app_name}, Rubric v${badge.rubric_version}, assessed ${assessedOn}. Scope-limited assessment, not a security guarantee.`}
            width={128}
            height={128}
          />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{badge.app_name}</h1>
            <p className={`mt-1 font-medium ${status.tone}`}>{status.label}</p>
            <p className="text-sm text-muted">Owned by {badge.owner_name}</p>
          </div>
        </div>
        <p className="max-w-prose text-muted">{status.meaning}</p>
      </header>

      {/* Above the fold, before the score. The mark is a pointer; this is the substance. */}
      <section
        aria-labelledby="scope"
        className="rounded-xl border border-line bg-surface-muted p-6"
      >
        <h2 id="scope" className="text-lg font-semibold">
          What was assessed, and what was not
        </h2>
        <p className="mt-3">
          {scopeStatement({
            appName: badge.app_name,
            rubricVersion: badge.rubric_version,
            assessedOn,
          })}
        </p>
        <p className="mt-3 text-sm text-muted">{AI_DISCLOSURE}</p>
      </section>

      {badge.owner_has_remediation && (
        <section role="note" className="rounded-xl border border-line p-5">
          <h2 className="font-semibold">Disclosure</h2>
          <p className="mt-2 text-sm text-muted">
            {/* The sharper of the two relationships, so it is stated first and in
                the same place as the score rather than in a policy somebody has
                to go looking for. A separation nobody can see is a separation
                nobody has reason to believe. */}
            {REMEDIATION_CLIENT_DISCLOSURE} The database refuses a review by anyone recorded against
            that work, and the scoring code cannot import the module the engagement lives in. See
            the <Link href="/legal/rating-methodology-and-independence">independence policy</Link>.
          </p>
        </section>
      )}

      {badge.owner_is_marketing_client && (
        <section role="note" className="rounded-xl border border-line p-5">
          <h2 className="font-semibold">Disclosure</h2>
          <p className="mt-2 text-sm text-muted">
            {/* One constant, used here and on the directory listing. PART 8.1 requires
                the disclosure wherever a rating is displayed, and two wordings is how
                the softer one ends up where people actually look. */}
            {MARKETING_CLIENT_DISCLOSURE} Scoring receives a data structure with no field for it,
            and a test in our build pipeline asserts a maximally-paying customer and a free one with
            identical applications score identically. See the{' '}
            <Link href="/legal/rating-methodology-and-independence">independence policy</Link>.
          </p>
        </section>
      )}

      <section aria-labelledby="facts" className="space-y-4">
        <h2 id="facts" className="text-2xl font-bold tracking-tight">
          The assessment
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          {[
            ['Score', `${Number(badge.score).toFixed(1)} / 100`],
            ['Rubric version', `v${badge.rubric_version}`],
            ['Assessed on', assessedOn],
            ['Badge issued', new Date(badge.issued_at).toISOString().slice(0, 10)],
            ['Expires', new Date(badge.expires_at).toISOString().slice(0, 10)],
            ['Certified origin', badge.certified_origin],
          ].map(([term, value]) => (
            <div key={term} className="rounded-xl border border-line p-4">
              <dt className="text-sm text-muted">{term}</dt>
              <dd className="mt-1 font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted">
          The score comes from the published rubric. Read{' '}
          <Link href="/methodology">how it is computed</Link> — including the gates that cap a score
          regardless of arithmetic.
        </p>
      </section>

      <section aria-labelledby="verify" className="space-y-4">
        <h2 id="verify" className="text-2xl font-bold tracking-tight">
          Check this yourself
        </h2>
        <p className="max-w-prose text-muted">
          You do not have to take our word for it. The payload below is signed with Ed25519, and the
          public key is published at{' '}
          <code>{`${verifyOrigin}/.well-known/vibefycode-badge-key`}</code>. Any JOSE library can
          verify it without contacting us.
        </p>
        <p className="max-w-prose text-sm text-muted">
          One thing that signature does <strong>not</strong> tell you: whether the badge is still
          live. Suspension and revocation are current states, and only this page answers that. A
          genuine signature on a revoked badge is still a genuine signature.
        </p>
        <details className="rounded-xl border border-line p-5">
          <summary className="cursor-pointer font-medium">Signed payload and signature</summary>
          <dl className="mt-4 space-y-3 text-sm">
            <dt className="font-medium">Signing key</dt>
            <dd className="break-all text-muted">{badge.signing_key_id}</dd>
            <dt className="font-medium">Signature (base64url)</dt>
            <dd className="break-all text-muted">{badge.signature}</dd>
          </dl>
          <p className="mt-4 text-sm">
            <Link href={`/verify?badge=${badge.public_id}`}>Verify it here</Link>, or fetch the
            payload from <code>/api/badge/{badge.public_id}</code>.
          </p>
        </details>
      </section>

      {/* The way out.
          
          Somebody arriving here clicked a mark on a stranger's website, which
          means they were curious enough to check. That is the whole audience for
          this product, and until now the page answered their question and then
          offered them nowhere to go — every link on it led further into the
          small print.
          
          The badge itself cannot point here: the licence requires it to link to
          this page and nothing else, because a mark that sends you to a sales
          page instead of the evidence is an advertisement wearing the clothes of
          a check. So the route to the product is one step further along, which
          is also the honest order — evidence first, offer second. */}
      <section
        aria-labelledby="what-this-is"
        className="rounded-xl border border-line-strong p-6 space-y-3"
      >
        <h2 id="what-this-is" className="text-lg font-semibold">
          What is VibefyCode?
        </h2>
        <p className="max-w-prose text-muted">
          An independent assessment of applications built quickly, often with AI. We test what we
          can reach from outside — with the owner&apos;s written authorisation and never their
          source code — score it against a <Link href="/methodology">published rubric</Link>, and a
          person reviews every result before anything is certified. The mark you clicked is the
          outcome of that, and it is scope-limited: it says what was checked and when, and nothing
          beyond it.
        </p>
        <p className="flex flex-wrap gap-4 text-sm">
          <Link href="/" className="nav-cta">
            Get your application assessed
          </Link>
          <Link href="/how-it-works" className="self-center">
            What happens to your app
          </Link>
          <Link href="/directory" className="self-center">
            Others with a live badge
          </Link>
        </p>
      </section>

      <footer className="border-t border-line pt-6 text-sm text-muted">
        <p>
          Reports are prepared for the customer. No third party — including investors, acquirers or
          end users — may rely on a VibefyCode assessment. If you believe this badge is being
          displayed improperly, <Link href="/legal/ip-takedown">tell us</Link>.
        </p>
      </footer>
    </article>
  );
}
