/**
 * `billing_events` is the record we would produce in a billing dispute.
 *
 * Its own migration says so, and says the rule: "Append-only, like the other
 * evidence tables", and above the trigger, "The one field this table is allowed
 * to change after insert, once, when the handler finishes. Everything else
 * about the event is immutable."
 *
 * Everything else was not immutable. The trigger compares four columns —
 * `provider_event_id`, `event_type`, `payload`, `occurred_at` — and says nothing
 * about the other three:
 *
 *   · **`provider`** is half of `unique (provider, provider_event_id)`, which is
 *     the idempotency guard this whole table exists to be. Changing it on an
 *     existing row frees that slot, and the same event can then be processed a
 *     second time — a replay through an `update` rather than an `insert`, past
 *     the constraint built to stop exactly that.
 *   · **`organisation_id`** decides whose dispute this evidence belongs to.
 *   · **`received_at`** is when we say we were told.
 *
 * Nothing in the product changes them today, and `authenticated` is granted
 * `select` only, so this is the last line rather than an open door: writes
 * arrive through `writeAsService`, which connects as the owner and passes every
 * policy, leaving the trigger as the only thing between the handler and the
 * record. That is precisely when "everything else is immutable" needs to be
 * true rather than intended.
 *
 * Found by measuring instead of reading. Disabling all twenty-six assertion
 * triggers and running the suite left `billing_events` the one append-only table
 * whose rule nothing noticed the loss of — and reading it to write the missing
 * test is what showed the rule was narrower than its comment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

let db: Client;
let account: SeededAccount;
let other: SeededAccount;

beforeAll(async () => {
  db = await connect();
  account = await seedAccount(db, 'billing-evidence');
  other = await seedAccount(db, 'billing-evidence-other');
});

afterAll(async () => {
  await db?.end();
});

let n = 0;
/** One recorded event, as the webhook handler writes it. */
async function anEvent(): Promise<string> {
  n += 1;
  const eventId = `evt_evidence_${n}_${Date.now().toString(36)}`;
  await db.query(
    `insert into public.billing_events
       (provider, provider_event_id, event_type, organisation_id, occurred_at, payload)
     values ('stripe', $1, 'checkout.session.completed', $2, now(), $3)`,
    [eventId, account.organisationId, JSON.stringify({ id: 'cs_evidence', amount_total: 7900 })],
  );
  return eventId;
}

const change = (column: string, value: unknown, eventId: string) =>
  db.query(`update public.billing_events set ${column} = $2 where provider_event_id = $1`, [
    eventId,
    value,
  ]);

describe('the event itself', () => {
  it('cannot be deleted', async () => {
    const eventId = await anEvent();
    await expect(
      db.query('delete from public.billing_events where provider_event_id = $1', [eventId]),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it('cannot have its payload rewritten', async () => {
    const eventId = await anEvent();
    await expect(
      change('payload', JSON.stringify({ id: 'cs_evidence', amount_total: 1 }), eventId),
    ).rejects.toThrow(/only the handled flag/i);
  });

  it('cannot have its type, its id or its time rewritten', async () => {
    const eventId = await anEvent();
    await expect(change('event_type', 'charge.refunded', eventId)).rejects.toThrow(
      /only the handled flag/i,
    );
    await expect(change('provider_event_id', 'evt_something_else', eventId)).rejects.toThrow(
      /only the handled flag/i,
    );
    await expect(change('occurred_at', new Date('2020-01-01'), eventId)).rejects.toThrow(
      /only the handled flag/i,
    );
  });
});

describe('the three columns the rule did not mention', () => {
  it('cannot have its provider changed, because that is half the replay guard', async () => {
    // `unique (provider, provider_event_id)` is what makes the handler
    // idempotent. Moving the row to another provider frees the slot and the same
    // event can be inserted and applied again.
    const eventId = await anEvent();
    await expect(change('provider', 'paystack', eventId)).rejects.toThrow(/only the handled flag/i);
  });

  it('cannot be moved to another workspace', async () => {
    const eventId = await anEvent();
    await expect(change('organisation_id', other.organisationId, eventId)).rejects.toThrow(
      /only the handled flag/i,
    );
  });

  it('cannot be backdated', async () => {
    const eventId = await anEvent();
    await expect(change('received_at', new Date('2020-01-01'), eventId)).rejects.toThrow(
      /only the handled flag/i,
    );
  });
});

describe('what the handler is allowed to do', () => {
  it('marks the event handled, with its note, in one update', async () => {
    // The direction this guard fails in silence: refusing the one update the
    // handler makes, so every webhook throws after applying its change.
    const eventId = await anEvent();
    await db.query(
      `update public.billing_events set handled = true, handler_note = $2
        where provider_event_id = $1`,
      [eventId, 'Subscription activated on plan agency.'],
    );

    const { rows } = await db.query<{ handled: boolean; handler_note: string }>(
      'select handled, handler_note from public.billing_events where provider_event_id = $1',
      [eventId],
    );
    expect(rows[0]?.handled).toBe(true);
    expect(rows[0]?.handler_note).toMatch(/agency/);
  });

  it('may set the note on its own, without touching anything else', async () => {
    const eventId = await anEvent();
    await db.query(
      `update public.billing_events set handler_note = $2 where provider_event_id = $1`,
      [eventId, 'Recorded; nothing applied.'],
    );
    const { rows } = await db.query<{ handler_note: string }>(
      'select handler_note from public.billing_events where provider_event_id = $1',
      [eventId],
    );
    expect(rows[0]?.handler_note).toMatch(/nothing applied/);
  });
});
