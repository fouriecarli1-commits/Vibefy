/**
 * Applying a verified provider event to our own records.
 *
 * Three rules shape everything here:
 *
 *   1. **Record first, act second.** Every event is written to `billing_events`
 *      before anything else changes. The unique constraint on the provider's
 *      event id is what makes the handler idempotent — not a flag we remember to
 *      check, and not the provider promising to deliver once.
 *
 *   2. **Mirror, never originate.** The provider is the source of truth for what
 *      was charged. We copy identifiers and amounts so a customer can see their
 *      own history without a round trip; we never compute a balance ourselves.
 *
 *   3. **One vocabulary.** This file reads a `BillingChange` and cannot tell
 *      which provider produced it. Each provider translates its own payloads —
 *      the alternative, once there were two, was a second copy of this file that
 *      drifts from the first.
 */
import type {
  BillingChange,
  BillingEvent,
  InvoiceSettled,
  PaymentProvider,
  PaymentSettled,
  RefundSettled,
  SubscriptionChanged,
} from './provider.ts';

/** The smallest database surface this needs. `pg.PoolClient` satisfies it. */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface AppliedEvent {
  readonly eventId: string;
  readonly type: string;
  readonly duplicate: boolean;
  readonly note: string;
}

/**
 * The provider, as this function needs it: something that can say what one of
 * its own events means. Narrower than `PaymentProvider` so a test can supply a
 * translation without also supplying a checkout API.
 */
export type EventInterpreter = Pick<PaymentProvider, 'name' | 'interpret'>;

export async function applyBillingEvent(
  sql: SqlExecutor,
  provider: EventInterpreter,
  event: BillingEvent,
): Promise<AppliedEvent> {
  const change = provider.interpret(event);
  const organisationId = organisationOf(change);

  const recorded = await sql.query<{ id: string }>(
    `insert into public.billing_events
       (provider, provider_event_id, event_type, organisation_id, occurred_at, payload)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (provider, provider_event_id) do nothing
     returning id`,
    [
      provider.name,
      event.id,
      event.type,
      organisationId,
      event.createdAt.toISOString(),
      // What the provider told us, unedited. The interpretation above is ours
      // and is not evidence of anything in a dispute.
      JSON.stringify(event.data),
    ],
  );

  if (recorded.rows.length === 0) {
    return { eventId: event.id, type: event.type, duplicate: true, note: 'Already processed.' };
  }

  let note: string;
  switch (change.kind) {
    case 'payment_settled':
      note = await onPaymentSettled(sql, provider.name, change);
      break;
    case 'subscription_changed':
      note = await onSubscriptionChanged(sql, provider.name, change);
      break;
    case 'invoice_settled':
      note = await onInvoiceSettled(sql, provider.name, change);
      break;
    case 'refund_settled':
      note = await onRefundSettled(sql, provider.name, change);
      break;
    case 'ignored':
      note = `Recorded; ${change.why}`;
      break;
  }

  await sql.query(
    `update public.billing_events set handled = true, handler_note = $3
      where provider = $1 and provider_event_id = $2`,
    [provider.name, event.id, note],
  );

  return { eventId: event.id, type: event.type, duplicate: false, note };
}

function organisationOf(change: BillingChange): string | null {
  return 'organisationId' in change ? change.organisationId : null;
}

async function onPaymentSettled(
  sql: SqlExecutor,
  provider: string,
  change: PaymentSettled,
): Promise<string> {
  if (!change.organisationId)
    return 'Payment settled without an organisation in metadata; nothing applied.';

  if (change.recurring && change.subscriptionId) {
    await sql.query(
      `insert into public.subscriptions
         (organisation_id, plan, status, provider, provider_customer_id, provider_subscription_id)
       values ($1, $2, 'active', $3::text::public.payment_provider, $4, $5)
       on conflict (provider, provider_subscription_id) do update
         set plan = excluded.plan, status = 'active',
             provider_customer_id = excluded.provider_customer_id`,
      [change.organisationId, change.plan, provider, change.customerId, change.subscriptionId],
    );
    return `Subscription ${change.subscriptionId} activated on plan ${change.plan}.`;
  }

  await sql.query(
    `insert into public.invoices
       (organisation_id, provider, provider_invoice_id, provider_payment_reference,
        amount_due_cents, amount_paid_cents, amount_tax_cents, currency, status,
        tax_country, app_id, plan, issued_at, paid_at)
     values ($1, $2::text::public.payment_provider, $3, $4, $5, $5, $6, $7, 'paid',
             $8, $9, $10, now(), now())
     on conflict (provider, provider_invoice_id) do update
       set amount_paid_cents = excluded.amount_paid_cents, status = 'paid', paid_at = now()`,
    [
      change.organisationId,
      provider,
      change.invoiceId,
      change.paymentReference,
      change.amountTotalCents,
      change.amountTaxCents,
      change.currency,
      change.billingCountry,
      change.appId,
      change.plan,
    ],
  );
  return `One-off payment of ${change.amountTotalCents} ${change.currency} recorded for plan ${change.plan}.`;
}

