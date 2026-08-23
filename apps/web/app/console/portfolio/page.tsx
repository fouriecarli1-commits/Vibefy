import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { evaluatePolicy, type PolicyProfile, type PolicySubject } from '@vibefycode/policy';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Portfolio' };

interface PortfolioRow {
  app_id: string;
  organisation_id: string;
  name: string;
  primary_url: string | null;
  screening_status: string;
  monitoring_enabled: boolean;
  policy_profile_id: string | null;
  assessment_id: string | null;
  overall_score: string | null;
  certification_eligible: boolean | null;
  dimension_scores: { dimension: string; score: number }[] | null;
  assessed_at: string | null;
  badge_status: string | null;
  badge_expires_at: string | null;
  authorisation_status: string | null;
  unread_alerts: number;
}

const BADGE_LABEL: Record<string, string> = {
  active: 'Badge live',
  suspended: 'Badge suspended',
  expired: 'Badge expired',
  revoked: 'Badge revoked',
};

/**
 * Every application in every workspace you belong to, on one page.
 *
 * The rows come from a `security_invoker` view, so which applications appear is
 * decided by the same row-level security as everywhere else rather than by a
 * filter this page remembered to write.
 */
export default async function PortfolioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/console/portfolio');

  const { data: rows, error } = await supabase
    .from('portfolio')
    .select('*')
    .order('name')
    .returns<PortfolioRow[]>();

  const { data: profiles } = await supabase.from('policy_profiles').select('*');
  const profileById = new Map(
    (profiles ?? []).map((profile) => [
      String(profile.id),
      {
        id: String(profile.id),
        name: String(profile.name),
        description: (profile.description as string | null) ?? null,
        minOverallScore:
          profile.min_overall_score === null ? null : Number(profile.min_overall_score),
        dimensionFloors: (profile.dimension_floors ?? {}) as PolicyProfile['dimensionFloors'],
        maxOpenSeverity: profile.max_open_severity as PolicyProfile['maxOpenSeverity'],
        requireCertification: Boolean(profile.require_certification),
        requireStoreReadiness: Boolean(profile.require_store_readiness),
      } satisfies PolicyProfile,
    ]),
  );

  const assessed = (rows ?? []).filter((row) => row.overall_score !== null);
  const average =
    assessed.length > 0
      ? assessed.reduce((total, row) => total + Number(row.overall_score), 0) / assessed.length
      : null;

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/console">Console</Link> · Portfolio
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>
        <p className="text-muted">
          Every application in every workspace you belong to. Scores are the rubric’s; whether a
          score is good enough is your policy profile’s, and the two are computed separately.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-xl border border-line p-5 text-bad">
          Could not load your portfolio: {error.message}
        </p>
      )}

      <section aria-labelledby="summary" className="space-y-4">
        <h2 id="summary" className="text-xl font-semibold">
          Summary
        </h2>
        <dl className="grid gap-4 sm:grid-cols-4">
          {[
            { label: 'Applications', value: String((rows ?? []).length) },
            { label: 'Assessed', value: String(assessed.length) },
            { label: 'Average score', value: average === null ? '—' : average.toFixed(1) },
            {
              label: 'Live badges',
              value: String((rows ?? []).filter((row) => row.badge_status === 'active').length),
            },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-line p-5">
              <dt className="text-sm text-muted">{item.label}</dt>
              <dd className="mt-1 text-2xl font-bold tracking-tight">{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="applications" className="space-y-4">
        <h2 id="applications" className="text-xl font-semibold">
          Applications
        </h2>
        {(rows ?? []).length === 0 ? (
          <p className="rounded-xl border border-line p-5 text-sm text-muted">
            Nothing here yet. <Link href="/console/apps/new">Add an application</Link>.
          </p>
        ) : (
          <ul className="space-y-3">
            {(rows ?? []).map((row) => {
              const profile = row.policy_profile_id
                ? profileById.get(row.policy_profile_id)
                : undefined;
              const evaluation =
                profile && row.assessment_id && row.overall_score !== null
                  ? evaluatePolicy(profile, {
                      assessmentId: row.assessment_id,
                      overallScore: Number(row.overall_score),
                      certificationEligible: row.certification_eligible === true,
                      dimensions: (row.dimension_scores ?? []).map((entry) => ({
                        dimension:
                          entry.dimension as PolicySubject['dimensions'][number]['dimension'],
                        score: Number(entry.score),
                      })),
                      // The portfolio row does not carry findings; the policy's
                      // severity ceiling is evaluated on the report, which does.
                      openFindings: [],
                      intendedForAppStore: false,
                    })
                  : null;

              return (
                <li key={row.app_id} className="rounded-xl border border-line p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h3 className="font-semibold">
                      <Link href={`/console/apps/${row.app_id}`}>{row.name}</Link>
                    </h3>
                    <span className="font-medium">
                      {row.overall_score === null
                        ? 'Not assessed'
                        : `${Number(row.overall_score).toFixed(1)} / 100`}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {row.primary_url}
                    {row.assessed_at
                      ? ` · assessed ${new Date(row.assessed_at).toISOString().slice(0, 10)}`
                      : ''}
                  </p>
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                    <span>
                      Authorisation: {row.authorisation_status ?? 'none'}
                    </span>
                    {row.badge_status && <span>{BADGE_LABEL[row.badge_status] ?? row.badge_status}</span>}
                    <span>{row.monitoring_enabled ? 'Monitored' : 'Not monitored'}</span>
                    {row.unread_alerts > 0 && (
                      <span className="text-warn">{row.unread_alerts} unread alerts</span>
                    )}
                  </p>
                  {evaluation && (
                    <p
                      className={`mt-3 text-sm ${evaluation.meetsPolicy ? 'text-ok' : 'text-bad'}`}
                    >
                      {evaluation.meetsPolicy
                        ? `Meets your ${evaluation.profileName} policy.`
                        : `Does not meet your ${evaluation.profileName} policy: ${evaluation.failures[0]?.explanation}`}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
