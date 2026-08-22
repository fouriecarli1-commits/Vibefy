/**
 * Personal data handling — one of the four mandatory test areas.
 *
 * The commitments being asserted: consent records are immutable, evidence
 * artefacts carry the short retention their incidental-data risk demands, a
 * data-subject request has a real deadline and cannot be refused without a
 * stated basis, and the audit trail cannot be rewritten.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect, expectRefusal } from './setup/client.ts';
import {
  seedAccount,
  seedAssessment,
  seedFinding,
  sha256,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let account: SeededAccount;

beforeAll(async () => {
  db = await connect();
  account = await seedAccount(db, 'privacy');
});

afterAll(async () => {
  await db?.end();
});

describe('consent', () => {
  it('records the exact document version and bytes that were accepted', async () => {
    const { rows } = await db.query<{ document_version: string; document_sha256: string }>(
      `insert into public.consents (user_id, organisation_id, document_type, document_version, document_sha256, ip, user_agent)
       values ($1, $2, 'privacy_policy', '1.0.0', $3, '203.0.113.7', 'Mozilla/5.0')
       returning document_version, document_sha256`,
      [account.userId, account.organisationId, sha256('privacy-policy-1.0.0')],
    );
    expect(rows[0]!.document_version).toBe('1.0.0');
    expect(rows[0]!.document_sha256).toHaveLength(64);
  });

  it('cannot be edited or deleted after the fact', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.consents (user_id, document_type, document_version, document_sha256)
       values ($1, 'terms_of_service', '1.0.0', $2) returning id`,
      [account.userId, sha256('tos-1.0.0')],
    );
    await db.query('begin');
    expect(
      await expectRefusal(db, `update public.consents set action = 'withdrawn' where id = $1`, [
        rows[0]!.id,
      ]),
    ).toMatch(/append-only/i);
    expect(
      await expectRefusal(db, `delete from public.consents where id = $1`, [rows[0]!.id]),
    ).toMatch(/append-only/i);
    await db.query('rollback');
  });

  it('treats withdrawal as a new record, and reports the current position', async () => {
    const fresh = await seedAccount(db, 'consent-withdrawal');
    await db.query(
      `insert into public.consents (user_id, document_type, document_version, document_sha256, action)
       values ($1, 'marketing_email', '1.0.0', $2, 'accepted')`,
      [fresh.userId, sha256('marketing-1.0.0')],
    );
    expect(
      (
        await db.query(`select public.has_current_consent($1, 'marketing_email', '1.0.0') as ok`, [
          fresh.userId,
        ])
      ).rows[0].ok,
    ).toBe(true);

    await db.query(
      `insert into public.consents (user_id, document_type, document_version, document_sha256, action)
       values ($1, 'marketing_email', '1.0.0', $2, 'withdrawn')`,
      [fresh.userId, sha256('marketing-1.0.0')],
    );
    expect(
      (
        await db.query(`select public.has_current_consent($1, 'marketing_email', '1.0.0') as ok`, [
          fresh.userId,
        ])
      ).rows[0].ok,
    ).toBe(false);
  });
});

describe('evidence retention', () => {
  it('defaults to thirty days, because screenshots may contain incidental personal data', async () => {
    const { assessmentId } = await seedAssessment(db, account);
    const findingId = await seedFinding(db, account, assessmentId);
    const { rows } = await db.query<{ days: string }>(
      `select round(extract(epoch from (retention_until - captured_at)) / 86400) as days
         from public.evidence where finding_id = $1`,
      [findingId],
    );
    expect(Number(rows[0]!.days)).toBe(30);
  });
});

describe('data subject requests', () => {
  it('carries a thirty-day deadline by default', async () => {
    const { rows } = await db.query<{ days: string }>(
      `insert into public.data_requests (user_id, request_type)
       values ($1, 'access')
       returning round(extract(epoch from (due_at - created_at)) / 86400) as days`,
      [account.userId],
    );
    expect(Number(rows[0]!.days)).toBe(30);
  });

  it('cannot be refused without a stated basis', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.data_requests (user_id, request_type) values ($1, 'deletion') returning id`,
      [account.userId],
    );
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `update public.data_requests set status = 'refused' where id = $1`,
      [rows[0]!.id],
    );
    expect(message).toMatch(/refusal_needs_basis/i);
    await db.query('rollback');
  });
});

describe('the audit trail', () => {
  it('cannot be rewritten', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, summary)
       values ($1, $2, 'app.created', 'app', gen_random_uuid(), 'Fixture') returning id`,
      [account.organisationId, account.userId],
    );
    await db.query('begin');
    expect(
      await expectRefusal(db, `update public.audit_log set action = 'nothing' where id = $1`, [
        rows[0]!.id,
      ]),
    ).toMatch(/append-only/i);
    expect(
      await expectRefusal(db, `delete from public.audit_log where id = $1`, [rows[0]!.id]),
    ).toMatch(/append-only/i);
    await db.query('rollback');
  });
});
