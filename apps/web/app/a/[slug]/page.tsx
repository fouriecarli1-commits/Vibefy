import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  scopeStatement,
  AI_DISCLOSURE,
  MARKETING_CLIENT_DISCLOSURE,
  REMEDIATION_CLIENT_DISCLOSURE,
} from '@vibefycode/shared';
import { getRubric } from '@vibefycode/rubric';
import { type AssuranceInput } from '@vibefycode/assurance';
import { AssuranceList, VerificationSteps } from '@/components/assurance-list';
import { ExitPanel, type ExitMeasurement } from '@/components/exit-panel';
import { readAsAnon, writeAsService } from '@/lib/sql';
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
  exit_measurement: ExitMeasurement | null;
}

/**
 * Everything the tick list needs, read with the service role.
 *
 * Deliberately not exposed to `anon`. A view granted to the anonymous role is
 * public data through PostgREST whatever any page chooses to render, and this
 * query carries the rule ids of a customer's published findings — which is a
 * map of a stranger's weaknesses, not a disclosure. The page turns it into one
 * word per question and the detail never leaves this process.
 *
 * It is a read, inside a function named for writes, for the same reason the
 * assistant's spend ceiling is: this is a fact about the assessment rather than
 * a row the reader owns, and a reader who could only see what they own could
 * not see this at all.
 */
async function loadAssurance(slug: string): Promise<AssuranceInput | null> {
  return writeAsService(async (client) => {
    const { rows } = await client.query<{
      app_name: string;
      rubric_version: string;
      assessed_on: string;
      depth: string;
      gate_failures: string[];
      has_authentication: boolean;
      has_payments: boolean;
      processes_personal_data: boolean;
      not_tested: { criterion: string; because: string }[] | null;
    }>(
      `select app.name as app_name, a.rubric_version, a.depth::text as depth,
              a.gate_failures, app.has_authentication, app.has_payments,
              app.processes_personal_data, a.not_tested,
              coalesce(a.completed_at, a.created_at)::date::text as assessed_on
         from public.badges b
         join public.assessments a on a.id = b.assessment_id
         join public.apps app on app.id = b.app_id
        where b.slug = $1`,
      [slug],
    );
    const row = rows[0];
    if (!row) return null;

    const findings = await client.query<{ rubric_rule_id: string; severity: string }>(
      `select f.rubric_rule_id, f.severity::text as severity
         from public.findings f
         join public.badges b on b.assessment_id = f.assessment_id
        where b.slug = $1 and f.is_published`,
      [slug],
    );

    // What the rubric this was scored against actually defines. A question
    // whose criteria are absent reads as "not tested", never as a pass.
    let rubricCriteria: string[] = [];
    try {
      rubricCriteria = getRubric(row.rubric_version).dimensions.flatMap((dimension) =>
        dimension.criteria.map((criterion) => criterion.id),
      );
    } catch {
      rubricCriteria = [];
    }

    return {
      appName: row.app_name,
      assessedOn: row.assessed_on,
      rubricVersion: row.rubric_version,
      depth: row.depth as AssuranceInput['depth'],
      gateFailures: row.gate_failures ?? [],
      findings: findings.rows.map((finding) => ({
        ruleId: finding.rubric_rule_id,
        severity: finding.severity as AssuranceInput['findings'][number]['severity'],
      })),
      rubricCriteria,
      notTested: row.not_tested ?? [],
      declared: {
        authentication: row.has_authentication,
        payments: row.has_payments,
        personalData: row.processes_personal_data,
      },
    };
  }).catch(() => null);
}

interface TrustPage {
  owner_name: string;
  contact_email: string | null;
  security_contact: string | null;
  status_url: string | null;
  privacy_url: string | null;
  terms_url: string | null;
  note: string | null;
  updated_at: string;
}

/**
 * The owner's own words, which are theirs and not ours.
 *
 * Loaded separately and rendered in its own section on purpose. The moment a
 * customer can type onto a page carrying our mark, a reader has to be able to
 * tell which half is which — and the only reliable way to do that is to keep
 * the two apart everywhere, including in the code that fetches them.
 */
