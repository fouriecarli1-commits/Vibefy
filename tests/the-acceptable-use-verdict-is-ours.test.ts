/**
 * A workspace owner could clear their own application under the Acceptable Use
 * Policy.
 *
 * Measured as `authenticated` with a real owner's access token, against an
 * application a reviewer had marked `refused`:
 *
 *     update public.apps set screening_status = 'cleared', screened_at = now(),
 *            screening_notes = 'Looks fine to me.' where id = 'c3384c82-…';
 *
 *     AFTER: screening=cleared notes=Looks fine to me.
 *     UPDATE 1
 *
 * `screening_status` is the gate `apps/worker/src/run-assessment.ts` reads
 * before anything runs — it refuses `refused` and refuses `pending`, "no
 * assessment runs before that" — so clearing it is how a refused application
 * gets assessed, scored and badged.
 *
 * `apps_update_admins` permits it: `has_org_role(organisation_id,
 * ['owner','admin'])`, which is the right rule for the name, the URL and the
 * intake answers, and names no column. Postgres has no per-column RLS, so the
 * answer is a per-column privilege, which is checked before any policy.
 *
 * The same sweep found the monitoring columns under the same policy. The
 * failure counter is what suspends a badge for an application that has stopped
 * answering, and its subject could set it back to zero.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actingAs, committingAs, connect, expectRefusal } from './setup/client.ts';
import { seedAccount, seedApp, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'aup-verdict');
});

afterAll(async () => {
  await db?.end();
});

describe('what the subject of a decision may write about it', () => {
  it('refuses an owner clearing their own refused application', async () => {
    const appId = await seedApp(db, owner, 'Refused App', { screening: 'refused' });

    await actingAs(db, { userId: owner.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `update public.apps set screening_status = 'cleared', screened_at = now(),
                screening_notes = 'Looks fine to me.' where id = $1`,
        [appId],
      );
      expect(message, 'an owner cleared their own refused application').toMatch(
        /permission denied/i,
      );
    });

    const { rows } = await db.query<{ screening_status: string }>(
      'select screening_status from public.apps where id = $1',
      [appId],
    );
    expect(rows[0]?.screening_status, 'the refusal did not survive the attempt').toBe('refused');
  });

  it('refuses a submission that arrives already cleared', async () => {
    await actingAs(db, { userId: owner.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.apps
           (organisation_id, name, slug, app_type, primary_url, created_by, screening_status)
         values ($1, 'Self Cleared', $2, 'web_url', 'https://example.test', $3, 'cleared')`,
        [owner.organisationId, `app-self-cleared-${Date.now()}`, owner.userId],
      );
      expect(message, 'a submission arrived already cleared').toMatch(/permission denied/i);
    });
  });

  it('refuses an owner resetting the counter that suspends their badge', async () => {
    const appId = await seedApp(db, owner, 'Monitored App');
    await db.query('update public.apps set consecutive_liveness_failures = 4 where id = $1', [
      appId,
    ]);

    await actingAs(db, { userId: owner.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        'update public.apps set consecutive_liveness_failures = 0 where id = $1',
        [appId],
      );
      expect(message, 'an owner reset their own liveness failures').toMatch(/permission denied/i);
    });

    const { rows } = await db.query<{ consecutive_liveness_failures: number }>(
      'select consecutive_liveness_failures from public.apps where id = $1',
      [appId],
    );
    expect(rows[0]?.consecutive_liveness_failures).toBe(4);
  });

  it('names no request-facing role that may write the verdict', async () => {
    // The catalogue form, so a column added to the decision next month is
    // covered by naming it here rather than by somebody remembering this file.
    const { rows } = await db.query<{ grantee: string; column_name: string }>(
      `select grantee, column_name
         from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'apps'
          and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
          and privilege_type in ('INSERT', 'UPDATE')
          and column_name in ('screening_status', 'screening_notes', 'screened_at',
                              'last_seen_at', 'last_liveness_status',
                              'consecutive_liveness_failures', 'last_reassessed_at')`,
    );
    expect(
      rows.map((row) => `${row.grantee}:${row.column_name}`),
      'a request-facing role may write a platform-authored column on public.apps',
    ).toEqual([]);
  });

  it('keeps the intake door shut to the account it is about', async () => {
    // Seeded on the owning connection, outside the block: `seedApp` writes the
    // screening columns, which is exactly what the role inside may no longer do.
    const appId = await seedApp(db, owner, 'Pending App', { screening: 'pending' });
    await actingAs(db, { userId: owner.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `select public.record_intake_screening($1, 'cleared', 'I read it myself and it is fine.')`,
        [appId],
      );
      expect(message, 'a customer called the intake door').toMatch(/permission denied/i);
    });
  });
});

describe('what must still work', () => {
  it('lets an owner change the things that are theirs to change', async () => {
    const appId = await seedApp(db, owner, 'Renameable App');
    await committingAs(db, { userId: owner.userId }, async (client) => {
      const { rows } = await client.query<{ name: string }>(
        `update public.apps set name = 'Renamed', has_payments = true, monitoring_enabled = true
          where id = $1 returning name`,
        [appId],
      );
      expect(rows.length, 'an owner can no longer edit their own application').toBe(1);
      expect(rows[0]?.name).toBe('Renamed');
    });
  });

  it('lets a submission in, and lands it where an unscreened one belongs', async () => {
    // What `createApp` now does: insert without the three columns and let the
    // default stand. `run-assessment.ts` refuses `pending`, so this is the side
    // of the gate to fail towards rather than a gap.
    const slug = `app-intake-${Date.now()}`;
    const appId = await committingAs(db, { userId: owner.userId }, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.apps
           (organisation_id, name, slug, app_type, primary_url, created_by)
         values ($1, 'Submitted App', $2, 'web_url', 'https://example.test', $3)
         returning id`,
        [owner.organisationId, slug, owner.userId],
      );
      expect(rows.length, 'a customer can no longer submit an application').toBe(1);
      return rows[0]!.id;
    });

    const { rows } = await db.query<{ screening_status: string }>(
      'select screening_status from public.apps where id = $1',
      [appId],
    );
    expect(rows[0]?.screening_status).toBe('pending');
  });

  it('records the verdict on our own connection, with the audit entry', async () => {
    const appId = await seedApp(db, owner, 'To Be Refused', { screening: 'pending' });
    const note = 'refused (deterministic filter, high confidence): the submission names a target.';
    const { rows: applied } = await db.query<{ record_intake_screening: boolean }>(
      `select public.record_intake_screening($1, 'refused', $2)`,
      [appId, note],
    );
    expect(applied[0]?.record_intake_screening).toBe(true);

    const { rows } = await db.query<{ screening_status: string; screening_notes: string }>(
      'select screening_status, screening_notes from public.apps where id = $1',
      [appId],
    );
    expect(rows[0]?.screening_status).toBe('refused');
    expect(rows[0]?.screening_notes).toBe(note);

    const { rows: logged } = await db.query<{ action: string; summary: string }>(
      `select action, summary from public.audit_log
        where entity_type = 'app' and entity_id = $1 order by occurred_at desc limit 1`,
      [appId],
    );
    expect(logged[0]?.action, 'the refusal was not written down').toBe('app.screening_refused');
    expect(logged[0]?.summary).toBe(note);
  });

  it('leaves a decision a reviewer already made alone', async () => {
    // The same rule the sweep has: between the insert and this call a reviewer
    // may have decided, and theirs stands. `false`, not an exception — nothing
    // has gone wrong.
    const appId = await seedApp(db, owner, 'Already Decided', { screening: 'refused' });
    const { rows } = await db.query<{ record_intake_screening: boolean }>(
      `select public.record_intake_screening($1, 'cleared', 'Nothing in it worries me at all.')`,
      [appId],
    );
    expect(rows[0]?.record_intake_screening).toBe(false);
    const { rows: after } = await db.query<{ screening_status: string }>(
      'select screening_status from public.apps where id = $1',
      [appId],
    );
    expect(after[0]?.screening_status).toBe('refused');
  });
});
