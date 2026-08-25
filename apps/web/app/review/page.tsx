import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { triageAssessment, type Triage, type TriageFinding } from '@vibefycode/governance';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Review queue' };

/**
 * The reviewer queue, built for a phone.
 *
 * A human approves before anything is certified, and that gate is what makes
 * the badge mean anything. But it should cost minutes rather than an afternoon,
 * and what costs the afternoon is working out which of forty findings deserve a
 * second look. Each item therefore arrives triaged: what needs attention, what
 * is routine, and roughly how long it will take.
 *
 * What this page deliberately does **not** do is let anything be approved from
 * the list. A one-tap approve on a summary is not review; it is a rubber stamp
 * with good typography, and a certification path with no reviewer in it is
 * exactly what M1 built this queue to prevent. Deciding requires opening the
 * assessment and seeing the evidence.
 */
export default async function ReviewQueuePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/review');

  const { data: profile } = await supabase
    .from('users')
    .select('platform_role')
    .eq('id', user.id)
    .single();
  const isReviewer = profile?.platform_role === 'reviewer' || profile?.platform_role === 'admin';

  if (!isReviewer) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Review queue</h1>
        <p className="text-muted">
          This queue is for VibefyCode reviewers. Row-level security means you would see nothing
          here in any case — this message just explains why.
        </p>
      </div>
    );
  }

  const { data: queue } = await supabase
    .from('assessments')
    .select(
      'id, app_id, overall_score, certification_eligible, rubric_version, created_at, gate_failures, apps (name, primary_url)',
    )
    .eq('status', 'awaiting_review')
    .order('created_at', { ascending: true });

  const ids = (queue ?? []).map((assessment) => assessment.id as string);

  // One query for every finding in the queue rather than one per assessment: a
  // queue page that gets slower as the backlog grows is a queue page nobody
  // opens when the backlog is what matters.
  const { data: findings } = ids.length
    ? await supabase
        .from('findings')
        .select(
          'assessment_id, title, severity, dimension, confidence, is_published, finding_evidence (evidence_id)',
        )
        .in('assessment_id', ids)
    : { data: [] };

  const { data: stages } = ids.length
    ? await supabase
        .from('assessment_runs')
        .select('assessment_id, stage, status')
        .in('assessment_id', ids)
        .neq('status', 'succeeded')
    : { data: [] };

  const byAssessment = new Map<string, TriageFinding[]>();
  for (const row of findings ?? []) {
    const key = row.assessment_id as string;
    const evidence = (row.finding_evidence as unknown as { evidence_id: string }[]) ?? [];
    const list = byAssessment.get(key) ?? [];
    list.push({
      title: String(row.title),
      severity: row.severity as TriageFinding['severity'],
      dimension: String(row.dimension),
      confidence: row.confidence as TriageFinding['confidence'],
      isPublished: row.is_published === true,
      evidenceCount: evidence.length,
    });
    byAssessment.set(key, list);
  }

  const failedByAssessment = new Map<string, string[]>();
  for (const row of stages ?? []) {
    const key = row.assessment_id as string;
    failedByAssessment.set(key, [...(failedByAssessment.get(key) ?? []), String(row.stage)]);
  }

  const items = (queue ?? []).map((assessment) => {
    const id = assessment.id as string;
    return {
      id,
      app: assessment.apps as unknown as { name: string; primary_url: string } | null,
      waitingSince: new Date(assessment.created_at as string),
      rubricVersion: String(assessment.rubric_version),
      triage: triageAssessment({
        overallScore: assessment.overall_score === null ? null : Number(assessment.overall_score),
        certificationEligible: assessment.certification_eligible === true,
        gateFailures: (assessment.gate_failures as string[]) ?? [],
        findings: byAssessment.get(id) ?? [],
        failedStages: failedByAssessment.get(id) ?? [],
      }),
    };
  });

  // What needs a person first, not what arrived first. An old straightforward
  // one can wait behind a new one that is about to certify at 70.2.
  const sorted = [...items].sort((a, b) => {
    const byAttention = b.triage.attention.length - a.triage.attention.length;
    return byAttention !== 0 ? byAttention : a.waitingSince.getTime() - b.waitingSince.getTime();
  });

  const totalMinutes = items.reduce((sum, item) => sum + item.triage.estimatedMinutes, 0);
  const needingAttention = items.filter((item) => item.triage.attention.length > 0).length;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="eyebrow">Human review</p>
        <h1 className="text-3xl font-bold">Review queue</h1>
        <p className="max-w-2xl text-muted">
          Nothing is certified until one of these is approved. Every item is summarised before you
          open it, so the time goes on the ones that need judgement.
        </p>
      </header>

      <nav aria-label="Review queues" className="flex flex-wrap gap-2">
        <Link href="/review/badges" className="chip">
          Badges
        </Link>
        <Link href="/review/appeals" className="chip">
          Appeals
        </Link>
        <Link href="/review/requests" className="chip">
          Data requests
        </Link>
      </nav>

      {items.length > 0 && (
        <div className="grid-cards">
          <div className="stat">
            <span className="stat-value">{items.length}</span>
            <span className="stat-label">Waiting</span>
          </div>
          <div className="stat">
            <span className="stat-value">{needingAttention}</span>
            <span className="stat-label">Need a closer look</span>
          </div>
          <div className="stat">
            <span className="stat-value">~{totalMinutes}</span>
            <span className="stat-label">Minutes, all in</span>
          </div>
        </div>
      )}

      {sorted.length > 0 ? (
        <ol className="space-y-3">
          {sorted.map((item) => (
            <li key={item.id} className="panel space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-semibold">
                  <Link href={`/review/${item.id}`}>{item.app?.name ?? 'Application'}</Link>
                </h2>
                <span className="chip" data-tone={item.triage.attention.length > 0 ? 'warn' : 'ok'}>
                  {item.triage.attention.length > 0
                    ? `${item.triage.attention.length} to check`
                    : 'Straightforward'}
                </span>
              </div>

              <p className="text-sm">{item.triage.headline}</p>

              {item.triage.attention.length > 0 && (
                <ul className="space-y-2">
                  {item.triage.attention.map((entry) => (
                    <li key={entry.id} className="bar" data-tone="warn">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{entry.label}</p>
                        <p className="text-xs text-muted">{entry.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {item.triage.routine.length > 0 && (
                <p className="text-xs text-muted">{item.triage.routine.join(' ')}</p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <span className="text-xs text-muted">
                  {item.app?.primary_url} · rubric v{item.rubricVersion} · waiting since{' '}
                  <span className="tabular">
                    {item.waitingSince.toISOString().slice(0, 16).replace('T', ' ')} UTC
                  </span>
                </span>
                {/* The only action here. Deciding needs the evidence, and the
                    evidence is on the next page. */}
                <Link href={`/review/${item.id}`} className="nav-cta">
                  Open · ~{item.triage.estimatedMinutes} min
                </Link>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="bar">
          <p className="text-sm">Nothing waiting. An empty queue is the goal, not a problem.</p>
        </div>
      )}
    </div>
  );
}

// Kept exported so the shape is checked at compile time rather than inferred.
export type { Triage };
