import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { triageAssessment, type TriageFinding } from '@vibefycode/governance';
import { adjustAssessment, approveAssessment, rejectAssessment } from '../actions';
import { ActionForm, Checkbox, Field } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Review' };

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const SEVERITY_TONE: Record<string, string> = {
  critical: 'text-bad',
  high: 'text-bad',
  medium: 'text-warn',
  low: 'text-muted',
  info: 'text-muted',
};

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/review/${id}`);

  const { data: assessment } = await supabase
    .from('assessments')
    .select('*, apps (name, primary_url, description)')
    .eq('id', id)
    .single();
  if (!assessment) notFound();

  const { data: findings } = await supabase
    .from('findings')
    .select('*, finding_evidence (evidence_id)')
    .eq('assessment_id', id);

  const { data: runs } = await supabase
    .from('assessment_runs')
    .select('stage, status, error_message, metadata')
    .eq('assessment_id', id);

  const { data: reviews } = await supabase
    .from('reviews')
    .select('action, reason, created_at')
    .eq('assessment_id', id)
    .order('created_at', { ascending: false });

  const app = assessment.apps as unknown as {
    name: string;
    primary_url: string;
    description: string;
  } | null;
  const blockers = (assessment.gate_failures as string[]) ?? [];
  const sorted = (findings ?? []).sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(String(a.severity)) - SEVERITY_ORDER.indexOf(String(b.severity)),
  );

  // The same summary the queue showed, restated at the top of the page where
  // the decision is made — so what needs checking is read before the findings
  // rather than reconstructed from them.
  const triage = triageAssessment({
    overallScore: assessment.overall_score === null ? null : Number(assessment.overall_score),
    certificationEligible: assessment.certification_eligible === true,
    gateFailures: blockers,
    findings: (findings ?? []).map(
      (finding): TriageFinding => ({
        title: String(finding.title),
        severity: finding.severity as TriageFinding['severity'],
        dimension: String(finding.dimension),
        confidence: finding.confidence as TriageFinding['confidence'],
        isPublished: finding.is_published === true,
        evidenceCount: ((finding.finding_evidence as unknown as { evidence_id: string }[]) ?? [])
          .length,
      }),
    ),
    failedStages: (runs ?? [])
      .filter((run) => String(run.status) !== 'succeeded')
      .map((run) => String(run.stage)),
  });

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/review">Review queue</Link>
        </p>
        <h1 className="text-3xl font-bold tracking-tight">{app?.name ?? 'Application'}</h1>
        <p className="text-muted">{app?.primary_url}</p>
        <p className="tabular-nums text-sm text-muted">
          Score {String(assessment.overall_score ?? '—')} / 100 · rubric v
          {String(assessment.rubric_version)} · {sorted.length} finding
          {sorted.length === 1 ? '' : 's'}
        </p>
      </header>

      {blockers.length > 0 && (
        <section role="note" className="rounded-xl border border-line bg-surface-muted p-5">
          <h2 className="font-semibold">Certification blockers</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            A gate is not a suggestion. The database refuses certification eligibility while a
            critical security or privacy finding stands, whatever is ticked below.
          </p>
        </section>
      )}

      <section aria-labelledby="triage" className="space-y-3">
        <h2 id="triage" className="text-xl font-bold">
          What to check
        </h2>
        <p className="text-sm text-muted">{triage.headline}</p>

        {triage.attention.length > 0 ? (
          <ul className="space-y-2">
            {triage.attention.map((entry) => (
              <li key={entry.id} className="bar" data-tone="warn">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{entry.label}</p>
                  <p className="text-xs text-muted">{entry.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="bar">
            <p className="text-sm">
              Nothing unusual was flagged. That is not an approval — it means the checks below found
              nothing that singles this assessment out, and the findings still want reading.
            </p>
          </div>
        )}

        {triage.routine.length > 0 && (
          <ul className="space-y-1">
            {triage.routine.map((line) => (
              <li key={line} className="text-xs text-muted">
                {line}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="findings" className="space-y-4">
        <h2 id="findings" className="text-2xl font-bold tracking-tight">
          Findings
        </h2>
        {sorted.length === 0 && (
          <p className="text-muted">No findings were published for this assessment.</p>
        )}
        <ul className="space-y-4">
          {sorted.map((finding) => {
            const evidence =
              (finding.finding_evidence as unknown as { evidence_id: string }[]) ?? [];
            return (
              <li key={finding.id as string} className="rounded-xl border border-line p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-semibold">{finding.title as string}</h3>
                  <span
                    className={`text-sm font-medium ${SEVERITY_TONE[String(finding.severity)] ?? ''}`}
                  >
                    {String(finding.severity)} · {String(finding.confidence)} confidence
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted">{finding.description as string}</p>
                <p className="mt-3 text-sm">
                  <strong>Remediation.</strong> {finding.remediation as string}
                </p>
                <p className="mt-3 text-sm text-muted">
                  {String(finding.rubric_rule_id)} · {String(finding.dimension).replace(/_/g, ' ')}{' '}
                  · {evidence.length} evidence artefact{evidence.length === 1 ? '' : 's'}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="stages" className="space-y-3">
        <h2 id="stages" className="text-xl font-semibold">
          What ran
        </h2>
        <ul className="space-y-2 text-sm">
          {(runs ?? []).map((run, index) => (
            <li key={`${run.stage}-${index}`} className="rounded-lg border border-line p-3">
              <span className="font-medium">{String(run.stage).replace(/_/g, ' ')}</span> —{' '}
              {String(run.status)}
              {run.error_message ? (
                <span className="text-muted"> · {String(run.error_message)}</span>
              ) : null}
              {((run.metadata as { notes?: string[] })?.notes ?? []).map((note) => (
                <p key={note} className="mt-1 text-muted">
                  {note}
                </p>
              ))}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="decide" className="space-y-6">
        <h2 id="decide" className="text-2xl font-bold tracking-tight">
          Your decision
        </h2>
        <p className="max-w-prose text-muted">
          Everything you do here is written to an append-only log with your name and your reason,
          and neither can be edited afterwards — including by us. That is what makes the
          independence policy checkable rather than merely stated.
        </p>

        <div className="rounded-xl border border-line p-5">
          <h3 className="font-semibold">Approve</h3>
          <ActionForm action={approveAssessment} submitLabel="Approve">
            <input type="hidden" name="assessmentId" value={id} />
            <Checkbox
              label="Certification-eligible"
              name="certificationEligible"
              hint="Leave unticked to approve the report without making the application eligible for a badge."
            />
            <Field label="Note (optional)" name="reason" />
          </ActionForm>
        </div>

        <div className="rounded-xl border border-line p-5">
          <h3 className="font-semibold">Adjust the score</h3>
          <ActionForm action={adjustAssessment} submitLabel="Record adjustment">
            <input type="hidden" name="assessmentId" value={id} />
            <Field
              label="Adjusted overall score"
              name="overallScore"
              type="number"
              required
              defaultValue={String(assessment.overall_score ?? '')}
            />
            <Field
              label="Why"
              name="reason"
              required
              multiline
              hint="At least twenty characters. An override without a reason is rejected by the database, not by this form."
            />
          </ActionForm>
        </div>

        <div className="rounded-xl border border-line p-5">
          <h3 className="font-semibold">Reject</h3>
          <ActionForm action={rejectAssessment} submitLabel="Reject" destructive>
            <input type="hidden" name="assessmentId" value={id} />
            <Field
              label="Why"
              name="reason"
              required
              multiline
              hint="The customer sees this, and can appeal it."
            />
          </ActionForm>
        </div>
      </section>

      {reviews && reviews.length > 0 && (
        <section aria-labelledby="history" className="space-y-3">
          <h2 id="history" className="text-xl font-semibold">
            Review history
          </h2>
          <ol className="space-y-2 text-sm">
            {reviews.map((review, index) => (
              <li key={index} className="rounded-lg border border-line p-3">
                <span className="font-medium">{String(review.action)}</span> ·{' '}
                <span className="text-muted">
                  {new Date(review.created_at as string).toUTCString()}
                </span>
                {review.reason ? <p className="mt-1 text-muted">{String(review.reason)}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
