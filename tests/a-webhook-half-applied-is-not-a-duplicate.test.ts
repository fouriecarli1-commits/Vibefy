/**
 * The idempotency record must not outlive the work it guards.
 *
 * `applyBillingEvent` is three steps: insert the event into
 * `public.billing_events` with `on conflict (provider, provider_event_id) do
 * nothing returning id`, apply the change if that returned a row, then set
 * `handled = true`. The first step is the replay guard, and it is correct — a
 * provider that retries must not be charged, refunded or reinstated twice.
 *
 * `writeAsService` ran all three with no transaction.
 *
 * So a failure in step two or three left step one **committed**. The provider
 * retries, as every provider does; the insert hits `on conflict do nothing`,
 * returns no rows, and the function answers `duplicate: true, note: 'Already
 * processed.'` — and the route reports success to stop a retry storm, which is
 * the right thing to do with a genuine duplicate and the wrong thing to do with
 * this. **A customer pays, the subscription is never activated, and the guard
 * that exists to protect them is what makes it permanent.** Nothing surfaces it:
 * the row is left with `handled = false`, there is an index built for exactly
 * that query — `billing_events_unhandled_idx ... where not handled` — and no
 * code anywhere runs it.
 *
 * Two statements and no transaction is a pattern already on OPEN_ITEMS for the
 * review actions. It is worse here, because there the second statement failing
 * shows the reviewer an error; here the only party who finds out is the customer,
 * weeks later, wondering why they are on the free tier.
 *
 * Checked now because the database moved to a plan whose recommended connection
 * path for serverless functions is a transaction-mode pooler. Under one of those
 * there is not even accidental single-session consistency between the three
 * statements: each may land on a different backend. Every `set local role` and
 * `set_config(..., true)` in that file is already transaction-scoped, which is
 * what makes the pooler usable — `writeAsService` was the one path with no
 * transaction for them to be scoped to.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, PoolClient } from 'pg';
import { applyBillingEvent, interpretStripeEvent } from '../packages/billing/src/index.ts';
import { connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

// The console reads the database under the caller's own identity through this
// variable; the test database is the same shape.
process.env.SUPABASE_DB_URL = process.env.VIBEFYCODE_TEST_DSN;
// The throwaway cluster listens on a Unix socket and the DSN carries no user, so
// `pg` needs one from the environment the way tests/setup/client.ts gives it one.
process.env.PGUSER ??= 'postgres';
const { writeAsService } = await import('../apps/web/lib/sql.ts');

const stripe = { name: 'stripe' as const, interpret: interpretStripeEvent };

let db: Client;
let account: SeededAccount;

beforeAll(async () => {
  db = await connect();
  account = await seedAccount(db, 'half-applied-webhook');
});

afterAll(async () => {
  await db?.end();
});

function paymentEvent(eventId: string, invoiceId: string) {
  return {
    id: eventId,
    type: 'checkout.session.completed',
    createdAt: new Date(),
    data: {
      id: `cs_${invoiceId}`,
      mode: 'payment',
      invoice: invoiceId,
      amount_total: 7900,
      currency: 'usd',
      metadata: { organisationId: account.organisationId, plan: 'one_off' },
    },
  };
}

/** The same client, with one table's writes made to fail. */
function failingOn(client: PoolClient, table: string): PoolClient {
  return {
    async query(...args: unknown[]) {
      const sql = typeof args[0] === 'string' ? args[0] : '';
      if (sql.includes(table)) throw new Error(`deadlock detected on ${table}`);
      return (client.query as (...a: unknown[]) => Promise<unknown>)(...args);
    },
  } as unknown as PoolClient;
}

async function eventRows(eventId: string): Promise<{ handled: boolean }[]> {
  const { rows } = await db.query<{ handled: boolean }>(
    `select handled from public.billing_events
      where provider = 'stripe' and provider_event_id = $1`,
    [eventId],
  );
  return rows;
}

async function invoiceCount(invoiceId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from public.invoices where provider_invoice_id = $1`,
    [invoiceId],
  );
  return rows[0]?.n ?? 0;
}

describe('a webhook that fails halfway', () => {
  it('leaves no event record behind, so the provider’s retry is processed', async () => {
    const eventId = 'evt_half_applied';
    const invoiceId = 'in_half_applied';

    await expect(
      writeAsService((client) =>
        applyBillingEvent(
          failingOn(client, 'public.invoices'),
          stripe,
          paymentEvent(eventId, invoiceId),
        ),
      ),
    ).rejects.toThrow(/deadlock/);

    // The replay guard must not have survived the work it guards.
    expect(await eventRows(eventId)).toEqual([]);
    expect(await invoiceCount(invoiceId)).toBe(0);
  });

  it('and the retry actually applies, rather than being dismissed', async () => {
    // The consequence, stated as the customer experiences it: they paid, the
    // provider tried again, and this time the invoice exists.
    const eventId = 'evt_half_applied_retry';
    const invoiceId = 'in_half_applied_retry';

    await expect(
      writeAsService((client) =>
        applyBillingEvent(
          failingOn(client, 'public.invoices'),
          stripe,
          paymentEvent(eventId, invoiceId),
        ),
      ),
    ).rejects.toThrow(/deadlock/);

    const retry = await writeAsService((client) =>
      applyBillingEvent(client, stripe, paymentEvent(eventId, invoiceId)),
    );

    expect(retry.duplicate).toBe(false);
    expect(await invoiceCount(invoiceId)).toBe(1);
    expect((await eventRows(eventId))[0]?.handled).toBe(true);
  });
});

describe('a webhook that succeeds', () => {
  it('commits, because a transaction that never commits is an outage', async () => {
    // The direction the fix could fail in, and the one a rollback-everything
    // reader would produce: no money recorded at all, quietly, for every event.
    const eventId = 'evt_committed';
    const invoiceId = 'in_committed';

    const applied = await writeAsService((client) =>
      applyBillingEvent(client, stripe, paymentEvent(eventId, invoiceId)),
    );

    expect(applied.duplicate).toBe(false);
    expect(await invoiceCount(invoiceId)).toBe(1);
    expect((await eventRows(eventId))[0]?.handled).toBe(true);
  });

  it('still refuses a genuine replay', async () => {
    const eventId = 'evt_genuine_replay';
    const invoiceId = 'in_genuine_replay';

    const first = await writeAsService((client) =>
      applyBillingEvent(client, stripe, paymentEvent(eventId, invoiceId)),
    );
    const second = await writeAsService((client) =>
      applyBillingEvent(client, stripe, paymentEvent(eventId, invoiceId)),
    );

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(await invoiceCount(invoiceId)).toBe(1);
  });
});
