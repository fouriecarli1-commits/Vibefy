import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import pricing from '../../../../../config/pricing.json' with { type: 'json' };
import { entitlementFor, type PlanTier } from '@vibefy/billing';
import { startCheckout } from './actions';
import { ActionForm } from '@/components/action-form';
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

  return (
    <div className="max-w-3xl space-y-10">
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

      <section aria-labelledby="current" className="space-y-3">
        <h2 id="current" className="text-xl font-semibold">
          Current plan
        </h2>
        <div className="rounded-xl border border-line p-5">
          <p className="font-medium capitalize">{currentPlan.replace(/_/g, ' ')}</p>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            <li>Assessment depth: {entitlement.depth}</li>
            <li>
              Report:{' '}
              {entitlement.reportTier === 'paid'
                ? 'full, with evidence'
                : 'headline and top three findings'}
            </li>
            <li>PDF export: {entitlement.pdfExport ? 'yes' : 'no'}</li>
            <li>Badge eligible: {entitlement.badgeEligible ? 'yes' : 'no'}</li>
            <li>
              {entitlement.cooldownDays
                ? `One assessment per application every ${entitlement.cooldownDays} days`
                : 'No waiting period between assessments'}
            </li>
            {live?.current_period_end && (
              <li>Renews {new Date(String(live.current_period_end)).toUTCString()}</li>
            )}
          </ul>
        </div>
      </section>

      <section aria-labelledby="plans" className="space-y-4">
        <h2 id="plans" className="text-xl font-semibold">
          Plans
        </h2>
        <ul className="space-y-4">
          {pricing.tiers
            .filter((tier) => tier.id !== 'free')
            .map((tier) => (
              <li key={tier.id} className="rounded-xl border border-line p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-semibold">{tier.label}</h3>
                  <span className="tabular-nums">
                    {tier.priceUsd === null
                      ? 'By quote'
                      : `$${tier.priceUsd}${tier.billing === 'monthly' ? '/month' : ' once'}`}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted">{tier.contents}</p>
                {tier.priceUsd !== null && organisationId && (
                  <div className="mt-4">
                    <ActionForm action={startCheckout} submitLabel={`Choose ${tier.label}`}>
                      <input type="hidden" name="organisationId" value={organisationId} />
                      <input type="hidden" name="plan" value={tier.id} />
                      {app && <input type="hidden" name="appId" value={app} />}
                    </ActionForm>
                  </div>
                )}
              </li>
            ))}
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
