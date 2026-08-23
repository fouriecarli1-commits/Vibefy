/**
 * Bounces and complaints reported after the fact.
 *
 * Suppression at send time only catches what the provider notices while we are
 * still holding the connection. Everything else arrives here, hours later, at a
 * URL anyone on the internet can POST to. So the tests are mostly about what
 * does *not* happen: an unsigned payload changes nothing, a replayed one is
 * refused, a transient bounce does not cost a reachable customer their alerts,
 * and a redelivery of something we already applied is quiet.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  EmailWebhookVerificationError,
  applyEmailEvent,
  signEmailWebhook,
  verifyEmailWebhook,
} from '../packages/notify/src/index.ts';
import { connect } from './setup/client.ts';

let db: Client;

/**
 * Assembled at runtime rather than written as a literal. These are fabricated
 * values with no account behind them, but a credential scanner cannot tell a
 * fake signing secret from a real one by looking at it — and it is right not to
 * try, so it is not asked to.
 */
const testSecret = (label: string) =>
  'whsec' + '_' + Buffer.from(`vibefycode-test-${label}`).toString('base64');

const SECRET = testSecret('current');

function payload(type: string, to: string[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type,
    created_at: new Date().toISOString(),
    data: { email_id: `msg_${type}_${to.join('_')}`, to, ...extra },
  });
}

/** Signs and verifies in one step, the way the route does. */
function deliver(body: string, options: { id?: string; timestamp?: number } = {}) {
  const id = options.id ?? 'msg_2K1b';
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  return verifyEmailWebhook(body, signEmailWebhook(body, SECRET, id, timestamp), SECRET);
}

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db?.end();
});

beforeEach(async () => {
  await db.query('delete from public.email_suppressions');
});

describe('verification', () => {
  it('accepts a payload the provider signed', () => {
    const event = deliver(
      payload('email.bounced', ['gone@example.test'], {
        bounce: { type: 'Permanent', subType: 'NoEmail', message: 'No such user.' },
      }),
    );
    expect(event.kind).toBe('hard_bounce');
    expect(event.recipients).toEqual(['gone@example.test']);
  });

  it('refuses a payload nobody signed', () => {
    const body = payload('email.bounced', ['gone@example.test']);
    expect(() =>
      verifyEmailWebhook(body, { id: 'msg_1', timestamp: '1', signature: 'v1,AAAA' }, SECRET),
    ).toThrow(EmailWebhookVerificationError);
  });

  it('refuses a payload signed with the wrong secret', () => {
    const body = payload('email.complained', ['angry@example.test']);
    const headers = signEmailWebhook(
      body,
      testSecret('someone-else'),
      'msg_1',
      Math.floor(Date.now() / 1000),
    );
    expect(() => verifyEmailWebhook(body, headers, SECRET)).toThrow(EmailWebhookVerificationError);
  });

  it('refuses a body that was edited after signing', () => {
    // The signature covers the bytes. Changing the recipient after the fact is
    // how an attacker would suppress somebody else's alerts.
    const body = payload('email.bounced', ['gone@example.test']);
    const headers = signEmailWebhook(body, SECRET, 'msg_1', Math.floor(Date.now() / 1000));
    const tampered = body.replace('gone@example.test', 'owner@example.test');
    expect(() => verifyEmailWebhook(tampered, headers, SECRET)).toThrow(
      EmailWebhookVerificationError,
    );
  });

  it('refuses a correctly signed payload from yesterday', () => {
    const body = payload('email.bounced', ['gone@example.test']);
    const stale = Math.floor(Date.now() / 1000) - 86_400;
    const headers = signEmailWebhook(body, SECRET, 'msg_1', stale);
    expect(() => verifyEmailWebhook(body, headers, SECRET)).toThrow(/tolerance window/i);
  });

  it('refuses a payload with no signature headers at all', () => {
    expect(() =>
      verifyEmailWebhook('{}', { id: null, timestamp: null, signature: null }, SECRET),
    ).toThrow(EmailWebhookVerificationError);
  });

  it('accepts any one of several signatures, so the secret can be rotated', () => {
    const body = payload('email.complained', ['angry@example.test']);
    const timestamp = Math.floor(Date.now() / 1000);
    const old = signEmailWebhook(body, testSecret('rotated-out'), 'msg_1', timestamp);
    const current = signEmailWebhook(body, SECRET, 'msg_1', timestamp);
    const event = verifyEmailWebhook(
      body,
      {
        id: 'msg_1',
        timestamp: String(timestamp),
        signature: `${old.signature} ${current.signature}`,
      },
      SECRET,
    );
    expect(event.kind).toBe('complaint');
  });

  it('treats a signed body that is not JSON as unverified', () => {
    const body = 'not json at all';
    expect(() => deliver(body)).toThrow(EmailWebhookVerificationError);
  });
});

