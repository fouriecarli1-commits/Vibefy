/**
 * Applying a verified provider event to our own records.
 *
 * Two rules shape everything here:
 *
 *   1. **Record first, act second.** Every event is written to `billing_events`
 *      before anything else changes. The unique constraint on the provider's
 *      event id is what makes the handler idempotent — not a flag we remember to
 *      check, and not the provider promising to deliver once.
 *
 *   2. **Mirror, never originate.** Stripe is the source of truth for what was
 *      charged. We copy identifiers and amounts so a customer can see their own
 *      history without a round trip; we never compute a balance ourselves.
 */
import type { BillingEvent } from './provider.ts';

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

const SUBSCRIPTION_STATUS: Readonly<Record<string, string>> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  paused: 'paused',
  canceled: 'cancelled',
  incomplete: 'incomplete',
  incomplete_expired: 'incomplete',
  unpaid: 'past_due',
};

export async function applyBillingEvent(
  sql: SqlExecutor,
  event: BillingEvent,
  provider = 'stripe',
): Promise<AppliedEvent> {
  const organisationId = organisationFrom(event);

  const recorded = await sql.query<{ id: string }>(
    `insert into public.billing_events
       (provider, provider_event_id, event_type, organisation_id, occurred_at, payload)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (provider, provider_event_id) do nothing
     returning id`,
    [
      provider,
      event.id,
      event.type,
      organisationId,
      event.createdAt.toISOString(),
      JSON.stringify(event.data),
    ],
  );

  if (recorded.rows.length === 0) {
    return { eventId: event.id, type: event.type, duplicate: true, note: 'Already processed.' };
  }

  let note: string;
  switch (event.type) {
    case 'checkout.session.completed':
      note = await onCheckoutCompleted(sql, event, organisationId);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      note = await onSubscriptionChanged(sql, event, organisationId);
      break;
    case 'invoice.paid':
    case 'invoice.payment_failed':
      note = await onInvoice(sql, event, organisationId);
      break;
    case 'charge.refunded':
      note = await onRefund(sql, event);
      break;
    default:
      note = 'Recorded; no handler for this event type.';
  }

  await sql.query(
    `update public.billing_events set handled = true, handler_note = $2 where provider_event_id = $1`,
    [event.id, note],
  );

  return { eventId: event.id, type: event.type, duplicate: false, note };
}

function organisationFrom(event: BillingEvent): string | null {
  const metadata = (event.data.metadata ?? {}) as Record<string, string>;
  return metadata.organisationId ?? null;
}

async function onCheckoutCompleted(
  sql: SqlExecutor,
  event: BillingEvent,
  organisationId: string | null,
): Promise<string> {
  if (!organisationId)
    return 'Checkout completed without an organisation in metadata; nothing applied.';

  const metadata = (event.data.metadata ?? {}) as Record<string, string>;
  const plan = metadata.plan ?? 'one_off';
  const mode = String(event.data.mode ?? 'payment');
  const customerId = stringOrNull(event.data.customer);
  const subscriptionId = stringOrNull(event.data.subscription);
  const amountTotal = Number(event.data.amount_total ?? 0);
  const tax = Number(
    (event.data as { total_details?: { amount_tax?: number } }).total_details?.amount_tax ?? 0,
  );
  const currency = String(event.data.currency ?? 'usd').toUpperCase();
  const country =
    (event.data as { customer_details?: { address?: { country?: string } } }).customer_details
      ?.address?.country ?? null;

  if (mode === 'subscription' && subscriptionId) {
    await sql.query(
      `insert into public.subscriptions (organisation_id, plan, status, stripe_customer_id, stripe_subscription_id)
       values ($1, $2, 'active', $3, $4)
       on conflict (stripe_subscription_id) do update
         set plan = excluded.plan, status = 'active', stripe_customer_id = excluded.stripe_customer_id`,
      [organisationId, plan, customerId, subscriptionId],
    );
    return `Subscription ${subscriptionId} activated on plan ${plan}.`;
  }

  await sql.query(
    `insert into public.invoices
       (organisation_id, stripe_invoice_id, stripe_payment_intent_id, amount_due_cents, amount_paid_cents,
        amount_tax_cents, currency, status, tax_country, app_id, plan, issued_at, paid_at)
     values ($1, $2, $3, $4, $4, $5, $6, 'paid', $7, $8, $9, now(), now())
     on conflict (stripe_invoice_id) do update
       set amount_paid_cents = excluded.amount_paid_cents, status = 'paid', paid_at = now()`,
    [
      organisationId,
      stringOrNull(event.data.invoice) ?? `session_${event.data.id}`,
      stringOrNull(event.data.payment_intent),
      amountTotal,
      tax,
      currency,
      country,
      metadata.appId ?? null,
      plan,
    ],
  );
  return `One-off payment of ${amountTotal} ${currency} recorded for plan ${plan}.`;
}

