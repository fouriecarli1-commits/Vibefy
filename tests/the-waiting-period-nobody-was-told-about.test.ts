/**
 * The free tier's waiting period, said on the page rather than on being refused.
 *
 * One assessment per application every ninety days is the free tier's rule, and
 * `nextAssessmentAvailable` has existed to answer the question it raises —
 * *when, then?* — since the entitlement table did. Its own comment says where
 * the answer goes:
 *
 *     Rendered beside the application rather than only refused at the moment
 *     of asking. "Available from 28 November" answers the question; a button
 *     that turns grey does not.
 *
 * Measured on 2026-10-11: the function appeared in `packages/billing/src/usage.ts`
 * and in its own unit test, and nowhere else in the repository. Nothing rendered
 * it. `/console/apps/[id]` showed a "Request an assessment" button that looked
 * exactly as available on day two as on day ninety-one, and the waiting period
 * arrived as a refusal after pressing it — the refusal built from its own copy
 * of the same two lines of arithmetic inside `decideAssessmentRequest`.
 *
 * So three things, which is what this file holds:
 *
 *   · the date is on the page, where the comment says it is;
 *   · the date on the page and the date in the refusal are one function, so
 *     they cannot differ by a day;
 *   · the plan behind that date is `planFor` — the rule `resolvePlan` hands the
 *     server action — and not a second reading of the same rows. The page has
 *     no pool and reads them through Supabase's client, which is exactly how a
 *     screen comes to show the free tier's waiting period on an application
 *     with a paid report, or an active plan from a cancelled subscription.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  decideAssessmentRequest,
  entitlementFor,
  invoiceStillPaid,
  nextAssessmentAvailable,
  planFor,
  resolvePlan,
  type PlanTier,
  type ResolvedPlan,
} from '../packages/billing/src/index.ts';
import { connect } from './setup/client.ts';
import { seedAccount, seedApp, type SeededAccount } from './setup/seed.ts';
import { withoutComments } from './setup/source.ts';

const page = withoutComments(
  readFileSync(join(process.cwd(), 'apps/web/app/console/apps/[id]/page.tsx'), 'utf8'),
);

const COMPLETED = new Date('2026-08-30T00:00:00Z');

describe('the page', () => {
  it('still has the button the question is about', () => {
    // A positive control. Every assertion below is about what sits beside this
    // form, and would pass vacuously on a page that no longer offers a run.
    expect(page).toContain('submitLabel="Request an assessment"');
  });

  it('asks when the next assessment is, and renders the answer', () => {
    expect(page).toContain('nextAssessmentAvailable(');
    // Rendered, not merely computed: the date reaches the markup.
    expect(/\{waiting\.until\.toISOString\(\)\.slice\(0, 10\)\}/.test(page)).toBe(true);
  });

  it('decides the plan with the rule the server action uses', () => {
    expect(page).toContain('planFor(');
    expect(page).toContain('invoiceStillPaid');

    // And asks about *that* plan. A literal here — `nextAssessmentAvailable('free', …)` —
    // would render the free tier's waiting period on an application with a paid
    // report, which is the failure the shared rule exists to prevent.
    const argument = /nextAssessmentAvailable\(([^,]+),/.exec(page)?.[1];
    expect(argument).toBeDefined();
    expect(argument).not.toMatch(/['"]/);
  });

  it('only shows the date while it is still in the future', () => {
    // A shape rather than a rendering: the suite has no renderer, and a page
    // that announced a waiting period which ended in August would be worse
    // than the silence this replaced.
    expect(page).toContain('nextAssessmentAt > new Date()');
  });
});

describe('the date', () => {
  it('is the one the refusal quotes', () => {
    const next = nextAssessmentAvailable('free', COMPLETED);
    expect(next).not.toBeNull();

    const refused = decideAssessmentRequest({
      plan: 'free',
      subscriptionStatus: null,
      appsInWorkspace: 1,
      previousAssessments: [{ completedAt: COMPLETED }],
      lastPaidAt: null,
      reTestsUsed: 0,
      appIsAuthorised: true,
      now: new Date('2026-09-01T00:00:00Z'),
    });

    expect(refused.allowed).toBe(false);
    expect(refused.refusal?.code).toBe('cooldown_active');
    // The same instant, and the same date in the sentence a customer reads.
    expect(refused.refusal?.retryAfter?.toISOString()).toBe(next!.toISOString());
    expect(refused.refusal?.message).toContain(next!.toISOString().slice(0, 10));
  });

  it('is the cooling-off period the entitlement table publishes', () => {
    const days = entitlementFor('free').cooldownDays;
    expect(days).not.toBeNull();
    const next = nextAssessmentAvailable('free', COMPLETED);
    expect(Math.round((next!.getTime() - COMPLETED.getTime()) / 86_400_000)).toBe(days);
  });

  it('is nothing at all on a plan with no waiting period, so the page says nothing', () => {
    for (const plan of ['one_off', 'certified', 'agency', 'organisation'] as PlanTier[]) {
      expect(nextAssessmentAvailable(plan, COMPLETED)).toBeNull();
    }
  });

  it('is nothing before the first assessment', () => {
    expect(nextAssessmentAvailable('free', null)).toBeNull();
  });
});

describe('the plan the page reads over REST', () => {
  let db: Client;
  let account: SeededAccount;
  let appId: string;

  beforeAll(async () => {
    db = await connect();
    account = await seedAccount(db, 'waiting-period');
    appId = await seedApp(db, account, 'Waiting period', { screening: 'cleared' });
  });

  afterAll(async () => {
    await db.end();
  });

  /** What the page reads: every subscription of the workspace, unfiltered. */
  const asThePageReadsIt = async (): Promise<ResolvedPlan> => {
    const subscriptions = await db.query<{ plan: PlanTier; status: string }>(
      `select plan, status from public.subscriptions where organisation_id = $1`,
      [account.organisationId],
    );
    const invoices = await db.query(
      `select status, amount_paid_cents, amount_refunded_cents
         from public.invoices where app_id = $1`,
      [appId],
    );
    return planFor({
      subscriptions: subscriptions.rows.map((row) => ({
        plan: row.plan,
        status: row.status as ResolvedPlan['subscriptionStatus'],
      })),
      appHasPaidReport: invoices.rows.some((row) =>
        invoiceStillPaid(row as Parameters<typeof invoiceStillPaid>[0]),
      ),
    });
  };

  const bothReaders = async () => ({
    page: await asThePageReadsIt(),
    action: await resolvePlan(db, { organisationId: account.organisationId, appId }),
  });

  it('agrees with the server action when nothing has been bought', async () => {
    const { page: shown, action } = await bothReaders();
    expect(shown).toEqual(action);
    expect(shown.plan).toBe('free');
    // Which is the case where the waiting period is real, and now visible.
    expect(nextAssessmentAvailable(shown.plan, COMPLETED)).not.toBeNull();
  });

  it('agrees that a paid report for this application has no waiting period', async () => {
    await db.query(
      `insert into public.invoices (organisation_id, amount_due_cents, amount_paid_cents,
                                    status, app_id, plan, issued_at, paid_at)
       values ($1, 7900, 7900, 'paid', $2, 'one_off', now(), now())`,
      [account.organisationId, appId],
    );
    const { page: shown, action } = await bothReaders();
    expect(shown).toEqual(action);
    expect(shown.plan).toBe('one_off');
    expect(nextAssessmentAvailable(shown.plan, COMPLETED)).toBeNull();
  });

  it('agrees that a refunded purchase buys nothing', async () => {
    await db.query(
      `update public.invoices set amount_refunded_cents = amount_paid_cents
                     where app_id = $1`,
      [appId],
    );
    const { page: shown, action } = await bothReaders();
    expect(shown).toEqual(action);
    expect(shown.plan).toBe('free');
    expect(nextAssessmentAvailable(shown.plan, COMPLETED)).not.toBeNull();
  });

  it('does not read a plan out of a cancelled subscription', async () => {
    // The page's own read has no status filter — row-level security is what
    // scopes it, and a cancelled row is still readable. `planFor` filters,
    // which is the whole reason the pick lives there and not in an `order by`.
    await db.query(
      `insert into public.subscriptions (organisation_id, plan, status, cancelled_at)
       values ($1, 'agency', 'cancelled', now())`,
      [account.organisationId],
    );
    const { page: shown, action } = await bothReaders();
    expect(shown).toEqual(action);
    expect(shown.plan).toBe('free');
    // A cancelled subscription says nothing at all, rather than "cancelled,
    // so the free tier applies until it is active again" — it will not become
    // active, and the page explains itself with this sentence.
    expect(shown.subscriptionStatus).toBeNull();
    expect(shown.because).toBe(
      'No purchase or active subscription applies, so the free tier applies.',
    );
  });

  it('agrees on an active subscription, which has no waiting period either', async () => {
    await db.query(
      `insert into public.subscriptions (organisation_id, plan, status) values ($1, 'certified', 'active')`,
      [account.organisationId],
    );
    const { page: shown, action } = await bothReaders();
    expect(shown).toEqual(action);
    expect(shown.plan).toBe('certified');
    expect(nextAssessmentAvailable(shown.plan, COMPLETED)).toBeNull();
  });
});
