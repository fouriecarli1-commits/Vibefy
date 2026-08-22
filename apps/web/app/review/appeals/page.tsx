import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { APPEAL_RESPONSE_DAYS, daysRemaining } from '@vibefy/governance';
import { ActionForm, Field, Select } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { resolveAppeal } from '@/app/console/privacy/actions';

export const metadata: Metadata = { title: 'Appeals' };

/**
 * The appeals queue.
 *
 * An appeal is answered by someone who did not work on the assessment, in
 * writing, whether it succeeds or not — including a rejection, which is the one
 * nobody wants to write and the one the policy exists for.
 */
export default async function ReviewAppealsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/review/appeals');

  const { data: appeals } = await supabase
    .from('appeals')
    .select('id, assessment_id, finding_id, status, grounds, resolution, due_at, created_at')
    .in('status', ['open', 'under_review'])
    .order('due_at');

  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/review">Review</Link> · Appeals
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Appeals</h1>
        <p className="text-muted">
          {(appeals ?? []).length} open, each due within {APPEAL_RESPONSE_DAYS} days. Read the{' '}
          <Link href="/legal/appeals-and-corrections">published policy</Link> — it is what the
          customer read.
        </p>
      </header>

      {(appeals ?? []).length === 0 ? (
        <p className="rounded-xl border border-line p-5 text-sm text-muted">Nothing open.</p>
      ) : (
        <ul className="space-y-4">
          {(appeals ?? []).map((appeal) => {
            const due = new Date(appeal.due_at as string);
            const overdue = due.getTime() < Date.now();
            return (
              <li key={appeal.id as string} className="rounded-xl border border-line p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="font-semibold">
                    <Link href={`/console/reports/${appeal.assessment_id}`}>
                      Assessment {String(appeal.assessment_id).slice(0, 8)}
                    </Link>
                  </h2>
                  <span className={`text-sm ${overdue ? 'text-bad' : 'text-muted'}`}>
                    {overdue ? 'Owed — past its due date' : `${daysRemaining(due)} days left`}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {appeal.finding_id ? 'About one finding' : 'About the assessment as a whole'} ·
                  raised {new Date(appeal.created_at as string).toUTCString()}
                </p>
                <p className="mt-3 whitespace-pre-line text-sm">{String(appeal.grounds)}</p>

                <div className="mt-5">
                  <ActionForm action={resolveAppeal} submitLabel="Record outcome">
                    <input type="hidden" name="appealId" value={appeal.id as string} />
                    <Select
                      label="Outcome"
                      name="status"
                      defaultValue="under_review"
                      options={[
                        { value: 'under_review', label: 'Under review' },
                        { value: 'upheld', label: 'Upheld' },
                        { value: 'partially_upheld', label: 'Partially upheld' },
                        { value: 'rejected', label: 'Rejected' },
                      ]}
                    />
                    <Field
                      label="Reasons"
                      name="resolution"
                      multiline
                      hint="Required for every outcome except leaving it under review. A rejection with no reasons is the failure this policy exists to prevent."
                    />
                  </ActionForm>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
