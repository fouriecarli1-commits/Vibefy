import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CHALLENGE_PATH, DNS_RECORD_PREFIX } from '@vibefycode/engine/authorisation';
import {
  badgeEmbedJsx,
  badgeEmbedSnippet,
  BADGE_USAGE,
  EMBED_PLACEMENTS,
} from '@vibefycode/shared';
import {
  acceptBadgeLicence,
  requestAssessment,
  revokeAuthorisation,
  setDirectoryListing,
  startAuthorisation,
  verifyAuthorisation,
} from '../actions';
import { setMonitoring } from '../../alerts/actions';
import { assignPolicyProfile } from '../../workspace/actions';
import { ActionForm, Checkbox, Field, Select } from '@/components/action-form';
import { ScoreTrend, type TrendPoint } from '@/components/score-trend';
import { currentVersionOf } from '@/lib/legal';
import { Disclosure } from '@/components/disclosure';
import { createClient } from '@/lib/supabase/server';
import { isPlaceholderOrigin } from '@/lib/verify-origin';
import { resolveVerifyOrigin } from '@/lib/verify-origin.server';

export const metadata: Metadata = { title: 'Application' };

const STATUS_COPY: Record<string, { label: string; tone: string; meaning: string }> = {
  none: {
    label: 'Not authorised',
    tone: 'text-muted',
    meaning: 'Nothing can be tested until you accept the warranty and prove you control the host.',
  },
  pending: {
    label: 'Awaiting verification',
    tone: 'text-warn',
    meaning:
      'The warranty is recorded. Publish the challenge below, then verify. No run starts before that.',
  },
  verified: {
    label: 'Authorised',
    tone: 'text-ok',
    meaning: 'Assessments may run against the declared scope, and only that scope.',
  },
  revoked: {
    label: 'Withdrawn',
    tone: 'text-bad',
    meaning: 'You withdrew authorisation. Nothing runs, and any run in flight stopped.',
  },
  expired: {
    label: 'Expired',
    tone: 'text-warn',
    meaning: 'The authorisation lapsed. Re-authorise to run again.',
  },
};

