import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CEILINGS } from '@vibefycode/governance';
import pricing from '../../../../../config/pricing.json' with { type: 'json' };
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Unit economics' };

/**
 * The internal cost dashboard.
 *
 * PART 9: if unit cost exceeds price, the business is dead — so the number is
 * visible from the first run rather than discovered in a month-end invoice.
 * Row-level security restricts `cost_records` to platform admins, and
 * deliberately not to reviewers: a reviewer who can see what an assessment cost
 * us is a reviewer with a commercial signal in front of them.
 */
export default async function CostsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/admin/costs');

  const { data: profile } = await supabase
    .from('users')
    .select('platform_role')
    .eq('id', user.id)
    .single();
  if (profile?.platform_role !== 'admin') {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Unit economics</h1>
        <p className="text-muted">
          This dashboard is for VibefyCode administrators. Row-level security means the underlying
          rows are unreadable to anyone else in any case.
        </p>
      </div>
    );
  }

  const { data: daily } = await supabase
    .from('daily_spend')
    .select('*')
    .order('day', { ascending: false })
    .limit(14);
  // The ceiling, and whether it has stopped anything. A cap nobody can see the
  // state of is a cap nobody trusts.
  const { data: pauses } = await supabase
    .from('spend_pauses')
    .select('id, reason, observed_usd, ceiling_usd, paused_at, lifted_at, lift_reason')
    .order('paused_at', { ascending: false })
    .limit(5);

  const { data: perAssessment } = await supabase
    .from('assessment_cost')
    .select('*')
    .order('total_cost_usd', { ascending: false })
    .limit(20);

  const byDepth = new Map<string, { runs: number; total: number }>();
  for (const row of perAssessment ?? []) {
    const depth = String(row.depth);
    const current = byDepth.get(depth) ?? { runs: 0, total: 0 };
    byDepth.set(depth, {
      runs: current.runs + 1,
      total: current.total + Number(row.total_cost_usd ?? 0),
    });
  }

  const money = (value: number) => `$${value.toFixed(4)}`;
  const ceilings = pricing.ceilings.perRunCostUsd as Record<string, number>;
  const tierByDepth = new Map(pricing.tiers.map((tier) => [tier.depth, tier]));

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Unit economics</h1>
        <p className="text-muted">
          What each assessment costs us to produce, against what we charge for it. Prices come from
          config/pricing.json; nothing on the scoring path can read either.
        </p>
      </header>

      <section aria-labelledby="ceilings" className="space-y-4">
        <h2 id="ceilings" className="text-xl font-semibold">
          Ceilings
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Global daily spend', value: `$${CEILINGS.globalDailyUsd.toFixed(2)}` },
            {
              label: 'Free-tier weekly budget',
              value: `$${CEILINGS.freeTierWeeklyAlertUsd.toFixed(2)}`,
            },
            {
              label: 'Free tier, per account per month',
              value: `$${CEILINGS.freeTierPerAccountMonthlyUsd.toFixed(2)}`,
            },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-line p-5">
              <dt className="text-sm text-muted">{item.label}</dt>
              <dd className="mt-1 text-2xl font-bold tracking-tight">{item.value}</dd>
            </div>
          ))}
        </dl>
        {(pauses ?? []).some((pause) => !pause.lifted_at) ? (
          <div role="alert" className="rounded-xl border border-line-strong p-5">
            <h3 className="font-semibold text-bad">Assessment work is paused</h3>
            <p className="mt-2 text-sm">
              {String((pauses ?? []).find((pause) => !pause.lifted_at)?.reason)}
            </p>
            <p className="mt-2 text-sm text-muted">
              The worker claims nothing while a pause is live. Lifting one is deliberate and needs a
              written reason — see the runbook. The pause is a row, not process state, so restarting
              the worker does not clear it.
            </p>
          </div>
        ) : (
          <p className="rounded-xl border border-line bg-surface-muted p-5 text-sm text-muted">
            No pause is live. Work stops automatically at the daily ceiling and is only restarted by
            a person, because a cap that lifts itself is not a cap.
          </p>
        )}
        {(pauses ?? []).length > 0 && (
          <ul className="space-y-2 text-sm">
            {(pauses ?? []).map((pause) => (
              <li key={pause.id as string} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <span className="font-medium">
                    ${Number(pause.observed_usd).toFixed(2)} against $
                    {Number(pause.ceiling_usd).toFixed(2)}
                  </span>
                  <span className="text-muted">
                    {new Date(pause.paused_at as string).toUTCString()}
                    {pause.lifted_at ? ' · lifted' : ' · live'}
                  </span>
                </div>
                {pause.lift_reason && (
                  <p className="mt-1 text-muted">Lifted: {String(pause.lift_reason)}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="margin" className="space-y-4">
        <h2 id="margin" className="text-xl font-semibold">
          Cost per run, by depth
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              Average cost per assessment run against the price of the tier it serves
            </caption>
            <thead>
              <tr className="border-b border-line-strong">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Depth
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Runs
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Mean cost
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Per-run ceiling
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Tier price
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Gross margin
                </th>
              </tr>
            </thead>
            <tbody>
              {[...byDepth.entries()].map(([depth, stats]) => {
                const mean = stats.total / stats.runs;
                const tier = tierByDepth.get(depth);
                const price = tier?.priceUsd ?? null;
                const margin =
                  price === null ? null : price === 0 ? -mean : ((price - mean) / price) * 100;
                return (
                  <tr key={depth} className="border-b border-line">
                    <th scope="row" className="py-3 pr-4 font-medium">
                      {depth}
                    </th>
                    <td className="py-3 pr-4 tabular-nums">{stats.runs}</td>
                    <td className="py-3 pr-4 tabular-nums">{money(mean)}</td>
                    <td className="py-3 pr-4 tabular-nums">${(ceilings[depth] ?? 0).toFixed(2)}</td>
                    <td className="py-3 pr-4 tabular-nums">
                      {price === null ? 'quote' : `$${price}`}
                    </td>
                    <td className="py-3 tabular-nums">
                      {margin === null
                        ? '—'
                        : price === 0
                          ? `${money(mean)} per free run`
                          : `${margin.toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
              {byDepth.size === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-muted">
                    No runs have been costed yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="daily" className="space-y-4">
        <h2 id="daily" className="text-xl font-semibold">
          Daily spend
        </h2>
        <p className="text-sm text-muted">
          Global cap ${pricing.ceilings.globalDailySpendUsd} per day. Reaching it pauses new runs
          automatically rather than sending an alert nobody reads.
        </p>
        <ul className="space-y-2">
          {(daily ?? []).map((row) => {
            const total = Number(row.total_cost_usd ?? 0);
            const share = Math.min(100, (total / pricing.ceilings.globalDailySpendUsd) * 100);
            return (
              <li key={String(row.day)} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span>{new Date(String(row.day)).toISOString().slice(0, 10)}</span>
                  <span className="tabular-nums">
                    {money(total)} · {row.assessments} assessment
                    {Number(row.assessments) === 1 ? '' : 's'}
                  </span>
                </div>
                <div
                  className="mt-2 h-2 rounded bg-surface-muted"
                  role="img"
                  aria-label={`${share.toFixed(0)} per cent of the daily cap`}
                >
                  <div className="h-2 rounded bg-accent" style={{ width: `${share}%` }} />
                </div>
              </li>
            );
          })}
          {(daily ?? []).length === 0 && <li className="text-muted">Nothing spent yet.</li>}
        </ul>
      </section>

      <section aria-labelledby="expensive" className="space-y-4">
        <h2 id="expensive" className="text-xl font-semibold">
          Most expensive runs
        </h2>
        <ul className="space-y-2 text-sm">
          {(perAssessment ?? []).slice(0, 10).map((row) => (
            <li
              key={String(row.assessment_id)}
              className="flex justify-between gap-3 rounded-lg border border-line p-3"
            >
              <span className="truncate">
                {String(row.assessment_id).slice(0, 8)}… · {String(row.depth)}
              </span>
              <span className="tabular-nums">
                {money(Number(row.total_cost_usd ?? 0))} ·{' '}
                {Number(row.input_tokens ?? 0).toLocaleString()} in /{' '}
                {Number(row.output_tokens ?? 0).toLocaleString()} out
              </span>
            </li>
          ))}
          {(perAssessment ?? []).length === 0 && <li className="text-muted">No runs yet.</li>}
        </ul>
      </section>
    </div>
  );
}