async function loadTrustPage(slug: string): Promise<TrustPage | null> {
  return readAsAnon(async (client) => {
    const { rows } = await client.query<TrustPage>(
      `select owner_name, contact_email, security_contact, status_url,
              privacy_url, terms_url, note, updated_at
         from public.trust_page_public where badge_slug = $1`,
      [slug],
    );
    return rows[0] ?? null;
  }).catch(() => null);
}

async function loadBadge(slug: string): Promise<BadgeRecord | null> {
  return readAsAnon(async (client) => {
    const { rows } = await client.query<BadgeRecord>(
      `select public_id, slug, status, score, rubric_version, assessed_at, issued_at, expires_at,
              certified_origin, signature, signing_key_id, app_name, owner_name,
              owner_is_marketing_client, owner_has_remediation, exit_measurement
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
  const assurance = await loadAssurance(slug);
  const trustPage = await loadTrustPage(slug);

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

      {/* The tick list, high on the page and before the score.

          Everything below this point is written for the owner of an
          application: dimensions, criteria, a number out of a hundred. The
          person who clicked a mark on a stranger's website is not that person.
          They have one question — is this all right? — and a score of 88.6 does
          not answer it. */}
      {assurance && <AssuranceList input={assurance} />}

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

      {/* After the score and clearly apart from it.

          A second number beside the first is how both come to mean less, so
          this one carries its own heading, its own explanation of where it
          comes from, and a legend saying it is not part of the rubric. It is
          shown whether it flatters or not — a measurement that only appears
          when it is good is an advertisement. */}
      {badge.exit_measurement?.score && <ExitPanel measurement={badge.exit_measurement} />}

      {/* The owner's own words.
          
          Everything above this line is what an assessment found. Everything in
          here is what the application's owner says about themselves, and a
          reader who cannot tell the difference has been misled by the layout
          rather than by anything either of us wrote. So: their name in the
          heading, a sentence saying we did not check it, and a visible edge. */}
      {trustPage && (
        <section
          aria-labelledby="owner-says"
          className="space-y-4 rounded-xl border border-line-strong p-6"
        >
          <div className="space-y-1">
            <p className="eyebrow">Not checked by us</p>
            <h2 id="owner-says" className="text-2xl font-bold tracking-tight">
              What {trustPage.owner_name} says about itself
            </h2>
            <p className="max-w-prose text-sm text-muted">
              Written by the application’s owner, not by VibefyCode. We have not verified any of it,
              and none of it was part of the assessment above. It is here because a reader who has
              just checked a mark usually wants to know where to write if something goes wrong, and
              only the owner can answer that.
            </p>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2">
            {trustPage.contact_email && (
              <div className="space-y-1">
                <dt className="font-medium">If something goes wrong</dt>
                <dd className="text-sm text-muted">
                  <a href={`mailto:${trustPage.contact_email}`}>{trustPage.contact_email}</a>
                </dd>
              </div>
            )}
            {trustPage.security_contact && (
              <div className="space-y-1">
                <dt className="font-medium">Reporting a vulnerability</dt>
                <dd className="text-sm text-muted">{trustPage.security_contact}</dd>
              </div>
            )}
            {trustPage.status_url && (
              <div className="space-y-1">
                <dt className="font-medium">Whether it is up</dt>
                <dd className="text-sm text-muted">
                  <a href={trustPage.status_url} rel="nofollow noopener">
                    {trustPage.status_url}
                  </a>
                </dd>
              </div>
            )}
            {trustPage.privacy_url && (
              <div className="space-y-1">
                <dt className="font-medium">What they do with your data</dt>
                <dd className="text-sm text-muted">
                  <a href={trustPage.privacy_url} rel="nofollow noopener">
                    {trustPage.privacy_url}
                  </a>
                </dd>
              </div>
            )}
            {trustPage.terms_url && (
              <div className="space-y-1">
                <dt className="font-medium">Their terms</dt>
                <dd className="text-sm text-muted">
                  <a href={trustPage.terms_url} rel="nofollow noopener">
                    {trustPage.terms_url}
                  </a>
                </dd>
              </div>
            )}
          </dl>

          {trustPage.note && <p className="max-w-prose text-sm">{trustPage.note}</p>}

          <p className="text-sm text-muted">
            Last changed by them on {new Date(trustPage.updated_at).toISOString().slice(0, 10)}.
          </p>
        </section>
      )}

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
      <VerificationSteps />

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
