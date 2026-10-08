/**
 * A workspace owner could claim any email domain and mark it verified.
 *
 * Measured as `authenticated` with a real owner's access token:
 *
 *     SELF_VERIFIED_SSO: domain=gmail.com enforced=true
 *     select provider from public.sso_routing('victim@gmail.com');  -- oidc
 *
 * `auth-form.tsx` asks `sso_routing` before it accepts a password, for the
 * reason written beside it: a workspace that has enforced SSO has done so
 * precisely so that a password cannot be an alternative route in. A `required`
 * answer refuses the password and calls `signInWithSSO`. Registering the
 * identity provider is still a manual step on our side, so the redirect would
 * fail — which makes the effect of that one row simply that nobody with a
 * Gmail address can sign in to VibefyCode at all.
 *
 * `sso_enforced_needs_verified_domain` already held that `enforced` requires
 * `domain_verified_at`, and that is why one trigger is enough: with the
 * timestamp ours to write, `enforced` can stay the owner's to set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actingAs, committingAs, connect, expectRefusal } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;
let domain: string;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'sso-proof');
  // Its own domain per run: `sso_connections` is unique per domain, so a fixed
  // one would pass alone and collide in the full suite.
  domain = `claimed-${Date.now()}.example`;
});

afterAll(async () => {
  await db?.end();
});

describe('who may say a domain is yours', () => {
  it('refuses a claim that arrives already verified', async () => {
    await actingAs(db, { userId: owner.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.sso_connections
           (organisation_id, provider, email_domain, enforced, domain_challenge,
            domain_verified_at, created_by, default_role)
         values ($1, 'oidc', $2, false, 'vibefycode-domain-verification=x', now(), $3, 'member')`,
        [owner.organisationId, domain, owner.userId],
      );
      expect(message, 'an owner verified their own domain claim').toMatch(/ours to verify/i);
    });
  });

  it('refuses an owner verifying a claim afterwards', async () => {
    const connectionId = await committingAs(db, { userId: owner.userId }, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.sso_connections
           (organisation_id, provider, email_domain, domain_challenge, created_by, default_role)
         values ($1, 'oidc', $2, 'vibefycode-domain-verification=x', $3, 'member')
         returning id`,
        [owner.organisationId, `later-${domain}`, owner.userId],
      );
      return rows[0]!.id;
    });

    await actingAs(db, { userId: owner.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        'update public.sso_connections set domain_verified_at = now() where id = $1',
        [connectionId],
      );
      expect(message, 'an owner verified their own domain').toMatch(/ours to verify/i);
    });

    const { rows } = await db.query<{ domain_verified_at: string | null }>(
      'select domain_verified_at from public.sso_connections where id = $1',
      [connectionId],
    );
    expect(rows[0]?.domain_verified_at).toBeNull();
  });

  it('keeps an unverified domain out of the sign-in lookup', async () => {
    // The point of it, in the terms the sign-in form reads. `enforced` cannot
    // be set without the timestamp, and the timestamp cannot be set by them, so
    // this is the only state their own claim can reach.
    await committingAs(db, { userId: owner.userId }, async (client) => {
      await client.query(
        `insert into public.sso_connections
           (organisation_id, provider, email_domain, domain_challenge, created_by, default_role)
         values ($1, 'oidc', $2, 'vibefycode-domain-verification=x', $3, 'member')`,
        [owner.organisationId, `lookup-${domain}`, owner.userId],
      );
    });

    const { rows } = await db.query(`select * from public.sso_routing($1)`, [
      `victim@lookup-${domain}`,
    ]);
    expect(rows, 'an unverified claim routed a sign-in').toHaveLength(0);
  });

  it('refuses enforcement on a domain nobody verified', async () => {
    // The constraint that was already here, asserted because the trigger above
    // leans on it: it is the reason `enforced` can stay the owner's to set.
    const message = await expectRefusalOnOwnerConnection(
      `insert into public.sso_connections
         (organisation_id, provider, email_domain, enforced, domain_challenge, created_by, default_role)
       values ($1, 'oidc', $2, true, 'vibefycode-domain-verification=x', $3, 'member')`,
      [owner.organisationId, `enforced-${domain}`, owner.userId],
    );
    expect(message).toMatch(/sso_enforced_needs_verified_domain/i);
  });
});

describe('what must still work', () => {
  it('lets an owner claim a domain, which is step one', async () => {
    await committingAs(db, { userId: owner.userId }, async (client) => {
      const { rows } = await client.query<{ email_domain: string }>(
        `insert into public.sso_connections
           (organisation_id, provider, email_domain, domain_challenge, created_by, default_role)
         values ($1, 'saml', $2, 'vibefycode-domain-verification=y', $3, 'member')
         returning email_domain`,
        [owner.organisationId, `step-one-${domain}`, owner.userId],
      );
      expect(rows.length, 'an owner can no longer claim a domain').toBe(1);
    });
  });

  it('lets us verify one, and the owner enforce it afterwards', async () => {
    const connectionId = await committingAs(db, { userId: owner.userId }, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.sso_connections
           (organisation_id, provider, email_domain, domain_challenge, created_by, default_role)
         values ($1, 'oidc', $2, 'vibefycode-domain-verification=z', $3, 'member')
         returning id`,
        [owner.organisationId, `ours-${domain}`, owner.userId],
      );
      return rows[0]!.id;
    });

    // Us: the connection the console uses for this is the owning one.
    await db.query('update public.sso_connections set domain_verified_at = now() where id = $1', [
      connectionId,
    ]);

    await committingAs(db, { userId: owner.userId }, async (client) => {
      const { rows } = await client.query<{ enforced: boolean }>(
        'update public.sso_connections set enforced = true where id = $1 returning enforced',
        [connectionId],
      );
      expect(rows[0]?.enforced, 'an owner can no longer enforce a verified domain').toBe(true);
    });

    const { rows } = await db.query(`select * from public.sso_routing($1)`, [
      `someone@ours-${domain}`,
    ]);
    expect(rows, 'a verified, enforced domain no longer routes').toHaveLength(1);
  });
});

/** The owner connection has no savepoint helper, so this is the same shape for it. */
async function expectRefusalOnOwnerConnection(sql: string, params: unknown[]): Promise<string> {
  await db.query('begin');
  try {
    await db.query(sql, params);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await db.query('rollback');
  }
}
