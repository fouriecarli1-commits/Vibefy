/**
 * A customer could write their own verified authorisation, for a domain they
 * do not own.
 *
 * PART 11: "Do not run any assessment step against a target that lacks a
 * verified authorisation record." `run-assessment.ts` calls it the hard gate,
 * and the gate is one function. Measured as `authenticated` with a real
 * workspace owner's access token and nothing else:
 *
 *     SELF_VERIFIED_AUTH: status=verified verified_at_set=true target=competitor.example
 *     app_is_authorised_for_testing: true
 *
 * An application's `primary_url` is the customer's to set, so the target can
 * be anybody's. The DNS-TXT proof in `verifyOwnership` is real and was simply
 * not on the path: `verifyAuthorisation` ran the check and then wrote the
 * result through the customer's own client, so the check was a step in a
 * server action rather than a property of the row.
 *
 * The second half, measured the same way: nothing tied `scope_domains` to
 * `verification_target`. `permittedScopeFor` enforces it at step one, in the
 * action, and step two carried the pending scope forward unchanged — so a
 * pending row written through PostgREST could name a host the customer does
 * own and a scope they do not, and pressing Verify would carry the forged
 * scope into a properly verified row.
 *
 * This is the third of three with the same shape. The difference is who is
 * harmed: not the customer, but whoever owns the domain we would have scanned.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actingAs, committingAs, connect, expectRefusal } from './setup/client.ts';
import { seedAccount, seedApp, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;
let appId: string;

const WARRANTY_SHA = 'a'.repeat(64);

const pendingRow = (organisationId: string, app: string, grantedBy: string) => [
  app,
  organisationId,
  grantedBy,
  'theirs.example',
  ['theirs.example'],
  WARRANTY_SHA,
];

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'authorisation-proof');
  appId = await seedApp(db, owner, 'Authorised App');
});

afterAll(async () => {
  await db?.end();
});

describe('who may say that ownership was proved', () => {
  it('refuses a verified authorisation written by the account it is about', async () => {
    await actingAs(db, { userId: owner.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.authorisations
           (app_id, organisation_id, granted_by, method, status, verified_at,
            verification_target, scope_domains, warranty_text_version, warranty_text_sha256,
            accepted_at, expires_at)
         values ($1, $2, $3, 'dns_txt', 'verified', now(), $4, $5, '1.0.0', $6,
                 now(), now() + interval '90 days')`,
        pendingRow(owner.organisationId, appId, owner.userId),
      );
      expect(message, 'a customer wrote their own verified authorisation').toMatch(
        /recorded as verified by VibefyCode/i,
      );
    });
  });

  it('refuses a customer declaring when it was verified, even as pending', async () => {
    await actingAs(db, { userId: owner.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.authorisations
           (app_id, organisation_id, granted_by, method, status, verified_at,
            verification_target, scope_domains, warranty_text_version, warranty_text_sha256,
            accepted_at, expires_at)
         values ($1, $2, $3, 'dns_txt', 'pending', now(), $4, $5, '1.0.0', $6,
                 now(), now() + interval '90 days')`,
        pendingRow(owner.organisationId, appId, owner.userId),
      );
      expect(message, 'a customer dated their own verification').toMatch(/ours to record/i);
    });
  });

  it('refuses a customer promoting their own pending row', async () => {
    const pending = await committingAs(db, { userId: owner.userId }, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.authorisations
           (app_id, organisation_id, granted_by, method, status,
            verification_target, scope_domains, warranty_text_version, warranty_text_sha256,
            accepted_at, expires_at)
         values ($1, $2, $3, 'dns_txt', 'pending', $4, $5, '1.0.0', $6,
                 now(), now() + interval '90 days')
         returning id`,
        pendingRow(owner.organisationId, appId, owner.userId),
      );
      return rows[0]!.id;
    });

    await actingAs(db, { userId: owner.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `update public.authorisations set status = 'verified', verified_at = now() where id = $1`,
        [pending],
      );
      // Two refusals are possible and both are the rule: the trigger's
      // sentence, or `permission denied` because `authorisations` carries no
      // UPDATE grant for `authenticated` at all. Today it is the second, which
      // is the stronger of the two — the statement never reaches the trigger.
      // Asserting only the trigger's wording would make this test fail the day
      // somebody granted UPDATE *and* the trigger caught it, which is the one
      // outcome nobody needs to be told about.
      expect(message, 'a customer promoted their own authorisation').toMatch(
        /recorded as verified by VibefyCode|permission denied/i,
      );
    });

    const { rows } = await db.query<{ status: string }>(
      'select status from public.authorisations where id = $1',
      [pending],
    );
    expect(rows[0]?.status).toBe('pending');
  });

  it('leaves the gate shut on an application whose only authorisation is self-written', async () => {
    // The point of all of it, asserted in the terms the runner reads.
    const other = await seedAccount(db, 'authorisation-gate');
    const unproven = await seedApp(db, other, 'Unproven App');
    const { rows } = await db.query<{ authorised: boolean }>(
      'select public.app_is_authorised_for_testing($1) as authorised',
      [unproven],
    );
    expect(rows[0]?.authorised, 'an unauthorised app reads as authorised').toBe(false);
  });
});

describe('what a verified authorisation may cover', () => {
  it('refuses a scope outside the host that was proved', async () => {
    const message = await expectRefusalOnOwnerConnection(
      `insert into public.authorisations
         (app_id, organisation_id, granted_by, method, status, verified_at,
          verification_target, scope_domains, warranty_text_version, warranty_text_sha256,
          accepted_at, expires_at)
       values ($1, $2, $3, 'dns_txt', 'verified', now(), 'mine.example',
               array['competitor.example'], '1.0.0', $4, now(), now() + interval '90 days')`,
      [appId, owner.organisationId, owner.userId, WARRANTY_SHA],
    );
    expect(message, 'a verified authorisation covered a host it never proved').toMatch(
      /authorisations_scope_within_verified_target/i,
    );
  });

  it('allows the host itself, a subdomain, and the apex of a www host', async () => {
    for (const [target, scope] of [
      ['mine.example', ['mine.example']],
      ['mine.example', ['mine.example', 'api.mine.example']],
      ['www.mine.example', ['mine.example', 'www.mine.example']],
    ] as const) {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.authorisations
           (app_id, organisation_id, granted_by, method, status, verified_at,
            verification_target, scope_domains, warranty_text_version, warranty_text_sha256,
            accepted_at, expires_at)
         values ($1, $2, $3, 'dns_txt', 'verified', now(), $4, $5, '1.0.0', $6,
                 now(), now() + interval '90 days')
         returning id`,
        [appId, owner.organisationId, owner.userId, target, scope, WARRANTY_SHA],
      );
      expect(rows.length, `${target} did not accept ${scope.join(', ')}`).toBe(1);
    }
  });

  it('refuses a sibling that merely ends the same way', async () => {
    // `notmine.example` ends with `mine.example` as a string and is a different
    // domain. The predicate compares the dot too, which is the whole reason it
    // is written as `right(d, length(target) + 1) = '.' || target`.
    const message = await expectRefusalOnOwnerConnection(
      `insert into public.authorisations
         (app_id, organisation_id, granted_by, method, status, verified_at,
          verification_target, scope_domains, warranty_text_version, warranty_text_sha256,
          accepted_at, expires_at)
       values ($1, $2, $3, 'dns_txt', 'verified', now(), 'mine.example',
               array['notmine.example'], '1.0.0', $4, now(), now() + interval '90 days')`,
      [appId, owner.organisationId, owner.userId, WARRANTY_SHA],
    );
    expect(message, 'a lookalike domain was covered').toMatch(
      /authorisations_scope_within_verified_target/i,
    );
  });
});

describe('what must still work', () => {
  it('lets a customer ask, which is step one of the flow', async () => {
    await committingAs(db, { userId: owner.userId }, async (client) => {
      const { rows } = await client.query<{ status: string }>(
        `insert into public.authorisations
           (app_id, organisation_id, granted_by, method, status,
            verification_target, scope_domains, warranty_text_version, warranty_text_sha256,
            accepted_at, expires_at)
         values ($1, $2, $3, 'dns_txt', 'pending', $4, $5, '1.0.0', $6,
                 now(), now() + interval '90 days')
         returning status`,
        pendingRow(owner.organisationId, appId, owner.userId),
      );
      expect(rows[0]?.status, 'a customer can no longer ask to be assessed').toBe('pending');
    });
  });

  it('lets a customer withdraw, which is theirs to do', async () => {
    await committingAs(db, { userId: owner.userId }, async (client) => {
      const { rows } = await client.query<{ status: string }>(
        `insert into public.authorisations
           (app_id, organisation_id, granted_by, method, status, scope_domains,
            warranty_text_version, warranty_text_sha256, revocation_reason, accepted_at)
         values ($1, $2, $3, 'dns_txt', 'revoked', '{}', '1.0.0', $4,
                 'Withdrawn because we are moving the application elsewhere.', now())
         returning status`,
        [appId, owner.organisationId, owner.userId, WARRANTY_SHA],
      );
      expect(rows[0]?.status, 'a customer can no longer withdraw').toBe('revoked');
    });
  });

  it('lets us record one, on our own connection', async () => {
    const { rows } = await db.query<{ status: string }>(
      `insert into public.authorisations
         (app_id, organisation_id, granted_by, method, status, verified_at,
          verification_target, scope_domains, warranty_text_version, warranty_text_sha256,
          accepted_at, expires_at)
       values ($1, $2, $3, 'dns_txt', 'verified', now(), 'theirs.example',
               array['theirs.example'], '1.0.0', $4, now(), now() + interval '90 days')
       returning status`,
      [appId, owner.organisationId, owner.userId, WARRANTY_SHA],
    );
    expect(rows[0]?.status, 'we can no longer record a verified authorisation').toBe('verified');
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
