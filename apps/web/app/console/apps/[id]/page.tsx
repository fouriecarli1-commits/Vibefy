import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CHALLENGE_PATH, DNS_RECORD_PREFIX } from '@vibefy/engine/authorisation';
import { badgeEmbedSnippet, BADGE_USAGE } from '@vibefy/shared';
import {
  acceptBadgeLicence,
  requestAssessment,
  revokeAuthorisation,
  startAuthorisation,
  verifyAuthorisation,
} from '../actions';
import { ActionForm, Checkbox, Field } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';

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

  const { data: authorisations } = await supabase
    .from('authorisations')
    .select('*')
    .eq('app_id', id)
    .order('created_at', { ascending: false });

  const current = authorisations?.[0] ?? null;
  const status = current?.status ?? 'none';
  const copy = STATUS_COPY[status] ?? STATUS_COPY.none!;
  const host = app.primary_url ? new URL(app.primary_url as string).hostname : '';
  const verifyOrigin =
    process.env.NEXT_PUBLIC_VERIFY_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'https://verify.vibefy.example';

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
                  alt={`Verified by Vibefy — ${app.name}, Rubric v${badge.rubric_version}, assessed ${new Date(badge.assessed_at as string).toISOString().slice(0, 10)}. Scope-limited assessment, not a security guarantee.`}
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
                    Paste this where you want the badge to appear. It has to stay a link to the
                    verification page — a badge that does not link is a claim without evidence, and
                    the licence does not permit it. Minimum size {BADGE_USAGE.minimumSizePx}px, with
                    clear space of {Math.round(BADGE_USAGE.clearSpaceRatio * 100)}% of the badge
                    width on every side.
                  </p>
                  <pre className="overflow-x-auto rounded-lg border border-line bg-surface-muted p-4 text-xs">
                    {badgeEmbedSnippet({
                      appName: app.name as string,
                      rubricVersion: String(badge.rubric_version),
                      assessedOn: new Date(badge.assessed_at as string).toISOString().slice(0, 10),
                      verifyOrigin: verifyOrigin,
                      publicId: String(badge.public_id),
                      slug: String(badge.slug),
                    })}
                  </pre>
                  <p className="text-sm text-muted">
                    The image is served from Vibefy on every load, never copied to your server. That
                    is what lets a suspension or a revocation take effect within minutes — and it is
                    why there is no file to download.
                  </p>
                </div>
              )}
            </div>
          ) : licence ? (
            <p className="rounded-xl border border-line bg-surface-muted p-5 text-sm text-muted">
              The Badge Licence is accepted. A badge is issued once an assessment has been approved
              by a reviewer and has met the certification threshold — those are separate gates, and
              neither can be bought.
            </p>
          ) : (
            <div className="rounded-xl border border-line p-6">
              <h3 className="font-semibold">Accept the Badge Licence</h3>
              <p className="mt-2 max-w-prose text-sm text-muted">
                "Verified by Vibefy" is a trade mark. The licence lets you display it for this
                application, on this domain, until it expires — and sets out what you may not do: no
                recolouring, no cropping, no altering the wordmark, no displaying it after it
                expires or is revoked, and never without the link to the verification page. Read it
                in full: <Link href="/legal/badge-licence">Vibefy Badge Licence Agreement</Link>.
              </p>
              <div className="mt-5">
                <ActionForm action={acceptBadgeLicence} submitLabel="Accept the licence">
                  <input type="hidden" name="appId" value={id} />
                  <Checkbox
                    label="I accept the Vibefy Badge Licence Agreement for this application."
                    name="accepted"
                    hint="Recorded with the version, a hash of the exact wording, the time, your IP and your user agent — in a record that cannot be edited afterwards."
                  />
                </ActionForm>
              </div>
            </div>
          )}
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
