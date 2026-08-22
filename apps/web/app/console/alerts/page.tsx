import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { markAlertRead, markAllAlertsRead } from './actions';

export const metadata: Metadata = { title: 'Alerts' };

const SEVERITY: Record<string, { label: string; tone: string }> = {
  info: { label: 'For information', tone: 'text-muted' },
  warning: { label: 'Worth a look', tone: 'text-warn' },
  critical: { label: 'Needs action', tone: 'text-bad' },
};

const KIND_LABEL: Record<string, string> = {
  assessment_completed: 'Assessment finished',
  drift_detected: 'Change since last time',
  material_regression: 'Material change',
  badge_suspended: 'Badge suspended',
  badge_expiring: 'Badge expiring',
  application_unreachable: 'Not responding',
  application_recovered: 'Responding again',
  subscription_problem: 'Subscription',
};

/**
 * The alert inbox.
 *
 * Everything monitoring notices lands here, whether or not an email went out.
 * That ordering is deliberate: the console is the record, and email is a
 * best-effort copy of it. A customer who never opens an email can still find
 * out why their badge went down.
 */
export default async function AlertsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/console/alerts');

  const { data: alerts, error } = await supabase
    .from('alerts')
    .select('id, kind, severity, title, body, app_id, assessment_id, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  const unread = (alerts ?? []).filter((alert) => !alert.read_at);

  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/console">Console</Link> · Alerts
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Alerts</h1>
        <p className="text-muted">
          What we noticed between assessments: score movement, findings that appeared or were fixed,
          and applications that stopped answering. Each one is written once — we do not resend the
          same warning.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-xl border border-line p-5 text-bad">
          Could not load your alerts: {error.message}
        </p>
      )}

      {unread.length > 0 && (
        <div className="rounded-xl border border-line bg-surface-muted p-5">
          <p className="mb-4 text-sm">
            {unread.length} unread {unread.length === 1 ? 'alert' : 'alerts'}.
          </p>
          <ActionForm action={markAllAlertsRead} submitLabel="Mark all read">
            <span className="sr-only">Marks every alert in this list as read.</span>
          </ActionForm>
        </div>
      )}

      {(alerts ?? []).length === 0 ? (
        <p className="rounded-xl border border-line p-5 text-sm text-muted">
          Nothing yet. Alerts appear here once an application of yours is being monitored.
        </p>
      ) : (
        <ul className="space-y-4">
          {(alerts ?? []).map((alert) => {
            const severity = SEVERITY[String(alert.severity)] ?? SEVERITY.info!;
            return (
              <li
                key={alert.id as string}
                className={`rounded-xl border p-5 ${alert.read_at ? 'border-line' : 'border-line-strong'}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="font-semibold">{String(alert.title)}</h2>
                  <span className={`text-sm ${severity.tone}`}>{severity.label}</span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {KIND_LABEL[String(alert.kind)] ?? String(alert.kind)} ·{' '}
                  {new Date(alert.created_at as string).toUTCString()}
                  {alert.read_at ? ' · read' : ''}
                </p>
                <p className="mt-3 whitespace-pre-line text-sm">{String(alert.body)}</p>
                <div className="mt-4 flex flex-wrap items-center gap-5 text-sm">
                  {alert.app_id && (
                    <Link href={`/console/apps/${alert.app_id}`}>Open the application</Link>
                  )}
                  {alert.assessment_id && (
                    <Link href={`/console/reports/${alert.assessment_id}`}>Read the report</Link>
                  )}
                </div>
                {!alert.read_at && (
                  <div className="mt-3">
                    <ActionForm action={markAlertRead} submitLabel="Mark read">
                      <input type="hidden" name="alertId" value={alert.id as string} />
                    </ActionForm>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
