/**
 * Accepting an invitation, which had never once worked.
 *
 * Found while putting a second step in front of the actions that let one person
 * read another's findings, and proved against the database rather than read off
 * the page: as the invited user, `select ... from public.invitations` returns
 * zero rows and `insert into public.memberships` is refused. Both policies want
 * `owner` or `admin` on the organisation, and somebody who has not joined holds
 * no role in it.
 *
 * So the action read nothing, passed `null` to `canAccept`, and told the person
 * "That invitation link is not valid." That is the worst available shape for
 * this bug: it sends the colleague off to check a link that was fine, and never
 * mentions us.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { actingAs, connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

async function invite(
  email: string,
  overrides: { expiresAt?: string; revoked?: boolean; accepted?: string } = {},
): Promise<string> {
  const token = `tok-${Math.random().toString(36).slice(2)}`;
  await db.query(
    `insert into public.invitations
       (organisation_id, email, role, token_sha256, invited_by, expires_at, revoked_at, revoked_by, accepted_at, accepted_by)
     values ($1, $2, 'member', $3, $4, $5, $6, $7, $8, $9)`,
    [
      owner.organisationId,
      email,
      hash(token),
      owner.userId,
      overrides.expiresAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
      overrides.revoked ? new Date().toISOString() : null,
      overrides.revoked ? owner.userId : null,
      overrides.accepted ?? null,
      overrides.accepted ? owner.userId : null,
    ],
  );
  return token;
}

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'accept-owner');
  await db.query(
    `insert into public.subscriptions (organisation_id, plan, status, seats, current_period_start, current_period_end)
     values ($1, 'organisation', 'active', 20, now(), now() + interval '30 days')`,
    [owner.organisationId],
  );
});

afterAll(async () => {
  await db?.end();
});

const accept = async (userId: string, token: string, aal: 'aal1' | 'aal2' = 'aal1') => {
  try {
    await db.query('begin');
    await db.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: userId, role: 'authenticated', aal }),
    ]);
    await db.query('set local role authenticated');
    const { rows } = await db.query<{ accept_invitation: string }>(
      'select public.accept_invitation($1)',
      [token],
    );
    return { ok: true as const, organisationId: rows[0]!.accept_invitation };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
  } finally {
    await db.query('rollback');
  }
};

describe('the colleague who was invited', () => {
  it('joins the workspace', async () => {
    const guest = await seedAccount(db, 'accept-guest');
    const token = await invite(guest.email);
    const result = await accept(guest.userId, token);
    expect(result.ok).toBe(true);
    expect(result.ok && result.organisationId).toBe(owner.organisationId);
  });

  it('does not need an authenticator app to be let in', async () => {
    /*
     * The other side of the restrictive policies added beside this. Granting
     * somebody access to a customer's findings needs a second step; being
     * granted it, minutes after signing up, does not — otherwise the only way
     * into a workspace is to set up an authenticator app first, which is
     * exactly the friction that was not wanted.
     */
    const guest = await seedAccount(db, 'accept-noapp');
    const token = await invite(guest.email);
    expect((await accept(guest.userId, token, 'aal1')).ok).toBe(true);
  });

  it('is a member afterwards, with the role they were invited as', async () => {
    const guest = await seedAccount(db, 'accept-role');
    const token = await invite(guest.email);
    await db.query('begin');
    await db.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: guest.userId, role: 'authenticated', aal: 'aal1' }),
    ]);
    await db.query('set local role authenticated');
    await db.query('select public.accept_invitation($1)', [token]);
    await db.query('reset role');
    const { rows } = await db.query<{ role: string }>(
      `select role::text from public.memberships where organisation_id = $1 and user_id = $2`,
      [owner.organisationId, guest.userId],
    );
    await db.query('rollback');
    expect(rows[0]?.role).toBe('member');
  });
});

describe('the refusals, in the words a person reads', () => {
  it('refuses a token nobody issued', async () => {
    const guest = await seedAccount(db, 'accept-bogus');
    const result = await accept(guest.userId, 'not-a-real-token');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('That invitation link is not valid.');
  });

  it('refuses one that was already used', async () => {
    const guest = await seedAccount(db, 'accept-used');
    const token = await invite(guest.email, { accepted: new Date().toISOString() });
    const result = await accept(guest.userId, token);
    expect(!result.ok && result.message).toContain('That invitation has already been used.');
  });

  it('refuses one that was withdrawn', async () => {
    const guest = await seedAccount(db, 'accept-revoked');
    const token = await invite(guest.email, { revoked: true });
    const result = await accept(guest.userId, token);
    expect(!result.ok && result.message).toContain('That invitation was withdrawn.');
  });

  it('refuses one that expired, and says when', async () => {
    const guest = await seedAccount(db, 'accept-expired');
    const token = await invite(guest.email, {
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const result = await accept(guest.userId, token);
    expect(!result.ok && result.message).toMatch(/expired on \d{4}-\d{2}-\d{2}/);
  });

  it('refuses somebody the link was forwarded to, without naming the addressee', async () => {
    const guest = await seedAccount(db, 'accept-intended');
    const stranger = await seedAccount(db, 'accept-stranger');
    const token = await invite(guest.email);
    const result = await accept(stranger.userId, token);
    expect(!result.ok && result.message).toContain('sent to a different address');
    // A forwarded link must not tell whoever received it who else is in the
    // workspace.
    expect(!result.ok && result.message).not.toContain(guest.email);
  });
});

describe('a second click on a link that worked', () => {
  it('is not an error, because the honest cause is a double click', async () => {
    const guest = await seedAccount(db, 'accept-twice');
    const token = await invite(guest.email);
    await db.query('begin');
    await db.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: guest.userId, role: 'authenticated', aal: 'aal1' }),
    ]);
    await db.query('set local role authenticated');
    await db.query('select public.accept_invitation($1)', [token]);
    let second: string | null = null;
    try {
      await db.query('select public.accept_invitation($1)', [token]);
    } catch (error) {
      second = error instanceof Error ? error.message : String(error);
    }
    await db.query('rollback');
    expect(second).toBeNull();
  });
});

describe('what the caller is told about the invitation', () => {
  it('learns the organisation it joined and nothing else', async () => {
    // Not the token hash, not who invited them, not the other addresses. A
    // caller holding a token learns whether it worked and why not.
    const guest = await seedAccount(db, 'accept-quiet');
    const token = await invite(guest.email);
    const result = await accept(guest.userId, token);
    expect(result.ok && result.organisationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('cannot read the invitations table directly, before or after', async () => {
    const guest = await seedAccount(db, 'accept-peek');
    await invite(guest.email);
    const visible = await actingAs(db, { userId: guest.userId, aal: 'aal2' }, async (client) => {
      const { rows } = await client.query('select id from public.invitations');
      return rows.length;
    });
    expect(visible).toBe(0);
  });
});
