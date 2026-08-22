/**
 * Authorisation to test — the single largest legal risk in the product.
 *
 * Testing a system we are not authorised to test is a criminal offence in every
 * market on our list, and the adversarial pass makes that risk live rather than
 * theoretical. These tests assert that the gate cannot be walked around, that
 * the evidence of authorisation cannot be edited after the fact, and that a
 * withdrawn authorisation actually stops future work.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect, expectRefusal } from './setup/client.ts';
import {
  seedAccount,
  seedApp,
  seedAuthorisation,
  seedRubric,
  sha256,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let account: SeededAccount;

beforeAll(async () => {
  db = await connect();
  account = await seedAccount(db, 'authorisation');
  await seedRubric(db);
});

afterAll(async () => {
  await db?.end();
});

async function startAssessment(appId: string, authorisationId: string): Promise<string> {
  await db.query('savepoint attempt');
  try {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.assessments (app_id, organisation_id, authorisation_id, rubric_version)
       values ($1, $2, $3, '1.0.0') returning id`,
      [appId, account.organisationId, authorisationId],
    );
    await db.query('release savepoint attempt');
    return rows[0]!.id;
  } catch (error) {
    await db.query('rollback to savepoint attempt');
    throw error;
  }
}

describe('the hard gate', () => {
  it('refuses an assessment when the authorisation is only pending', async () => {
    const appId = await seedApp(db, account);
    const pending = await seedAuthorisation(db, account, appId, { status: 'pending' });
    await db.query('begin');
    await expect(startAssessment(appId, pending)).rejects.toThrow(
      /no verified, unexpired authorisation/i,
    );
    await db.query('rollback');
  });

  it('refuses an assessment when the authorisation has expired', async () => {
    const appId = await seedApp(db, account);
    const expired = await seedAuthorisation(db, account, appId, {
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    await db.query('begin');
    await expect(startAssessment(appId, expired)).rejects.toThrow(
      /no verified, unexpired authorisation/i,
    );
    await db.query('rollback');
  });

  it('refuses an assessment that cites a superseded authorisation', async () => {
    const appId = await seedApp(db, account);
    const first = await seedAuthorisation(db, account, appId);
    await seedAuthorisation(db, account, appId); // supersedes the first by recency
    await db.query('begin');
    await expect(startAssessment(appId, first)).rejects.toThrow(/must reference the current/i);
    await db.query('rollback');
  });

  it('allows an assessment once a verified authorisation is in place', async () => {
    const appId = await seedApp(db, account);
    const verified = await seedAuthorisation(db, account, appId);
    await db.query('begin');
    await expect(startAssessment(appId, verified)).resolves.toMatch(/^[0-9a-f-]{36}$/);
    await db.query('rollback');
  });

  it('stops future work the moment authorisation is withdrawn', async () => {
    const appId = await seedApp(db, account);
    const verified = await seedAuthorisation(db, account, appId);
    expect(
      (await db.query('select public.app_is_authorised_for_testing($1) as ok', [appId])).rows[0].ok,
    ).toBe(true);

    await db.query(
      `insert into public.authorisations
         (app_id, organisation_id, supersedes_id, status, method, scope_domains,
          warranty_text_version, warranty_text_sha256, granted_by, revocation_reason)
       values ($1, $2, $3, 'revoked', 'dns_txt', '{}', '1.0.0', $4, $5, 'Customer withdrew authorisation')`,
      [appId, account.organisationId, verified, sha256('warranty'), account.userId],
    );

    expect(
      (await db.query('select public.app_is_authorised_for_testing($1) as ok', [appId])).rows[0].ok,
    ).toBe(false);
  });
});

describe('the authorisation record is evidence, so it is immutable', () => {
  it('refuses UPDATE', async () => {
    const appId = await seedApp(db, account);
    const id = await seedAuthorisation(db, account, appId);
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `update public.authorisations set scope_domains = array['anything.example'] where id = $1`,
      [id],
    );
    expect(message).toMatch(/append-only/i);
    await db.query('rollback');
  });

  it('refuses DELETE', async () => {
    const appId = await seedApp(db, account);
    const id = await seedAuthorisation(db, account, appId);
    await db.query('begin');
    const message = await expectRefusal(db, `delete from public.authorisations where id = $1`, [
      id,
    ]);
    expect(message).toMatch(/append-only/i);
    await db.query('rollback');
  });
});

describe('the intensity ceiling is not negotiable', () => {
  it('refuses an authorisation that permits destructive testing', async () => {
    const appId = await seedApp(db, account);
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `insert into public.authorisations
         (app_id, organisation_id, status, method, verified_at, scope_domains,
          warranty_text_version, warranty_text_sha256, granted_by, intensity_ceiling)
       values ($1, $2, 'verified', 'dns_txt', now(), array['example.test'], '1.0.0', $3, $4, $5)`,
      [
        appId,
        account.organisationId,
        sha256('warranty'),
        account.userId,
        JSON.stringify({
          non_destructive_only: false,
          allow_data_modification: true,
          allow_data_export: true,
          synthetic_accounts_only: false,
        }),
      ],
    );
    expect(message).toMatch(/intensity_is_non_destructive/i);
    await db.query('rollback');
  });

  it('refuses a verified authorisation with an empty scope allowlist', async () => {
    const appId = await seedApp(db, account);
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `insert into public.authorisations
         (app_id, organisation_id, status, method, verified_at, scope_domains,
          warranty_text_version, warranty_text_sha256, granted_by)
       values ($1, $2, 'verified', 'dns_txt', now(), '{}', '1.0.0', $3, $4)`,
      [appId, account.organisationId, sha256('warranty'), account.userId],
    );
    expect(message).toMatch(/verified_needs_scope/i);
    await db.query('rollback');
  });
});
