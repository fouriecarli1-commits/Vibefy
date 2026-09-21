import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SCREENING_CATEGORIES } from '@vibefycode/engine/authorisation';
import { ActionForm, Field, Select } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { recordScreeningDecision } from './actions';

export const metadata: Metadata = { title: 'Submissions awaiting a check' };

/**
 * The queue behind a promise the product was already making.
 *
 * The application page tells a customer "A reviewer confirms every submission
 * before an assessment runs." Until this screen existed there was nowhere to do
 * that: the intake screen refused what its deterministic filter caught, sent
 * everything else to `pending`, and `pending` went straight through to an
 * assessment. Every submission sits in `pending`, because the judgement pass
 * that would clear the easy ones is not wired up — so the whole promise rested
 * on a column nobody read.
 *
 * Nothing here decides anything on its own. `record_screening_decision` in the
 * database is what enforces reviewer-only, a reason in writing, and an audit
 * line; this is the place a person reads the submission and types the sentence.
 */
export default async function ScreeningQueuePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/review/screening');

  const { data: profile } = await supabase
    .from('users')
    .select('platform_role')
    .eq('id', user.id)
    .single();
  const isReviewer = profile?.platform_role === 'reviewer' || profile?.platform_role === 'admin';
  if (!isReviewer) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Submissions awaiting a check</h1>
        <p className="text-muted">
          This queue is for VibefyCode reviewers. Row-level security means you would see nothing
          here in any case.
        </p>
      </div>
    );
  }

  const { data: waiting } = await supabase
    .from('apps')
    .select(
      'id, name, primary_url, app_type, category, description, target_audience, screening_notes, created_at, processes_personal_data, has_authentication, has_payments',
    )
    .eq('screening_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(50);

  const queue = waiting ?? [];

  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/review">Review</Link> · Screening
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Submissions awaiting a check</h1>
        <p className="text-muted">
          {queue.length === 0 ? 'Nothing waiting.' : `${queue.length} waiting, oldest first.`} No
          assessment runs against an application in this list. Both answers need a sentence saying
          why — the customer reads it, and so does whoever opens the file in a year.
        </p>
      </header>

      {queue.length === 0 ? (
        <p className="rounded-xl border border-line p-5 text-sm text-muted">
          An empty queue here is a claim worth making, because it is a queue and not an inbox.
        </p>
      ) : (
        <ul className="space-y-6">
          {queue.map((app) => (
            <li key={app.id as string} className="space-y-4 rounded-xl border border-line p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-semibold">{String(app.name)}</h2>
                <span className="text-sm text-muted">
                  submitted {new Date(String(app.created_at)).toUTCString()}
                </span>
              </div>

              <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted">Address</dt>
                <dd>
                  <code>{String(app.primary_url ?? '—')}</code>
                </dd>
                <dt className="text-muted">Kind</dt>
                <dd>
                  {String(app.app_type).replace(/_/g, ' ')}
                  {app.category ? ` · ${String(app.category)}` : ''}
                </dd>
                <dt className="text-muted">Audience</dt>
                <dd>{String(app.target_audience ?? 'not stated')}</dd>
                <dt className="text-muted">Declared at intake</dt>
                <dd>
                  {[
                    app.processes_personal_data ? 'personal data' : null,
                    app.has_authentication ? 'accounts' : null,
                    app.has_payments ? 'payments' : null,
                  ]
                    .filter(Boolean)
                    .join(', ') || 'none of personal data, accounts or payments'}
                </dd>
              </dl>

              <div className="rounded-lg border border-line bg-surface-muted p-4">
                <h3 className="text-sm font-medium">What the submitter wrote</h3>
                <p className="mt-2 whitespace-pre-line text-sm">
                  {String(app.description ?? '').trim() || 'Nothing.'}
                </p>
              </div>

              {app.screening_notes && (
                <p className="text-sm text-muted">
                  Automatic screen: {String(app.screening_notes)}
                </p>
              )}

              <ActionForm action={recordScreeningDecision} submitLabel="Record this decision">
                <input type="hidden" name="appId" value={app.id as string} />
                <Select
                  label="Decision"
                  name="decision"
                  defaultValue="cleared"
                  options={[
                    { value: 'cleared', label: 'Cleared — an assessment may run' },
                    { value: 'refused', label: 'Refused under the Acceptable Use Policy' },
                  ]}
                  hint="A refusal is appealable, free, and read by a person."
                />
                <Field
                  label="Why"
                  name="note"
                  multiline
                  required
                  hint={`Shown to the customer. For a refusal, quote the part you relied on — one of: ${SCREENING_CATEGORIES.join(', ').replace(/_/g, ' ')}.`}
                  placeholder="An ordinary shop front; nothing in the description touches the policy."
                />
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