async function onSubscriptionChanged(
  sql: SqlExecutor,
  provider: string,
  change: SubscriptionChanged,
): Promise<string> {
  const updated = await sql.query(
    // $3 is bound as text and cast, so Postgres does not have to deduce one type
    // for a parameter used both as an enum value and in a string comparison.
    `update public.subscriptions
        set status = $3::text::public.subscription_status,
            current_period_start = coalesce($4::timestamptz, current_period_start),
            current_period_end = coalesce($5::timestamptz, current_period_end),
            cancelled_at = case when $3::text = 'cancelled' then now() else cancelled_at end
      where provider = $1::text::public.payment_provider and provider_subscription_id = $2
      returning id`,
    [provider, change.subscriptionId, change.status, change.periodStart, change.periodEnd],
  );

  if (updated.rows.length === 0 && change.organisationId) {
    await sql.query(
      `insert into public.subscriptions
         (organisation_id, plan, status, provider, provider_customer_id, provider_subscription_id,
          current_period_start, current_period_end)
       values ($1, $2, $3, $4::text::public.payment_provider, $5, $6, $7, $8)
       on conflict (provider, provider_subscription_id) do nothing`,
      [
        change.organisationId,
        change.plan ?? 'certified',
        change.status,
        provider,
        change.customerId,
        change.subscriptionId,
        change.periodStart,
        change.periodEnd,
      ],
    );
    return `Subscription ${change.subscriptionId} created from a provider event, status ${change.status}.`;
  }

  return `Subscription ${change.subscriptionId} is now ${change.status}.`;
}

async function onInvoiceSettled(
  sql: SqlExecutor,
  provider: string,
  change: InvoiceSettled,
): Promise<string> {
  const status = change.paid ? 'paid' : 'open';

  const updated = await sql.query(
    `update public.invoices
        set amount_due_cents = $3, amount_paid_cents = $4, amount_tax_cents = $5,
            status = $6::text::public.invoice_status,
            hosted_invoice_url = coalesce($7, hosted_invoice_url),
            paid_at = case when $6::text = 'paid' then now() else paid_at end
      where provider = $1::text::public.payment_provider and provider_invoice_id = $2
      returning id`,
    [
      provider,
      change.invoiceId,
      change.amountDueCents,
      change.amountPaidCents,
      change.amountTaxCents,
      status,
      change.hostedInvoiceUrl,
    ],
  );

  if (updated.rows.length === 0 && change.organisationId) {
    await sql.query(
      `insert into public.invoices
         (organisation_id, provider, provider_invoice_id, amount_due_cents, amount_paid_cents,
          amount_tax_cents, currency, status, hosted_invoice_url, issued_at, paid_at)
       values ($1, $2::text::public.payment_provider, $3, $4, $5, $6, $7,
               $8::text::public.invoice_status, $9, now(),
               case when $8::text = 'paid' then now() else null end)
       on conflict (provider, provider_invoice_id) do nothing`,
      [
        change.organisationId,
        provider,
        change.invoiceId,
        change.amountDueCents,
        change.amountPaidCents,
        change.amountTaxCents,
        change.currency,
        status,
        change.hostedInvoiceUrl,
      ],
    );
  }

  return `Invoice ${change.invoiceId} is ${change.paid ? 'paid' : 'unpaid'}.`;
}

async function onRefundSettled(
  sql: SqlExecutor,
  provider: string,
  change: RefundSettled,
): Promise<string> {
  // Clamped to what was actually paid, and the database refuses anything larger
  // in any case. A refund bigger than the payment is a bug, not a gesture.
  const updated = await sql.query<{ id: string }>(
    `update public.invoices
        set amount_refunded_cents = least($3, amount_paid_cents),
            status = case when least($3, amount_paid_cents) >= amount_paid_cents
                          then 'refunded' else status end
      where provider = $1::text::public.payment_provider and provider_payment_reference = $2
      returning id`,
    [provider, change.paymentReference, change.amountRefundedCents],
  );

  return updated.rows.length > 0
    ? `Refund of ${change.amountRefundedCents} recorded against payment ${change.paymentReference}.`
    : `No invoice found for payment ${change.paymentReference}; refund recorded as an event only.`;
}
