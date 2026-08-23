import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  daysRemaining,
  isOverdue,
  REQUEST_KINDS,
  RESPONSE_DAYS,
  RETENTION_SCHEDULE,
  type RequestStatus,
} from '@vibefycode/governance';
import { ActionForm, Field, Select } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { setAlertEmailLevel, submitDataRequest } from './actions';

export const metadata: Metadata = { title: 'Your data' };

const STATUS_COPY: Record<RequestStatus, string> = {
  received: 'Received',
  verifying: 'Verifying it is you',
  in_progress: 'Being worked on',
  completed: 'Answered',
  refused: 'Refused',
};

/**
 * Data-subject rights, in product.
 *
 * PART 8.2 asks for working flows rather than an email address. The clock is
 * the difference: a request made here has a due date the moment it exists, set
 * by the database rather than by anyone's intention, and it is shown to the
 * person who made it.
 */
export default async function PrivacyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/console/privacy');

  const { data: requests } = await supabase
    .from('data_requests')
    .select('id, request_type, status, details, response, refusal_basis, due_at, created_at, completed_at')
    .order('created_at', { ascending: false });

  const { data: me } = await supabase
    .from('users')
    .select('alert_email_level')
    .eq('id', user.id)
    .maybeSingle();

  const { data: deletions } = await supabase
    .from('retention_deletions')
    .select('id, data_class, retention_until, deleted_at')
    .order('deleted_at', { ascending: false })
    .limit(10);

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/console">Console</Link> · Your data
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Your data</h1>
        <p className="text-muted">
          Ask for a copy, a correction, a deletion, a portable export, or object to something we do.
          Requests are answered within {RESPONSE_DAYS} days. There is no address to email: the
          request is made here and the deadline starts when you make it.
        </p>
        <p className="text-sm text-muted">
          The <Link href="/legal/privacy-policy">privacy notice</Link> sets out what we hold and on
          what basis. It is a draft and has not been reviewed by counsel.
        </p>
      </header>

      <section aria-labelledby="make" className="space-y-4">
        <h2 id="make" className="text-xl font-semibold">
          Make a request
        </h2>
        <div className="rounded-xl border border-line p-5">
          <ActionForm action={submitDataRequest} submitLabel="Submit request">
            <Select
              label="What are you asking for?"
              name="requestType"
              defaultValue="access"
              options={REQUEST_KINDS.map((kind) => ({ value: kind.type, label: kind.label }))}
            />
            <Field
              label="Anything we should know"
              name="details"
              multiline
              hint="Required for a correction or an objection: tell us what is wrong, or which processing you object to."
            />
          </ActionForm>
        </div>

        <div className="space-y-3">
          {REQUEST_KINDS.map((kind) => (
            <details key={kind.type} className="rounded-xl border border-line p-5 text-sm">
              <summary className="cursor-pointer font-medium">{kind.label}</summary>
              <p className="mt-3 text-muted">{kind.promise}</p>
            </details>
          ))}
        </div>
      </section>

      {(requests ?? []).length > 0 && (
        <section aria-labelledby="open" className="space-y-4">
          <h2 id="open" className="text-xl font-semibold">
            Your requests
          </h2>
          <ul className="space-y-3">
            {(requests ?? []).map((request) => {
              const status = String(request.status) as RequestStatus;
              const due = new Date(request.due_at as string);
              const overdue = isOverdue(due, status);
              return (
                <li key={request.id as string} className="rounded-xl border border-line p-5 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span className="font-medium">
                      {String(request.request_type).replace(/_/g, ' ')}
                    </span>
                    <span className={overdue ? 'text-bad' : 'text-muted'}>
                      {STATUS_COPY[status]}
                      {['completed', 'refused'].includes(status)
                        ? ''
                        : overdue
                          ? ' · past its due date, and we owe you an answer'
                          : ` · due in ${daysRemaining(due)} days`}
                    </span>
                  </div>
                  {request.details && <p className="mt-2 text-muted">{String(request.details)}</p>}
                  {request.response && <p className="mt-3">{String(request.response)}</p>}
                  {request.refusal_basis && (
                    <p className="mt-3 text-muted">
                      Refused on this basis: {String(request.refusal_basis)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="email" className="space-y-4">
        <h2 id="email" className="text-xl font-semibold">
          Alerts by email
        </h2>
        <div className="rounded-xl border border-line p-5">
          <p className="text-sm text-muted">
            We email you about your own applications — a re-assessment that found something
            different, an application that stopped answering, a badge about to expire. There is no
            marketing list to leave, and no tracking pixel in any of it.
          </p>
          <div className="mt-5">
            <ActionForm action={setAlertEmailLevel} submitLabel="Save preference">
              <Select
                label="What should reach your inbox?"
                name="alertEmailLevel"
                defaultValue={String(me?.alert_email_level ?? 'all')}
                options={[
                  { value: 'all', label: 'Anything worth a look, and anything that needs action' },
                  { value: 'critical_only', label: 'Only what needs action' },
                ]}
                hint="A badge suspension is a notice we are required to give you, so it is sent either way."
              />
            </ActionForm>
          </div>
        </div>
      </section>

      <section aria-labelledby="retention" className="space-y-4">
        <h2 id="retention" className="text-xl font-semibold">
          How long we keep things
        </h2>
        <ul className="space-y-3">
          {RETENTION_SCHEDULE.map((rule) => (
            <li key={rule.dataClass} className="rounded-xl border border-line p-5 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="font-medium">{rule.dataClass.replace(/_/g, ' ')}</span>
                <span className="text-muted">{rule.days} days</span>
              </div>
              <p className="mt-2 text-muted">{rule.rationale}</p>
            </li>
          ))}
        </ul>
        {(deletions ?? []).length > 0 && (
          <div className="rounded-xl border border-line bg-surface-muted p-5 text-sm">
            <h3 className="font-semibold">Recently deleted on schedule</h3>
            <p className="mt-1 text-muted">
              We keep a hash of what was deleted and not the thing itself, so this is proof the
              schedule ran rather than an assurance that it did.
            </p>
            <ul className="mt-3 space-y-1 text-muted">
              {(deletions ?? []).map((deletion) => (
                <li key={deletion.id as string}>
                  {String(deletion.data_class).replace(/_/g, ' ')} · deleted{' '}
                  {new Date(deletion.deleted_at as string).toISOString().slice(0, 10)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
