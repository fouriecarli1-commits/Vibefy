/**
 * A customer could declare their own plan, depth and spending ceiling.
 *
 * Measured as `authenticated` with a real member's access token:
 *
 *     SELF_PLANNED_REQUEST: plan=certified ceiling=999.0000 depth=continuous
 *
 * `decideAssessmentRequest` decides all four, and it is the one place the free
 * tier's cooldown, the re-test credit and the per-plan depth live.
 * `requestAssessment` called it and then wrote the answer through the
 * customer's own client, so the decision was a step in a server action rather
 * than a property of the row — the sixth table with that sentence true of it.
 *
 * What it costs: `COST_CEILING_BY_DEPTH` is `limited: 0.50`, `continuous: 2.00`,
 * `full: 4.00`, and `run-assessment.ts` reads it by depth. A free-tier customer
 * naming `full` gets eight times the model spend their tier pays for, with no
 * credit consumed and the cooldown not applied.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { COST_CEILING_BY_DEPTH } from '../packages/engine/src/runtime/cost.ts';
import { actingAs, committingAs, connect, expectRefusal } from './setup/client.ts';
import { seedAccount, seedApp, type SeededAccount } from './setup/seed.ts';

let db: Client;
let member: SeededAccount;
let appId: string;

beforeAll(async () => {
  db = await connect();
  member = await seedAccount(db, 'own-plan');
  appId = await seedApp(db, member, 'Planned App');
});

afterAll(async () => {
  await db?.end();
});

describe('who decides what a customer is owed', () => {
  it('refuses a request the customer queued for themselves', async () => {
    await actingAs(db, { userId: member.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.assessment_requests
           (app_id, organisation_id, requested_by, depth, plan_at_request,
            max_run_cost_usd, uses_retest_credit, status)
         values ($1, $2, $3, 'continuous', 'certified', 999.00, false, 'queued')`,
        [appId, member.organisationId, member.userId],
      );
      expect(message, 'a customer declared their own plan').toMatch(/permission denied/i);
    });
  });

  it('refuses even the modest version, because the column set is the point', async () => {
    // Not about the dollar figure: `depth` alone decides the ceiling the runner
    // applies, so a row naming only that is the same defect with a smaller
    // number on it.
    await actingAs(db, { userId: member.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.assessment_requests
           (app_id, organisation_id, requested_by, depth, plan_at_request, max_run_cost_usd)
         values ($1, $2, $3, 'limited', 'free', 0.50)`,
        [appId, member.organisationId, member.userId],
      );
      expect(message, 'a customer queued their own request').toMatch(/permission denied/i);
    });
  });

  it('is worth closing because depth is what the runner reads', () => {
    // The consequence, in the numbers the migration quotes. If these ever
    // change, the sentence in the migration comment should change with them.
    expect(COST_CEILING_BY_DEPTH.limited).toBe(0.5);
    expect(COST_CEILING_BY_DEPTH.full).toBe(4);
    expect(COST_CEILING_BY_DEPTH.full / COST_CEILING_BY_DEPTH.limited).toBe(8);
  });
});

describe('what must still work', () => {
  it('lets us queue one, which is the only writer there is', async () => {
    const { rows } = await db.query<{ status: string; depth: string }>(
      `insert into public.assessment_requests
         (app_id, organisation_id, requested_by, depth, plan_at_request, max_run_cost_usd)
       values ($1, $2, $3, 'limited', 'free', 0.50)
       returning status, depth::text as depth`,
      [appId, member.organisationId, member.userId],
    );
    expect(rows[0]?.status, 'we can no longer queue an assessment').toBe('queued');
    expect(rows[0]?.depth).toBe('limited');
  });

  it('still lets the customer cancel, which is their own act', async () => {
    const other = await seedApp(db, member, 'Cancellable App');
    await db.query(
      `insert into public.assessment_requests
         (app_id, organisation_id, requested_by, depth, plan_at_request, max_run_cost_usd)
       values ($1, $2, $3, 'limited', 'free', 0.50)`,
      [other, member.organisationId, member.userId],
    );

    await committingAs(db, { userId: member.userId }, async (client) => {
      const { rows } = await client.query<{ status: string }>(
        `update public.assessment_requests set status = 'cancelled'
          where app_id = $1 returning status`,
        [other],
      );
      expect(rows.length, 'a customer can no longer cancel their own request').toBe(1);
      expect(rows[0]?.status).toBe('cancelled');
    });
  });

  it('still refuses the customer any other transition, which was already the rule', async () => {
    const third = await seedApp(db, member, 'Not Completable App');
    await db.query(
      `insert into public.assessment_requests
         (app_id, organisation_id, requested_by, depth, plan_at_request, max_run_cost_usd)
       values ($1, $2, $3, 'limited', 'free', 0.50)`,
      [third, member.organisationId, member.userId],
    );

    await actingAs(db, { userId: member.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `update public.assessment_requests set status = 'completed' where app_id = $1`,
        [third],
      );
      // `assessment_requests_cancel_members` permits exactly one transition, so
      // this is refused by its `with check` rather than by a missing privilege.
      expect(message, 'a customer completed their own request').toMatch(
        /row-level security|permission denied/i,
      );
    });
  });
});
