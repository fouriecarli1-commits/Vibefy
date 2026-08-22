import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Review queue' };

/**
 * The reviewer queue.
 *
 * AI generates the assessment; a human approves before anything is certified.
 * This queue is the human. It is deliberately built in M1 rather than later,
 * because a certification path with no reviewer in it is a path that quietly
 * becomes automatic.
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
        <h1 className="text-3xl font-bold tracking-tight">Review queue</h1>
        <p className="text-muted">
          This queue is for Vibefy reviewers. Row-level security means you would see nothing here in
          any case — this message just explains why.
        </p>
      </div>
    );
  }

  const { data: queue } = await supabase
    .from('assessments')
    .select(
      'id, app_id, overall_score, rubric_version, created_at, gate_failures, apps (name, primary_url)',
    )
    .eq('status', 'awaiting_review')
    .order('created_at', { ascending: true });

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Review queue</h1>
        <p className="text-muted">
          Oldest first. Nothing is certified until one of these is approved, and every adjustment
          you make is recorded with your reason, permanently.
        </p>
      </header>

      <nav aria-label="Review queues" className="flex flex-wrap gap-5 text-sm">
        <Link href="/review/badges">Badges</Link>
        <Link href="/review/appeals">Appeals</Link>
        <Link href="/review/requests">Data requests</Link>
      </nav>

      {queue && queue.length > 0 ? (
        <ol className="space-y-3">
          {queue.map((assessment) => {
            const app = assessment.apps as unknown as { name: string; primary_url: string } | null;
            const blockers = (assessment.gate_failures as string[]) ?? [];
            return (
              <li key={assessment.id as string} className="rounded-xl border border-line p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <Link href={`/review/${assessment.id}`} className="font-semibold">
                    {app?.name ?? 'Application'}
                  </Link>
                  <span className="tabular-nums text-sm text-muted">
                    {assessment.overall_score ?? '—'} / 100 · rubric v{assessment.rubric_version}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{app?.primary_url}</p>
                {blockers.length > 0 && (
                  <p className="mt-2 text-sm text-warn">
                    {blockers.length} certification blocker{blockers.length === 1 ? '' : 's'}:{' '}
                    {blockers[0]}
                  </p>
                )}
                <p className="mt-2 text-sm text-muted">
                  Waiting since {new Date(assessment.created_at as string).toUTCString()}
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-xl border border-line bg-surface-muted p-5 text-muted">
          Nothing waiting. An empty queue is the goal, not a problem.
        </p>
      )}
    </div>
  );
}