async function onSubscriptionChanged(
  sql: SqlExecutor,
  event: BillingEvent,
  organisationId: string | null,
): Promise<string> {
  const subscriptionId = String(event.data.id ?? '');
  if (!subscriptionId) return 'Subscription event with no id; nothing applied.';

  const status =
    event.type === 'customer.subscription.deleted'
      ? 'cancelled'
      : (SUBSCRIPTION_STATUS[String(event.data.status ?? '')] ?? 'incomplete');

  const periodStart = unixOrNull(event.data.current_period_start);
  const periodEnd = unixOrNull(event.data.current_period_end);

  const updated = await sql.query(
    // $2 is bound as text and cast, so Postgres does not have to deduce one type
    // for a parameter used both as an enum value and in a string comparison.
    `update public.subscriptions
        set status = $2::text::public.subscription_status,
            current_period_start = coalesce($3::timestamptz, current_period_start),
            current_period_end = coalesce($4::timestamptz, current_period_end),
            cancelled_at = case when $2::text = 'cancelled' then now() else cancelled_at end
      where stripe_subscription_id = $1
      returning id`,
    [subscriptionId, status, periodStart, periodEnd],
  );

  if (updated.rows.length === 0 && organisationId) {
    await sql.query(
      `insert into public.subscriptions (organisation_id, plan, status, stripe_customer_id, stripe_subscription_id,
                                         current_period_start, current_period_end)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (stripe_subscription_id) do nothing`,
      [
        organisationId,
        ((event.data.metadata ?? {}) as Record<string, string>).plan ?? 'certified',
        status,
        stringOrNull(event.data.customer),
        subscriptionId,
        periodStart,
        periodEnd,
      ],
    );
    return `Subscription ${subscriptionId} created from a ${event.type} event, status ${status}.`;
  }

  return `Subscription ${subscriptionId} is now ${status}.`;
}

async function onInvoice(
  sql: SqlExecutor,
  event: BillingEvent,
  organisationId: string | null,
): Promise<string> {
  const invoiceId = String(event.data.id ?? '');
  if (!invoiceId) return 'Invoice event with no id; nothing applied.';

  const paid = event.type === 'invoice.paid';
  const amountDue = Number(event.data.amount_due ?? 0);
  const amountPaid = Number(event.data.amount_paid ?? 0);
  const tax = Number(event.data.tax ?? 0);
  const currency = String(event.data.currency ?? 'usd').toUpperCase();

  const updated = await sql.query(
    `update public.invoices
        set amount_due_cents = $2, amount_paid_cents = $3, amount_tax_cents = $4,
            status = $5::text::public.invoice_status,
            hosted_invoice_url = coalesce($6, hosted_invoice_url),
            paid_at = case when $5::text = 'paid' then now() else paid_at end
      where stripe_invoice_id = $1
      returning id`,
    [
      invoiceId,
      amountDue,
      amountPaid,
      tax,
      paid ? 'paid' : 'open',
      stringOrNull(event.data.hosted_invoice_url),
    ],
  );

  if (updated.rows.length === 0 && organisationId) {
    await sql.query(
      `insert into public.invoices
         (organisation_id, stripe_invoice_id, amount_due_cents, amount_paid_cents, amount_tax_cents,
          currency, status, hosted_invoice_url, issued_at, paid_at)
       values ($1, $2, $3, $4, $5, $6, $7::text::public.invoice_status, $8, now(),
               case when $7::text = 'paid' then now() else null end)
       on conflict (stripe_invoice_id) do nothing`,
      [
        organisationId,
        invoiceId,
        amountDue,
        amountPaid,
        tax,
        currency,
        paid ? 'paid' : 'open',
        stringOrNull(event.data.hosted_invoice_url),
      ],
    );
  }

  return `Invoice ${invoiceId} is ${paid ? 'paid' : 'unpaid'}.`;
}

async function onRefund(sql: SqlExecutor, event: BillingEvent): Promise<string> {
  const paymentIntent = stringOrNull(event.data.payment_intent);
  const refunded = Number(event.data.amount_refunded ?? 0);
  if (!paymentIntent) return 'Refund event with no payment reference; nothing applied.';

  // Clamped to what was actually paid, and the database refuses anything larger
  // in any case. A refund bigger than the payment is a bug, not a gesture.
  const updated = await sql.query<{ id: string }>(
    `update public.invoices
        set amount_refunded_cents = least($2, amount_paid_cents),
            status = case when least($2, amount_paid_cents) >= amount_paid_cents then 'refunded' else status end
      where stripe_payment_intent_id = $1
      returning id`,
    [paymentIntent, refunded],
  );

  return updated.rows.length > 0
    ? `Refund of ${refunded} recorded against payment ${paymentIntent}.`
    : `No invoice found for payment ${paymentIntent}; refund recorded as an event only.`;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && 'id' in value)
    return String((value as { id: string }).id);
  return null;
}

function unixOrNull(value: unknown): string | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}
