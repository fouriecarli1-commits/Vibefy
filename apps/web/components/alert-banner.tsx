import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { markAlertRead } from '@/app/console/alerts/actions';
import { createClient } from '@/lib/supabase/server';

/**
 * The alerts that should not wait to be found.
 *
 * Email is the record — a badge suspension is a notice we are obliged to give,
 * and there has to be evidence it was sent. But nobody reads email from a
 * product like this, so the notice that actually changes behaviour is the one
 * on the screen the customer is already looking at.
 *
 * Only `critical` appears here. A banner that shows on every visit is a banner
 * people learn to scroll past, and then the one that mattered is scrolled past
 * with it.
 */
export async function AlertBanner() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: alerts } = await supabase
    .from('alerts')
    .select('id, title, body, app_id, assessment_id, created_at')
    .eq('severity', 'critical')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!alerts || alerts.length === 0) return null;

  return (
    <section
      role="alert"
      aria-label="Alerts needing action"
      className="mb-8 space-y-3 rounded-xl border-2 border-line-strong bg-surface-muted p-5"
    >
      <h2 className="font-semibold text-bad">
        {alerts.length === 1 ? 'One alert needs action' : `${alerts.length} alerts need action`}
      </h2>
      <ul className="space-y-4">
        {alerts.map((alert) => {
          const href = alert.assessment_id
            ? `/console/reports/${alert.assessment_id}`
            : alert.app_id
              ? `/console/apps/${alert.app_id}`
              : '/console/alerts';
          return (
            <li key={alert.id as string} className="space-y-2">
              <p className="font-medium">{String(alert.title)}</p>
              <p className="text-sm text-muted">{String(alert.body)}</p>
              <div className="flex flex-wrap items-center gap-5 text-sm">
                <Link href={href}>Open it</Link>
                {/* Dismissing marks it read — it does not delete it. What we told
                    someone, and when, stays in the alert history either way. */}
                <ActionForm action={markAlertRead} submitLabel="Dismiss">
                  <input type="hidden" name="alertId" value={alert.id as string} />
                </ActionForm>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">
        <Link href="/console/alerts">All alerts</Link> · we email these too, so there is a record
        of the notice.
      </p>
    </section>
  );
}
