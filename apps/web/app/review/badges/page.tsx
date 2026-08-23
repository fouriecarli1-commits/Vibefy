import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { reinstateBadge, revokeBadge, suspendBadge } from '../badge-actions';
import { ActionForm, Field } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Issued badges' };

/**
 * The badge register, and the controls for taking one down.
 *
 * Revocation is a reviewer action, never a customer one: a customer who could
 * revoke their own badge could also un-revoke it. Origin mismatches are surfaced
 * here because a badge appearing on a domain it is not licensed for is the
 * signal that matters most, and it arrives as telemetry rather than a complaint.
 */
export default async function BadgeRegisterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/review/badges');

  const { data: profile } = await supabase
    .from('users')
    .select('platform_role')
    .eq('id', user.id)
    .single();
  const isReviewer = profile?.platform_role === 'reviewer' || profile?.platform_role === 'admin';
  if (!isReviewer) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Issued badges</h1>
        <p className="text-muted">
          This register is for VibefyCode reviewers. Row-level security means you would see nothing
          here in any case.
        </p>
      </div>
    );
  }

  const { data: badges } = await supabase
    .from('badges')
    .select(
      'id, slug, public_id, status, score, rubric_version, issued_at, expires_at, certified_origin, revocation_reason, apps (name)',
    )
    .order('issued_at', { ascending: false })
    .limit(50);

  const { data: mismatches } = await supabase
    .from('badge_events')
    .select('badge_id, observed_origin, occurred_at')
    .eq('event_type', 'origin_mismatch')
    .order('occurred_at', { ascending: false })
    .limit(20);

  const mismatchByBadge = new Map<string, { origin: string; at: string }[]>();
  for (const event of mismatches ?? []) {
    const list = mismatchByBadge.get(String(event.badge_id)) ?? [];
    list.push({ origin: String(event.observed_origin), at: String(event.occurred_at) });
    mismatchByBadge.set(String(event.badge_id), list);
  }

  return (
    <div className="max-w-4xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Issued badges</h1>
        <p className="text-muted">
          Every state change here is written to an append-only log by the database, with its reason.
          Because the image is served from our origin, a revocation stops every embedded instance
          reading as verified within minutes.
        </p>
      </header>

      {(mismatches ?? []).length > 0 && (
        <section role="note" className="rounded-xl border border-line bg-surface-muted p-5">
          <h2 className="font-semibold">Origin mismatches observed</h2>
          <p className="mt-2 text-sm text-muted">
            A badge requested from a domain it is not licensed for. This is usually someone copying
            a competitor's badge; occasionally it is a customer's staging site.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {(mismatches ?? []).slice(0, 10).map((event, index) => (
              <li key={index}>
                <code>{String(event.observed_origin)}</code>{' '}
                <span className="text-muted">
                  {new Date(String(event.occurred_at)).toUTCString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="space-y-5">
        {(badges ?? []).map((badge) => {
          const app = badge.apps as unknown as { name: string } | null;
          const badgeMismatches = mismatchByBadge.get(String(badge.id)) ?? [];
          return (
            <li key={badge.id as string} className="space-y-4 rounded-xl border border-line p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{app?.name ?? 'Application'}</h2>
                  <p className="text-sm text-muted">
                    {Number(badge.score).toFixed(1)} / 100 · rubric v{String(badge.rubric_version)}{' '}
                    · <code>{String(badge.certified_origin)}</code>
                  </p>
                </div>
                <span
                  className={`text-sm font-medium ${
                    badge.status === 'active'
                      ? 'text-ok'
                      : badge.status === 'revoked'
                        ? 'text-bad'
                        : 'text-warn'
                  }`}
                >
                  {String(badge.status)}
                </span>
              </div>

              <p className="text-sm text-muted">
                Issued {new Date(badge.issued_at as string).toISOString().slice(0, 10)} · expires{' '}
                {new Date(badge.expires_at as string).toISOString().slice(0, 10)} ·{' '}
                <Link href={`/a/${badge.slug}`}>verification page</Link>
                {badgeMismatches.length > 0 && (
                  <span className="text-warn">
                    {' '}
                    · {badgeMismatches.length} origin mismatch
                    {badgeMismatches.length === 1 ? '' : 'es'}
                  </span>
                )}
              </p>

              {badge.revocation_reason ? (
                <p className="text-sm text-muted">
                  Reason on file: {String(badge.revocation_reason)}
                </p>
              ) : null}

              {badge.status === 'active' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-line p-4">
                    <h3 className="text-sm font-semibold">Suspend</h3>
                    <ActionForm action={suspendBadge} submitLabel="Suspend">
                      <input type="hidden" name="badgeId" value={badge.id as string} />
                      <Field label="Why" name="reason" required />
                    </ActionForm>
                  </div>
                  <div className="rounded-lg border border-line p-4">
                    <h3 className="text-sm font-semibold">Revoke</h3>
                    <ActionForm action={revokeBadge} submitLabel="Revoke" destructive>
                      <input type="hidden" name="badgeId" value={badge.id as string} />
                      <Field
                        label="Why"
                        name="reason"
                        required
                        hint="Shown on the verification page."
                      />
                    </ActionForm>
                  </div>
                </div>
              )}

              {badge.status === 'suspended' && (
                <div className="rounded-lg border border-line p-4">
                  <h3 className="text-sm font-semibold">Reinstate</h3>
                  <p className="mb-3 text-sm text-muted">
                    The suspension stays in the history; reinstatement is recorded as its own event.
                  </p>
                  <ActionForm action={reinstateBadge} submitLabel="Reinstate">
                    <input type="hidden" name="badgeId" value={badge.id as string} />
                  </ActionForm>
                </div>
              )}
            </li>
          );
        })}
        {(badges ?? []).length === 0 && (
          <li className="rounded-xl border border-line bg-surface-muted p-5 text-muted">
            No badges issued yet.
          </li>
        )}
      </ul>
    </div>
  );
}
