/**
 * Four records whose own subject could write our half of them.
 *
 * The same sweep that found the score, the Acceptable Use verdict, the
 * ownership proof and the verified email domain, run over every remaining
 * table a request-facing role may write. None of these four is an exploit the
 * way those were. Each is a record that exists to show what *we* did, and each
 * could be written by the party it is about — and a record its subject can
 * write is not evidence of anything, which is the whole reason the tables
 * exist.
 *
 *   · `appeals` — an appeal could arrive `upheld`, with a resolution the
 *     appellant wrote and a `resolved_by` pointing at a reviewer who never saw
 *     it. `/review/appeals` lists what is open, so it would also be an appeal
 *     no reviewer is ever shown.
 *   · `data_requests` — a statutory request could arrive `completed`, with its
 *     own answer and its own deadline. The response clock is the thing the
 *     table exists to evidence.
 *   · `audit_exports` — `row_count` and `sha256` are what let a file produced
 *     in a dispute be checked against the record. `recordAuditExport` ran on
 *     the caller's identity, so the digest was written by the party who would
 *     be producing the file.
 *   · `organisations` — `is_marketing_client` is a disclosure rendered on the
 *     public verification page, and its subject could clear it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actingAs, committingAs, connect, expectRefusal } from './setup/client.ts';
import { seedAccount, seedAssessment, type SeededAccount } from './setup/seed.ts';

let db: Client;
let customer: SeededAccount;
let assessmentId: string;

beforeAll(async () => {
  db = await connect();
  customer = await seedAccount(db, 'our-side');
  ({ assessmentId } = await seedAssessment(db, customer));
});

afterAll(async () => {
  await db?.end();
});

describe('an appeal', () => {
  it('refuses one that arrives already upheld', async () => {
    await actingAs(db, { userId: customer.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.appeals
           (assessment_id, organisation_id, submitted_by, grounds, status, resolution, resolved_at)
         values ($1, $2, $3, $4, 'upheld', 'We agree with ourselves entirely.', now())`,
        [
          assessmentId,
          customer.organisationId,
          customer.userId,
          'The finding about our checkout flow does not reflect what the page does.',
        ],
      );
      expect(message, 'an appellant resolved their own appeal').toMatch(/permission denied/i);
    });
  });

  it('still lets the customer appeal, with the clock we published', async () => {
    const appeal = await committingAs(db, { userId: customer.userId }, async (client) => {
      const { rows } = await client.query<{ status: string; due_at: string }>(
        `insert into public.appeals (assessment_id, organisation_id, submitted_by, grounds)
         values ($1, $2, $3, $4) returning status, due_at`,
        [
          assessmentId,
          customer.organisationId,
          customer.userId,
          'The finding about our checkout flow does not reflect what the page does.',
        ],
      );
      return rows[0]!;
    });
    expect(appeal.status, 'a new appeal is not open').toBe('open');
    // Fourteen days is the published turnaround, and it is the default rather
    // than something the appellant or the form chooses.
    const days = (new Date(appeal.due_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThan(15);
  });
});

describe('a data-subject request', () => {
  it('refuses one that arrives already answered', async () => {
    await actingAs(db, { userId: customer.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.data_requests (user_id, request_type, status, response, completed_at)
         values ($1, 'access', 'completed', 'Already done, nothing to see.', now())`,
        [customer.userId],
      );
      expect(message, 'a subject answered their own request').toMatch(/permission denied/i);
    });
  });

  it('refuses a deadline of their own choosing', async () => {
    await actingAs(db, { userId: customer.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.data_requests (user_id, request_type, due_at)
         values ($1, 'portability', now() + interval '400 days')`,
        [customer.userId],
      );
      expect(message, 'a subject set the statutory clock').toMatch(/permission denied/i);
    });
  });

  it('still lets them ask, with the clock the policy published', async () => {
    const request = await committingAs(db, { userId: customer.userId }, async (client) => {
      const { rows } = await client.query<{ status: string; due_at: string }>(
        `insert into public.data_requests (user_id, organisation_id, request_type, details)
         values ($1, $2, 'deletion', 'Please remove everything you hold about me.')
         returning status, due_at`,
        [customer.userId, customer.organisationId],
      );
      return rows[0]!;
    });
    expect(request.status).toBe('received');
    const days = (new Date(request.due_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });
});

describe('an audit export', () => {
  it('refuses a row written by the party who holds the file', async () => {
    await actingAs(db, { userId: customer.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.audit_exports
           (organisation_id, requested_by, kind, format, row_count, sha256, period_start, period_end)
         values ($1, $2, 'audit_log', 'csv', 1, $3, now() - interval '30 days', now())`,
        [customer.organisationId, customer.userId, 'f'.repeat(64)],
      );
      expect(message, 'the holder wrote their own digest').toMatch(/permission denied/i);
    });
  });

  it('still lets us record one', async () => {
    const { rows } = await db.query<{ sha256: string }>(
      `insert into public.audit_exports
         (organisation_id, requested_by, kind, format, row_count, sha256, period_start, period_end)
       values ($1, $2, 'audit_log', 'csv', 3, $3, now() - interval '30 days', now())
       returning sha256`,
      [customer.organisationId, customer.userId, 'a'.repeat(64)],
    );
    expect(rows[0]?.sha256, 'we can no longer record an export').toBe('a'.repeat(64));
  });
});

describe('a marketing relationship we have to disclose', () => {
  it('refuses its subject removing it', async () => {
    await db.query(
      `update public.organisations set is_marketing_client = true, marketing_client_since = now()
        where id = $1`,
      [customer.organisationId],
    );

    await actingAs(db, { userId: customer.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `update public.organisations set is_marketing_client = false,
                marketing_client_since = null where id = $1`,
        [customer.organisationId],
      );
      // `permission denied` because the privilege is gone; a filtered update
      // matching nothing would be the weaker form and is also the rule.
      if (message === '') {
        const { rows } = await client.query<{ is_marketing_client: boolean }>(
          'select is_marketing_client from public.organisations where id = $1',
          [customer.organisationId],
        );
        expect(rows[0]?.is_marketing_client, 'the subject cleared the disclosure').toBe(true);
      }
    });

    const { rows } = await db.query<{ is_marketing_client: boolean }>(
      'select is_marketing_client from public.organisations where id = $1',
      [customer.organisationId],
    );
    expect(rows[0]?.is_marketing_client, 'the disclosure did not survive').toBe(true);
  });

  it('still lets a workspace be created, which is the one write there is', async () => {
    // Through `create_workspace`, a `security definer` function owned by a role
    // with `bypassrls` — so none of this reaches it. Asserted because the
    // migration leans on that being true.
    const { rows } = await committingAs(db, { userId: customer.userId }, async (client) =>
      client.query<{ create_workspace: string }>(
        `select public.create_workspace($1, $2, 'agency')`,
        ['Second Workspace', `second-${Date.now()}`],
      ),
    );
    expect(rows[0]?.create_workspace, 'a customer can no longer create a workspace').toBeTruthy();
  });
});
