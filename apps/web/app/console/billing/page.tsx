import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import pricing from '../../../../../config/pricing.json' with { type: 'json' };
import {
  CAPABILITIES,
  PLAN_TIERS,
  entitlementFor,
  usageMeters,
  type PlanTier,
} from '@vibefycode/billing';
import { startCheckout } from './actions';
import { serviceDetailFor } from '@vibefycode/billing';
import { ActionForm } from '@/components/action-form';
import { Disclosure, ServiceDetailBody } from '@/components/disclosure';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Billing' };

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(cents / 100);

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ purchased?: string; cancelled?: string; app?: string }>;
}) {
  const { purchased, cancelled, app } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/console/billing');

  const { data: memberships } = await supabase
    .from('memberships')
    .select('organisation_id, role, organisations (name)');
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('organisation_id, plan, status, current_period_end');
  const { data: invoices } = await supabase
    .from('invoices')
    .select(
      'id, amount_paid_cents, amount_refunded_cents, amount_tax_cents, currency, status, issued_at, hosted_invoice_url, plan',
    )
    .order('issued_at', { ascending: false })
    .limit(20);

  const primary = memberships?.[0];
  const organisationId = primary?.organisation_id as string | undefined;
  const live = subscriptions?.find((row) => ['active', 'trialing'].includes(String(row.status)));
  const currentPlan = (live?.plan ?? 'free') as PlanTier;
  const entitlement = entitlementFor(currentPlan);

  // What has been used of it. Counted here rather than in `usageMeters` so that
  // reading rows and deciding what they mean stay two jobs.
  const { count: appCount } = await supabase
    .from('apps')
    .select('id', { count: 'exact', head: true });

  const paidInvoice = (invoices ?? []).find(
    (invoice) =>
      String(invoice.status) === 'paid' &&
      Number(invoice.amount_paid_cents ?? 0) > Number(invoice.amount_refunded_cents ?? 0),
  );
  const lastPaidAt = paidInvoice?.issued_at ? new Date(String(paidInvoice.issued_at)) : null;

  const { data: sincePaid } = lastPaidAt
    ? await supabase
        .from('assessments')
        .select('id, uses_retest_credit, created_at')
        .gt('created_at', lastPaidAt.toISOString())
    : { data: [] };

  const meters = usageMeters({
    plan: currentPlan,
    appsInWorkspace: appCount ?? 0,
    lastPaidAssessmentAt: lastPaidAt,
    reTestsUsed: (sincePaid ?? []).filter((row) => row.uses_retest_credit === true).length,
  });

  return (
    <div className="max-w-5xl space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted">
          Payment buys depth, evidence, re-testing and support. It never buys a score, the
          suppression of a finding, or a delay to a badge suspension — see the{' '}
          <Link href="/legal/rating-methodology-and-independence">independence policy</Link>.
        </p>
      </header>

      {purchased && (
        <p role="status" className="rounded-xl border border-line bg-surface-muted p-4 text-ok">
          Payment received. Your plan updates as soon as the provider confirms it, usually within
          seconds.
        </p>
      )}
      {cancelled && (
        <p role="status" className="rounded-xl border border-line bg-surface-muted p-4 text-muted">
          Checkout cancelled. Nothing was charged.
        </p>
      )}

      <section aria-labelledby="current" className="space-y-4">
        <h2 id="current" className="text-xl font-semibold">
          Your plan
        </h2>

        <div className="rounded-xl border border-line-strong p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-2xl font-bold capitalize tracking-tight">
              {currentPlan.replace(/_/g, ' ')}
            </p>
            <span className="chip" data-tone={live ? 'ok' : undefined}>
              {live ? String(live.status) : 'no subscription'}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted">
            {live?.current_period_end
              ? `Renews ${new Date(String(live.current_period_end)).toISOString().slice(0, 10)}.`
              : 'Nothing renews — the free tier applies until something is bought.'}
          </p>
        </div>

        {/* What is left, not only what was bought. An allowance you cannot see
            is one you find out about by being refused. */}
        <div className="grid gap-4 sm:grid-cols-2">
          {meters.map((meter) => {
            const proportion =
              meter.limit === null
                ? 0
                : Math.min(1, meter.limit === 0 ? 1 : meter.used / meter.limit);
            const spent = meter.limit !== null && meter.used >= meter.limit;
            return (
              <div key={meter.label} className="rounded-xl border border-line p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-medium">{meter.label}</h3>
                  <p className="text-sm tabular-nums" data-numeric>
                    {meter.limit === null
                      ? `${meter.used} · no limit`
                      : `${meter.used} of ${meter.limit}`}
                  </p>
                </div>
                {meter.limit !== null && (
                  /* A meter, not a chart: the number above is the fact and this
                     only makes it glanceable. `aria-hidden` because a progress
                     bar that repeats the sentence beside it is noise to a screen
                     reader. */
                  <div
                    aria-hidden="true"
                    className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted"
                  >
                    <div
                      className={`h-full rounded-full ${spent ? 'bg-bad' : 'bg-accent'}`}
                      style={{ width: `${Math.round(proportion * 100)}%` }}
                    />
                  </div>
                )}
                <p className="mt-2 text-sm text-muted">{meter.detail}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="compare" className="space-y-4">
        <h2 id="compare" className="text-xl font-semibold">
          What each plan gives you
        </h2>
        <p className="max-w-2xl text-sm text-muted">
          Your plan is marked. Every row is read from the same table the engine enforces, so nothing
          here can promise something the assessment will not do.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              What each plan includes, with your current plan marked
            </caption>
            <thead>
              <tr className="border-b border-line-strong">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  &nbsp;
                </th>
                {PLAN_TIERS.map((plan) => (
                  <th key={plan} scope="col" className="py-2 pr-4 font-semibold capitalize">
                    {plan.replace(/_/g, ' ')}
                    {plan === currentPlan && (
                      <span className="ml-2 chip" data-tone="ok">
                        yours
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((capability) => (
                <tr key={capability.label} className="border-b border-line">
                  <th scope="row" className="py-3 pr-4 font-medium">
                    {capability.label}
                  </th>
                  {PLAN_TIERS.map((plan) => (
                    <td
                      key={plan}
                      className={`py-3 pr-4 ${plan === currentPlan ? 'font-medium' : 'text-muted'}`}
                    >
                      {capability.describe(entitlementFor(plan))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="plans" className="space-y-4">
        <h2 id="plans" className="text-xl font-semibold">
          Plans
        </h2>
        <p className="max-w-2xl text-sm text-muted">
          Every plan opens to the whole story: what happens after you pay, how long each step takes,
          what is <em>not</em> included, and how to stop. Read that before the price.
        </p>
        <ul className="space-y-4">
          {pricing.tiers
            .filter((tier) => tier.id !== 'free')
            .map((tier) => {
              const detail = serviceDetailFor(tier.id);
              return (
                <li key={tier.id} className="panel space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h3 className="font-semibold">{tier.label}</h3>
                    <span className="chip" data-numeric>
                      {tier.priceUsd === null
                        ? 'By quote'
                        : `$${tier.priceUsd}${tier.billing === 'monthly' ? ' / month' : ' once'}`}
                    </span>
                  </div>
                  <p className="text-sm text-muted">{tier.contents}</p>

                  {detail && (
                    <Disclosure
                      summary={`What ${tier.label} actually includes`}
                      hint="Step by step, with what is not included and how to cancel"
                    >
                      <ServiceDetailBody detail={detail} />
                    </Disclosure>
                  )}

                  {tier.priceUsd !== null && organisationId && (
                    <ActionForm action={startCheckout} submitLabel={`Choose ${tier.label}`}>
                      <input type="hidden" name="organisationId" value={organisationId} />
                      <input type="hidden" name="plan" value={tier.id} />
                      {app && <input type="hidden" name="appId" value={app} />}
                    </ActionForm>
                  )}
                </li>
              );
            })}
        </ul>
      </section>

      <section aria-labelledby="invoices" className="space-y-3">
        <h2 id="invoices" className="text-xl font-semibold">
          Invoices
        </h2>
        {invoices && invoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
              <caption className="sr-only">Your invoices</caption>
              <thead>
                <tr className="border-b border-line-strong">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Date
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Plan
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Paid
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Tax
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const currency = String(invoice.currency ?? 'USD');
                  const refunded = Number(invoice.amount_refunded_cents ?? 0);
                  return (
                    <tr key={invoice.id as string} className="border-b border-line">
                      <td className="py-3 pr-4">
                        {invoice.issued_at
                          ? new Date(String(invoice.issued_at)).toISOString().slice(0, 10)
                          : '—'}
                      </td>
                      <td className="py-3 pr-4 capitalize">
                        {String(invoice.plan ?? '—').replace(/_/g, ' ')}
                      </td>
                      <td className="py-3 pr-4 tabular-nums">
                        {money(Number(invoice.amount_paid_cents ?? 0), currency)}
                        {refunded > 0 && (
                          <span className="text-muted">
                            {' '}
                            · {money(refunded, currency)} refunded
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 tabular-nums">
                        {money(Number(invoice.amount_tax_cents ?? 0), currency)}
                      </td>
                      <td className="py-3 pr-4">{String(invoice.status)}</td>
                      <td className="py-3">
                        {invoice.hosted_invoice_url ? (
                          <a
                            href={String(invoice.hosted_invoice_url)}
                            rel="noopener"
                            target="_blank"
                          >
                            Receipt
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl border border-line bg-surface-muted p-5 text-sm text-muted">
            Nothing billed yet.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface-muted p-5 text-sm text-muted">
        <h2 className="font-semibold text-ink">Refunds</h2>
        <p className="mt-2">
          Cancel before an assessment starts and it is refunded in full. If an assessment fails for
          our reasons, it is refunded in full. A completed assessment whose score you dislike is not
          refunded — the score is the product, and a refund for an unwelcome result would make every
          other score worth less. A wrong finding is corrected free of charge under the{' '}
          <Link href="/legal/appeals-and-corrections">appeals policy</Link>.
        </p>
        <p className="mt-2">
          Full terms:{' '}
          <Link href="/legal/refund-and-cancellation">Refund &amp; Cancellation Policy</Link>.
        </p>
      </section>
    </div>
  );
}
