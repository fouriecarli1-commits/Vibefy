import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { daysRemaining, isOverdue, RESPONSE_DAYS, type RequestStatus } from '@vibefy/governance';
import { ActionForm, Field, Select } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { resolveDataRequest } from '@/app/console/privacy/actions';

export const metadata: Metadata = { title: 'Data requests' };

/**
 * The data-subject request queue.
 *
 * A statutory deadline nobody is looking at is the same as no deadline, so the
 * overdue ones sort first and are marked as owed rather than as late.
 */
export default async function ReviewRequestsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/review/requests');

  const { data: requests } = await supabase
    .from('data_requests')
    .select('id, user_id, request_type, status, details, response, refusal_basis, due_at, created_at')
    .order('due_at');

  const open = (requests ?? []).filter(
    (request) => !['completed', 'refused'].includes(String(request.status)),
  );

  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/review">Review</Link> · Data requests
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Data requests</h1>
        <p className="text-muted">
          {open.length} open. Each has {RESPONSE_DAYS} days from the moment it was made. A refusal
          has to name its lawful basis — the database refuses one without.
        </p>
      </header>

      {open.length === 0 ? (
        <p className="rounded-xl border border-line p-5 text-sm text-muted">
          Nothing open. This queue being empty is a claim we can make because it is a queue and not
          an inbox.
        </p>
      ) : (
        <ul className="space-y-4">
          {open.map((request) => {
            const due = new Date(request.due_at as string);
            const overdue = isOverdue(due, String(request.status) as RequestStatus);
            return (
              <li key={request.id as string} className="rounded-xl border border-line p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="font-semibold">
                    {String(request.request_type).replace(/_/g, ' ')}
                  </h2>
                  <span className={`text-sm ${overdue ? 'text-bad' : 'text-muted'}`}>
                    {overdue ? 'Owed — past its due date' : `${daysRemaining(due)} days left`}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  Raised {new Date(request.created_at as string).toUTCString()} · status{' '}
                  {String(request.status).replace(/_/g, ' ')}
                </p>
                {request.details && <p className="mt-3 text-sm">{String(request.details)}</p>}

                <div className="mt-5">
                  <ActionForm action={resolveDataRequest} submitLabel="Record">
                    <input type="hidden" name="requestId" value={request.id as string} />
                    <Select
                      label="Status"
                      name="status"
                      defaultValue="in_progress"
                      options={[
                        { value: 'verifying', label: 'Verifying it is them' },
                        { value: 'in_progress', label: 'Being worked on' },
                        { value: 'completed', label: 'Answered' },
                        { value: 'refused', label: 'Refused' },
                      ]}
                    />
                    <Field
                      label="What was done"
                      name="response"
                      multiline
                      hint="Required to mark it answered. Written for them, in words we can be held to."
                    />
                    <Field
                      label="Lawful basis for refusing"
                      name="refusalBasis"
                      multiline
                      hint="Required to refuse. Name the basis; do not assert that one exists."
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
