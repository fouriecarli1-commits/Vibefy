import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CHALLENGE_PATH, DNS_RECORD_PREFIX } from '@vibefy/engine/authorisation';
import { revokeAuthorisation, startAuthorisation, verifyAuthorisation } from '../actions';
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

  const { data: authorisations } = await supabase
    .from('authorisations')
    .select('*')
    .eq('app_id', id)
    .order('created_at', { ascending: false });

  const current = authorisations?.[0] ?? null;
  const status = current?.status ?? 'none';
  const copy = STATUS_COPY[status] ?? STATUS_COPY.none!;
  const host = app.primary_url ? new URL(app.primary_url as string).hostname : '';

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