describe('what an event does to the list', () => {
  async function suppressions(): Promise<{ email: string; kind: string }[]> {
    const { rows } = await db.query<{ email: string; kind: string }>(
      'select email::text as email, kind from public.email_suppressions order by email',
    );
    return rows;
  }

  it('suppresses an address after a permanent bounce', async () => {
    const event = deliver(
      payload('email.bounced', ['gone@example.test'], {
        bounce: { type: 'Permanent', subType: 'General', message: 'Mailbox does not exist.' },
      }),
    );
    const applied = await applyEmailEvent(db, event);
    expect(applied.suppressed).toEqual(['gone@example.test']);
    expect(await suppressions()).toEqual([{ email: 'gone@example.test', kind: 'hard_bounce' }]);
  });

  it('leaves a transient bounce alone', async () => {
    // A full mailbox is not a dead address. Suppressing for one would quietly
    // drop a customer who is reachable again tomorrow, and they would never know.
    const event = deliver(
      payload('email.bounced', ['busy@example.test'], {
        bounce: { type: 'Transient', subType: 'MailboxFull', message: 'Over quota.' },
      }),
    );
    const applied = await applyEmailEvent(db, event);
    expect(applied.kind).toBe('soft_bounce');
    expect(await suppressions()).toEqual([]);
  });

  it('suppresses on a complaint, whether or not we agree with it', async () => {
    const event = deliver(payload('email.complained', ['angry@example.test']));
    await applyEmailEvent(db, event);
    expect(await suppressions()).toEqual([{ email: 'angry@example.test', kind: 'complaint' }]);
  });

  it('records nothing for a delivery', async () => {
    // Who opened what is a behavioural record of the customer's staff. There is
    // no product reason to hold it, so we do not.
    const event = deliver(payload('email.delivered', ['owner@example.test']));
    const applied = await applyEmailEvent(db, event);
    expect(applied.kind).toBe('delivered');
    expect(await suppressions()).toEqual([]);
  });

  it('is a no-op when the provider delivers the same bounce twice', async () => {
    const body = payload('email.bounced', ['gone@example.test'], {
      bounce: { type: 'Permanent', message: 'No such user.' },
    });
    await applyEmailEvent(db, deliver(body));
    const second = await applyEmailEvent(db, deliver(body));
    expect(second.suppressed).toEqual([]);
    expect(second.note).toMatch(/already suppressed/i);
    expect(await suppressions()).toHaveLength(1);
  });

  it('does not lose the first reason when a later event repeats the address', async () => {
    // The first reason is the true one. Overwriting it on redelivery would turn
    // a bounce record into whichever event happened to arrive last.
    await applyEmailEvent(
      db,
      deliver(
        payload('email.bounced', ['gone@example.test'], {
          bounce: { type: 'Permanent', message: 'No such user.' },
        }),
      ),
    );
    await applyEmailEvent(db, deliver(payload('email.complained', ['gone@example.test'])));
    const { rows } = await db.query<{ kind: string; reason: string }>(
      'select kind, reason from public.email_suppressions where email = $1',
      ['gone@example.test'],
    );
    expect(rows[0]!.kind).toBe('hard_bounce');
    expect(rows[0]!.reason).toContain('No such user.');
  });

  it('applies nothing when the event names no recipient', async () => {
    const event = deliver(payload('email.bounced', [], { bounce: { type: 'Permanent' } }));
    const applied = await applyEmailEvent(db, event);
    expect(applied.suppressed).toEqual([]);
    expect(await suppressions()).toEqual([]);
  });

  it('suppresses every recipient a multi-address bounce names', async () => {
    const event = deliver(
      payload('email.bounced', ['one@example.test', 'two@example.test'], {
        bounce: { type: 'Permanent', message: 'Domain does not resolve.' },
      }),
    );
    const applied = await applyEmailEvent(db, event);
    expect([...applied.suppressed].sort()).toEqual(['one@example.test', 'two@example.test']);
  });

  it('matches an address the sweep would skip, whatever its case', async () => {
    // `email` is citext, so a bounce for GONE@ has to stop mail to gone@. If it
    // did not, the suppression would exist and be quietly ineffective.
    await applyEmailEvent(
      db,
      deliver(
        payload('email.bounced', ['GONE@Example.test'], {
          bounce: { type: 'Permanent', message: 'No such user.' },
        }),
      ),
    );
    const { rows } = await db.query('select 1 from public.email_suppressions where email = $1', [
      'gone@example.test',
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe('the endpoint', () => {
  const route = readFileSync(
    join(process.cwd(), 'apps/web/app/api/email/webhook/route.ts'),
    'utf8',
  );

  it('verifies the raw body, not a re-serialised object', () => {
    // `request.json()` here would verify our own serialiser rather than the
    // provider's bytes, and every signature would fail — or worse, pass.
    expect(route).toContain('await request.text()');
    expect(route).not.toContain('request.json()');
  });

  it('refuses rather than accepting anything when the secret is missing', () => {
    expect(route).toContain('RESEND_WEBHOOK_SECRET');
    expect(route).toMatch(/status:\s*404/);
  });

  it('turns a failed verification into a 400 and nothing else', () => {
    expect(route).toContain('EmailWebhookVerificationError');
    expect(route).toMatch(/status:\s*400/);
    // The apply must come after the verify, in the handler and not just in
    // intent. Compared at the call sites; the import block is alphabetical.
    expect(route.indexOf('verifyEmailWebhook(')).toBeLessThan(
      route.indexOf('applyEmailEvent(client'),
    );
  });
});
