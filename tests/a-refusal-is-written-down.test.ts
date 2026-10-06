/**
 * "Refusals are logged with their ground, per the Acceptable Use Policy."
 *
 * That sentence sat in `apps/web/app/console/apps/actions.ts`, above an insert
 * into `audit_log`, and it is a commitment the published policy makes on our
 * behalf. The insert ran as the customer who submitted the application, and the
 * only insert policy on that table requires `is_platform_admin()`. So row-level
 * security refused it, every time, since the day the admin console landed. The
 * action discarded the result and redirected. No refusal at intake had ever
 * been recorded, and nothing anywhere said so.
 *
 * Both halves are held here, because fixing one without the other would be
 * worse than the defect. The entry must exist — and the table must stay closed
 * to the person the entry is about, since a log its subject can write into is
 * not evidence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actingAs, connect } from './setup/client.ts';
import { seedAccount, seedApp, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'refusal-log');
});

afterAll(async () => {
  await db.end();
});

const entriesFor = async (appId: string) =>
  (
    await db.query<{ action: string; summary: string; actor_role: string; actor_id: string }>(
      `select action, summary, actor_role, actor_id
         from public.audit_log where entity_type = 'app' and entity_id = $1`,
      [appId],
    )
  ).rows;

describe('an application refused at intake', () => {
  it('has its refusal written down', async () => {
    const appId = await seedApp(db, owner, 'Refused App', { screening: 'refused' });
    const entries = await entriesFor(appId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe('app.screening_refused');
  });

  it('is written down with its ground, which is what the policy promises', async () => {
    // Not the fact alone. A refusal that does not say why is the thing the
    // Acceptable Use Policy exists to prevent.
    const appId = await seedApp(db, owner, 'Refused With Reason', { screening: 'refused' });
    const entries = await entriesFor(appId);
    expect(entries[0]!.summary.length).toBeGreaterThan(10);
  });

  it('says the decision was ours and names the account it was about', async () => {
    const appId = await seedApp(db, owner, 'Refused Attribution', { screening: 'refused' });
    const entries = await entriesFor(appId);
    expect(entries[0]!.actor_role).toMatch(/intake filter/i);
    expect(entries[0]!.actor_id).toBe(owner.userId);
  });

  it('writes nothing for an application that was not refused', async () => {
    const cleared = await seedApp(db, owner, 'Cleared App', { screening: 'cleared' });
    const pending = await seedApp(db, owner, 'Pending App', { screening: 'pending' });
    expect(await entriesFor(cleared)).toHaveLength(0);
    expect(await entriesFor(pending)).toHaveLength(0);
  });
});

describe('the log the refusal goes into', () => {
  it('is still closed to the person the entry is about', async () => {
    // Why the writer had to move rather than the policy. The action's insert
    // ran as this identity and was refused; opening the table so it could
    // succeed would have made every entry in it worthless.
    const appId = await seedApp(db, owner, 'Closed Log', { screening: 'cleared' });
    await actingAs(db, { userId: owner.userId }, async (client) => {
      await expect(
        client.query(
          `insert into public.audit_log
             (organisation_id, actor_id, action, entity_type, entity_id, summary)
           values ($1, $2, 'app.screening_refused', 'app', $3, 'Written by the subject.')`,
          [owner.organisationId, owner.userId, appId],
        ),
      ).rejects.toThrow(/row-level security|violates/i);
    });
  });

  it('refuses an entry a customer would most want to forge', async () => {
    await actingAs(db, { userId: owner.userId }, async (client) => {
      await expect(
        client.query(
          `insert into public.audit_log
             (organisation_id, actor_id, action, entity_type, entity_id, summary)
           values ($1, $2, 'account.platform_role_set', 'user', $2, 'Promoted myself.')`,
          [owner.organisationId, owner.userId],
        ),
      ).rejects.toThrow(/row-level security|violates/i);
    });
  });
});