export default async function AppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/console/apps/${id}`);

  const { data: app } = await supabase.from('apps').select('*').eq('id', id).single();
  if (!app) notFound();

  const { data: requests } = await supabase
    .from('assessment_requests')
    .select('id, status, depth, uses_retest_credit, refusal_message, created_at, assessment_id')
    .eq('app_id', id)
    .order('created_at', { ascending: false })
    .limit(5);

  const { data: assessments } = await supabase
    .from('assessments')
    .select('id, status, overall_score, rubric_version, reviewed_at, created_at')
    .eq('app_id', id)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: badge } = await supabase
    .from('badges')
    .select(
      'id, public_id, slug, status, score, rubric_version, assessed_at, expires_at, certified_origin, revocation_reason',
    )
    .eq('app_id', id)
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: licence } = await supabase
    .from('consents')
    .select('document_version, occurred_at')
    .eq('document_type', 'badge_licence')
    .eq('action', 'accepted')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // The version currently in force, not merely "some acceptance exists". A page
  // that says "accepted" while issuance silently ignores an out-of-date consent
  // is the worst kind of bug: nothing errors and nothing happens.
  const badgeLicenceVersion = currentVersionOf('badge-licence.md');
  const licenceIsCurrent = licence?.document_version === badgeLicenceVersion;

  const { data: authorisations } = await supabase
    .from('authorisations')
    .select('*')
    .eq('app_id', id)
    .order('created_at', { ascending: false });

  // The trend and the comparison behind it. `assessment_history` is a view over
  // the same rows the report is built from, so the two can never disagree.
  const { data: history } = await supabase
    .from('assessment_history')
    .select('assessment_id, overall_score, assessed_at, score_delta, material_regression')
    .eq('app_id', id)
    .limit(12);

  const { data: drift } = await supabase
    .from('drift_reports')
    .select(
      'id, score_before, score_after, score_delta, findings_new, findings_resolved, findings_persisting, new_finding_titles, resolved_finding_titles, material_regression, regression_reasons, created_at',
    )
    .eq('app_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: appAlerts } = await supabase
    .from('alerts')
    .select('id, title, severity, created_at, read_at')
    .eq('app_id', id)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(3);

  const { data: listing } = await supabase
    .from('directory_listings')
    .select('state, tagline, category')
    .eq('app_id', id)
    .maybeSingle();

  const { data: policyProfiles } = await supabase
    .from('policy_profiles')
    .select('id, name')
    .eq('organisation_id', app.organisation_id);

  const trend: TrendPoint[] = (history ?? [])
    .filter((row) => row.overall_score !== null)
    .map((row) => ({
      assessmentId: String(row.assessment_id),
      score: Number(row.overall_score),
      assessedAt: String(row.assessed_at),
      delta: row.score_delta === null ? null : Number(row.score_delta),
      materialRegression: Boolean(row.material_regression),
    }));

  const current = authorisations?.[0] ?? null;
  const status = current?.status ?? 'none';
  const copy = STATUS_COPY[status] ?? STATUS_COPY.none!;
  const host = app.primary_url ? new URL(app.primary_url as string).hostname : '';
  const verifyOrigin = await resolveVerifyOrigin();

  // The facts both snippet forms share, so the HTML and the JSX can never
  // describe two different badges.
  const embedFacts = badge
    ? {
        appName: app.name as string,
        rubricVersion: String(badge.rubric_version),
        assessedOn: new Date(badge.assessed_at as string).toISOString().slice(0, 10),
        verifyOrigin,
        publicId: String(badge.public_id),
        slug: String(badge.slug),
      }
    : null;

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/console">Console</Link> · {app.slug}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">{app.name}</h1>
        <p className="text-muted">{app.primary_url}</p>
      </header>

      {app.screening_status === 'refused' && (
        <section role="alert" className="rounded-xl border border-line p-5">
          <h2 className="font-semibold text-bad">Refused under the Acceptable Use Policy</h2>
          <p className="mt-2 text-sm text-muted">{app.screening_notes}</p>
          <p className="mt-3 text-sm">
            If this is wrong, <Link href="/legal/appeals-and-corrections">appeal it</Link> — appeals
            are free and a person reads them.
          </p>
        </section>
      )}

      {app.screening_status === 'pending' && (
        <section className="rounded-xl border border-line bg-surface-muted p-5">
          <h2 className="font-semibold">Waiting on a human check</h2>
          <p className="mt-2 text-sm text-muted">
            {app.screening_notes ??
              'A reviewer confirms every submission before an assessment runs.'}
          </p>
        </section>
      )}

      <section aria-labelledby="authorisation" className="space-y-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id="authorisation" className="text-2xl font-bold tracking-tight">
            Authorisation to test
          </h2>
          <span className={`text-sm font-medium ${copy.tone}`}>{copy.label}</span>
        </div>
        <p className="max-w-prose text-muted">{copy.meaning}</p>

        {status === 'none' && (
          <div className="rounded-xl border border-line p-6">
            <h3 className="font-semibold">Accept the warranty and declare a scope</h3>
            <p className="mt-2 max-w-prose text-sm text-muted">
              Testing a system without authorisation is a criminal offence in every market we
              operate in. By accepting, you warrant that you own {host || 'the target'} or are
              contractually authorised to authorise its testing, and you name any third-party
              platform involved. Your acceptance is recorded with the version, a hash of the exact
              wording, the time, your IP address and your user agent, in a record we cannot later
              edit. Read it in full:{' '}
              <Link href="/legal/authorisation-to-test">
                Authorisation to Test &amp; Customer Warranty
              </Link>
              .
            </p>

            <div className="mt-5">
              <ActionForm action={startAuthorisation} submitLabel="Accept and continue">
                <input type="hidden" name="appId" value={id} />
                <Field
                  label="In-scope hosts"
                  name="scopeDomains"
                  defaultValue={host}
                  hint={`Comma-separated. You can only authorise ${host} and its subdomains — anything else is removed.`}
                />
                <Field
                  label="Out of scope"
                  name="exclusions"
                  hint="Paths or hosts the runner must never touch, for example /billing."
                />
                <Field
                  label="Third parties involved"
                  name="thirdParties"
                  hint="Your host, database, auth or payment providers. Naming them is part of the warranty."
                />
                <Checkbox
                  label="I warrant that I am entitled to authorise testing of the hosts above."
                  name="accepted"
                  hint="Non-destructive, rate-limited, read-only, within the declared scope. You can withdraw at any time."
                />
              </ActionForm>
            </div>
          </div>
        )}

        {status === 'pending' && current && (
          <div className="space-y-5 rounded-xl border border-line p-6">
            <h3 className="font-semibold">Prove you control {current.verification_target}</h3>
            <p className="text-sm text-muted">Do either of these, then verify.</p>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Option 1 — a DNS TXT record</h4>
              <pre className="overflow-x-auto rounded-lg border border-line bg-surface-muted p-3 text-sm">
                {DNS_RECORD_PREFIX}
                {current.verification_token}
              </pre>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">
                Option 2 — this exact text, and nothing else, at {CHALLENGE_PATH}
              </h4>
              <pre className="overflow-x-auto rounded-lg border border-line bg-surface-muted p-3 text-sm">
                {current.verification_token}
              </pre>
              <p className="text-sm text-muted">
                Served directly over HTTPS, with no redirect. DNS can take a few minutes; the file
                is usually immediate.
              </p>
            </div>

            <ActionForm action={verifyAuthorisation} submitLabel="Verify" pendingLabel="Checking…">
              <input type="hidden" name="appId" value={id} />
            </ActionForm>
          </div>
        )}

        {status === 'verified' && current && (
          <div className="space-y-5 rounded-xl border border-line p-6">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium">Verified by</dt>
                <dd className="text-muted">{String(current.method).replace(/_/g, ' ')}</dd>
              </div>
              <div>
                <dt className="font-medium">Verified at</dt>
                <dd className="text-muted">
                  {new Date(current.verified_at as string).toUTCString()}
                </dd>
              </div>
              <div>
                <dt className="font-medium">In scope</dt>
                <dd className="text-muted">{(current.scope_domains as string[]).join(', ')}</dd>
              </div>
              <div>
                <dt className="font-medium">Expires</dt>
                <dd className="text-muted">
                  {current.expires_at ? new Date(current.expires_at as string).toUTCString() : '—'}
                </dd>
              </div>
            </dl>

            <details className="rounded-lg border border-line p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Withdraw authorisation
              </summary>
              <p className="mt-3 text-sm text-muted">
                Withdrawal is immediate: runs in flight abort and no new run starts. It is recorded
                as a new entry rather than an edit, because the history is the evidence.
              </p>
              <div className="mt-4">
                <ActionForm action={revokeAuthorisation} submitLabel="Withdraw" destructive>
                  <input type="hidden" name="appId" value={id} />
                  <Field label="Why are you withdrawing?" name="reason" required />
                </ActionForm>
              </div>
            </details>
          </div>
        )}

        {status === 'revoked' && (
          <div className="rounded-xl border border-line p-6">
            <p className="text-sm text-muted">
              Withdrawn: {current?.revocation_reason}. Submit a new authorisation to run again.
            </p>
          </div>
        )}
      </section>

      {status === 'verified' && (
        <section aria-labelledby="assess" className="space-y-4">
          <h2 id="assess" className="text-2xl font-bold tracking-tight">
            Assessments
          </h2>

          {(requests ?? []).some((request) =>
            ['queued', 'claimed'].includes(String(request.status)),
          ) ? (
            <p role="status" className="rounded-xl border border-line bg-surface-muted p-5 text-sm">
              An assessment is queued. The worker claims it, re-checks that the authorisation is
              still live, and runs it. You will see the report here once a human reviewer has
              approved it — nothing is published before that.
            </p>
          ) : (
            <div className="rounded-xl border border-line p-5">
              <p className="mb-4 text-sm text-muted">
                What runs depends on your plan: how deep the assessment goes and how much of the
                report you see. It never depends on what you paid for the score itself.
              </p>
              <ActionForm action={requestAssessment} submitLabel="Request an assessment">
                <input type="hidden" name="appId" value={id} />
              </ActionForm>
            </div>
          )}

          {(assessments ?? []).length > 0 && (
            <ul className="space-y-3">
              {(assessments ?? []).map((assessment) => (
                <li key={assessment.id as string} className="rounded-xl border border-line p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span className="font-medium">
                      {assessment.overall_score !== null
                        ? `${Number(assessment.overall_score).toFixed(1)} / 100`
                        : 'Not scored yet'}
                    </span>
                    <span className="text-sm text-muted">
                      {String(assessment.status).replace(/_/g, ' ')} · rubric v
                      {String(assessment.rubric_version)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {new Date(assessment.created_at as string).toUTCString()}
                  </p>
                  {['approved', 'published'].includes(String(assessment.status)) && (
                    <p className="mt-3 text-sm">
                      <Link href={`/console/reports/${assessment.id}`}>Read the report</Link>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {(requests ?? [])
            .filter((request) => String(request.status) === 'refused')
            .slice(0, 1)
            .map((request) => (
              <p key={request.id as string} className="text-sm text-muted">
                Last refused request: {String(request.refusal_message)}
              </p>
            ))}
        </section>
      )}

      {status === 'verified' && (
        <section aria-labelledby="badge" className="space-y-5">
          <h2 id="badge" className="text-2xl font-bold tracking-tight">
            Your badge
          </h2>

          {badge ? (
            <div className="space-y-5 rounded-xl border border-line p-6">
              <div className="flex flex-wrap items-center gap-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/badge/${badge.public_id}.svg`}
                  alt={`Verified by VibefyCode — ${app.name}, Rubric v${badge.rubric_version}, assessed ${new Date(badge.assessed_at as string).toISOString().slice(0, 10)}. Scope-limited assessment, not a security guarantee.`}
                  width={128}
                  height={128}
                />
                <div>
                  <p className="font-medium capitalize">{String(badge.status)}</p>
                  <p className="text-sm text-muted">
                    {Number(badge.score).toFixed(1)} / 100 · rubric v{String(badge.rubric_version)}{' '}
                    · expires {new Date(badge.expires_at as string).toISOString().slice(0, 10)}
                  </p>
                  <p className="mt-1 text-sm">
                    <Link href={`/a/${badge.slug}`}>Its verification page</Link>
                  </p>
                  {badge.revocation_reason ? (
                    <p className="mt-2 text-sm text-bad">{String(badge.revocation_reason)}</p>
                  ) : null}
                </div>
              </div>

              {String(badge.status) === 'active' && (
                <div className="space-y-3">
                  <h3 className="font-semibold">Embed it</h3>
                  <p className="text-sm text-muted">
                    Most people put it in the footer, beside the copyright line — it belongs where a
                    visitor looks to find out who is behind a site. It has to stay a link to the
                    verification page: a badge that does not link is a claim without evidence, and
                    the licence does not permit it. Minimum size {BADGE_USAGE.minimumSizePx}px, with
                    clear space of {Math.round(BADGE_USAGE.clearSpaceRatio * 100)}% of the badge
                    width on every side.
                  </p>

                  {isPlaceholderOrigin(verifyOrigin) && (
                    <p role="alert" className="rounded-lg border border-line-strong p-4 text-sm">
                      <strong className="text-bad">This snippet will not work yet.</strong> This
                      deployment could not work out which address it is served from, so the badge
                      URL below points at a placeholder. Set <code>NEXT_PUBLIC_SITE_URL</code> to
                      this site&apos;s address and the snippet corrects itself.
                    </p>
                  )}

                  <h4 className="text-sm font-semibold">HTML</h4>
                  <p className="text-sm text-muted">
                    For a plain site, or any builder with a code block.
                  </p>
                  <pre className="overflow-x-auto rounded-lg border border-line bg-surface-muted p-4 text-xs">
                    {badgeEmbedSnippet(embedFacts!)}
                  </pre>

                  <h4 className="text-sm font-semibold">React or Next.js</h4>
                  <p className="text-sm text-muted">
                    Use this one inside a component. The HTML above will not compile in JSX —{' '}
                    <code>style</code> takes an object and the <code>&lt;img&gt;</code> has to be
                    closed — and a snippet that breaks your build the moment you follow the
                    instructions is not much of an instruction.
                  </p>
                  <pre className="overflow-x-auto rounded-lg border border-line bg-surface-muted p-4 text-xs">
                    {badgeEmbedJsx(embedFacts!)}
                  </pre>

                  {/* "Paste this where you want the badge to appear" is only an
                      instruction if you already know how to edit your site.
                      Somebody who built an application by describing it to a
                      model may never have opened a footer component. */}
                  <Disclosure
                    summary="Where exactly does it go?"
                    hint="Step by step, for the tool you built your site with"
                  >
                    <ul className="space-y-4">
                      {EMBED_PLACEMENTS.map((placement) => (
                        <li key={placement.platform}>
                          <p className="font-medium">
                            {placement.platform}{' '}
                            <span className="text-muted">
                              · use the {placement.form === 'jsx' ? 'React' : 'HTML'} snippet
                            </span>
                          </p>
                          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-muted">
                            {placement.steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                        </li>
                      ))}
                    </ul>
                  </Disclosure>
                  <p className="text-sm text-muted">
                    The image is served from VibefyCode on every load, never copied to your server.
                    That is what lets a suspension or a revocation take effect within minutes — and
                    it is why there is no file to download.
                  </p>
                </div>
              )}
            </div>
          ) : licenceIsCurrent ? (
            <p className="rounded-xl border border-line bg-surface-muted p-5 text-sm text-muted">
              The Badge Licence is accepted at version {badgeLicenceVersion}. A badge is issued once
              an assessment has been approved by a reviewer and has met the certification threshold
              — those are separate gates, and neither can be bought.
            </p>
          ) : (
            <div className="rounded-xl border border-line p-6">
              <h3 className="font-semibold">
                {licence ? 'Accept the updated Badge Licence' : 'Accept the Badge Licence'}
              </h3>
              {licence && (
                <p className="mt-2 max-w-prose text-sm text-muted">
                  You accepted version {String(licence.document_version)}; version{' '}
                  {badgeLicenceVersion} is now in force. No badge is issued or renewed until the
                  current version is accepted — we do not carry an acceptance forward onto wording
                  nobody agreed to.
                </p>
              )}
              <p className="mt-2 max-w-prose text-sm text-muted">
                "Verified by VibefyCode" is a trade mark. The licence lets you display it for this
                application, on this domain, until it expires — and sets out what you may not do: no
                recolouring, no cropping, no altering the wordmark, no displaying it after it
                expires or is revoked, and never without the link to the verification page. Read it
                in full: <Link href="/legal/badge-licence">VibefyCode Badge Licence Agreement</Link>
                .
              </p>
              <div className="mt-5">
                <ActionForm action={acceptBadgeLicence} submitLabel="Accept the licence">
                  <input type="hidden" name="appId" value={id} />
                  <Checkbox
                    label="I accept the VibefyCode Badge Licence Agreement for this application."
                    name="accepted"
                    hint="Recorded with the version, a hash of the exact wording, the time, your IP and your user agent — in a record that cannot be edited afterwards."
                  />
                </ActionForm>
              </div>
            </div>
          )}
        </section>
      )}

      {trend.length > 0 && (
        <section aria-labelledby="trend" className="space-y-5">
          <h2 id="trend" className="text-2xl font-bold tracking-tight">
            Score over time
          </h2>
          <div className="rounded-xl border border-line p-5">
            <ScoreTrend points={trend} />
          </div>

          {drift && (
            <div className="rounded-xl border border-line p-5">
              <h3 className="font-semibold">
                Since the assessment before it, on{' '}
                {new Date(drift.created_at as string).toISOString().slice(0, 10)}
              </h3>
              <p className="mt-2 text-sm text-muted">
                {Number(drift.score_before).toFixed(1)} → {Number(drift.score_after).toFixed(1)} (
                {Number(drift.score_delta) > 0 ? '+' : ''}
                {Number(drift.score_delta).toFixed(1)}) · {String(drift.findings_new)} new,{' '}
                {String(drift.findings_resolved)} resolved, {String(drift.findings_persisting)}{' '}
                unchanged.
              </p>
              {(drift.new_finding_titles as string[] | null)?.length ? (
                <div className="mt-4 text-sm">
                  <p className="font-medium">New</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                    {(drift.new_finding_titles as string[]).map((title) => (
                      <li key={title}>{title}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(drift.resolved_finding_titles as string[] | null)?.length ? (
                <div className="mt-4 text-sm">
                  <p className="font-medium">Resolved</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                    {(drift.resolved_finding_titles as string[]).map((title) => (
                      <li key={title}>{title}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {drift.material_regression ? (
                <div className="mt-4 rounded-lg border border-line-strong p-4 text-sm">
                  <p className="font-medium text-bad">
                    This was a material change, so the badge was suspended.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                    {(drift.regression_reasons as string[]).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <p className="mt-3 text-muted">
                    Fix the findings in the report and request a re-assessment. The badge is
                    restored when a new assessment passes review.
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </section>
      )}

      {status === 'verified' && (
        <section aria-labelledby="monitoring" className="space-y-4">
          <h2 id="monitoring" className="text-2xl font-bold tracking-tight">
            Monitoring
          </h2>
          <div className="rounded-xl border border-line p-5 text-sm">
            <p className="text-muted">
              With monitoring on we re-assess this application on your plan’s cadence and check that
              its certified origin is still answering. The check is a single GET request to that
              origin and nothing else — the same scope you authorised.
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-muted">Status</dt>
                <dd className="font-medium">{app.monitoring_enabled ? 'On' : 'Off'}</dd>
              </div>
              <div>
                <dt className="text-muted">Last seen answering</dt>
                <dd className="font-medium">
                  {app.last_seen_at
                    ? new Date(app.last_seen_at as string).toUTCString()
                    : 'Not checked yet'}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Consecutive failed checks</dt>
                <dd className="font-medium">{String(app.consecutive_liveness_failures ?? 0)}</dd>
              </div>
              <div>
                <dt className="text-muted">Last re-assessment queued</dt>
                <dd className="font-medium">
                  {app.last_reassessed_at
                    ? new Date(app.last_reassessed_at as string).toISOString().slice(0, 10)
                    : 'Never'}
                </dd>
              </div>
            </dl>
            <div className="mt-5">
              <ActionForm
                action={setMonitoring}
                submitLabel={app.monitoring_enabled ? 'Update monitoring' : 'Turn monitoring on'}
              >
                <input type="hidden" name="appId" value={id} />
                <Checkbox
                  name="enabled"
                  label="Monitor this application"
                  defaultChecked={Boolean(app.monitoring_enabled)}
                />
              </ActionForm>
            </div>
          </div>

          {(appAlerts ?? []).length > 0 && (
            <div className="rounded-xl border border-line-strong p-5 text-sm">
              <h3 className="font-semibold">Unread alerts about this application</h3>
              <ul className="mt-2 space-y-1 text-muted">
                {(appAlerts ?? []).map((alert) => (
                  <li key={alert.id as string}>{String(alert.title)}</li>
                ))}
              </ul>
              <p className="mt-3">
                <Link href="/console/alerts">Open your alerts</Link>
              </p>
            </div>
          )}
        </section>
      )}

      {badge && badge.status === 'active' && (
        <section aria-labelledby="directory" className="space-y-4">
          <h2 id="directory" className="text-2xl font-bold tracking-tight">
            Public directory
          </h2>
          <div className="rounded-xl border border-line p-5 text-sm">
            <p className="text-muted">
              The directory lists applications with a live badge. A listing shows the name, the
              certified origin, the score, the score by dimension, the rubric version and the date —
              nothing that is not already on your verification page.
            </p>
            <p className="mt-2 text-muted">
              You can remove the listing at any time and stay certified. Listings are ordered by the
              rubric alone; placement is not for sale.
            </p>
            <div className="mt-5">
              <ActionForm action={setDirectoryListing} submitLabel="Save listing">
                <input type="hidden" name="appId" value={id} />
                <Checkbox
                  name="listed"
                  label="List this application in the public directory"
                  defaultChecked={String(listing?.state ?? 'listed') === 'listed'}
                />
                <Field
                  label="Tagline"
                  name="tagline"
                  defaultValue={String(listing?.tagline ?? '')}
                  hint="Yours, shown as yours. Between 10 and 160 characters, or leave it blank."
                />
                <Field
                  label="Category"
                  name="category"
                  defaultValue={String(listing?.category ?? '')}
                  hint="How someone browsing would look for it."
                />
              </ActionForm>
            </div>
            {listing?.state === 'listed' && (
              <p className="mt-4">
                <Link href={`/a/${badge.slug}`}>See how it appears</Link>
              </p>
            )}
          </div>
        </section>
      )}

      {(policyProfiles ?? []).length > 0 && (
        <section aria-labelledby="policy" className="space-y-4">
          <h2 id="policy" className="text-xl font-semibold">
            Policy profile
          </h2>
          <div className="rounded-xl border border-line p-5 text-sm">
            <p className="text-muted">
              Your organisation’s own bar for this application. It is applied over a score that was
              computed without knowing the profile exists: it can fail an application the rubric
              passed, and it never changes what anything scored.
            </p>
            <div className="mt-4">
              <ActionForm action={assignPolicyProfile} submitLabel="Apply profile">
                <input type="hidden" name="appId" value={id} />
                <Select
                  label="Profile"
                  name="profileId"
                  defaultValue={String(app.policy_profile_id ?? '')}
                  options={[
                    { value: '', label: 'No profile' },
                    ...(policyProfiles ?? []).map((profile) => ({
                      value: String(profile.id),
                      label: String(profile.name),
                    })),
                  ]}
                />
              </ActionForm>
            </div>
          </div>
        </section>
      )}

      <section aria-labelledby="history" className="space-y-4">
        <h2 id="history" className="text-xl font-semibold">
          Authorisation history
        </h2>
        <p className="text-sm text-muted">
          Append-only. Nothing here can be edited or deleted, including by us.
        </p>
        <ol className="space-y-3">
          {(authorisations ?? []).map((record) => (
            <li key={record.id as string} className="rounded-lg border border-line p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{String(record.status)}</span>
                <span className="text-muted">
                  {new Date(record.created_at as string).toUTCString()}
                </span>
              </div>
              <p className="mt-1 text-muted">
                Warranty v{record.warranty_text_version} ·{' '}
                {String(record.method).replace(/_/g, ' ')}
                {record.revocation_reason ? ` · ${record.revocation_reason}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
