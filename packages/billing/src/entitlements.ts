/**
 * What a plan permits.
 *
 * Entitlements decide **coverage and access**: how deep an assessment runs, how
 * often it may run, what the report shows, and whether a PDF or a badge is
 * available. They never decide a score, and nothing in this module is reachable
 * from `@vibefycode/rubric` — a test asserts that, because a promise about scoring
 * is only worth what enforces it.
 *
 * Read the vocabulary carefully: `depth` is how much of the pipeline runs.
 * A limited run does fewer stages, so it produces fewer findings — but each
 * finding it does produce is scored exactly as it would be on any other plan.
 */
import pricing from '../../../config/pricing.json' with { type: 'json' };

export type PlanTier = 'free' | 'one_off' | 'certified' | 'agency' | 'organisation';
export type AssessmentDepth = 'limited' | 'full' | 'continuous';
export type ReportTier = 'free' | 'paid';

export interface Entitlement {
  readonly plan: PlanTier;
  readonly depth: AssessmentDepth;
  readonly reportTier: ReportTier;
  readonly pdfExport: boolean;
  readonly evidenceArtefacts: boolean;
  readonly badgeEligible: boolean;
  /** Days between assessments of the same app. Null means no cooling-off period. */
  readonly cooldownDays: number | null;
  /** Free re-tests included after a completed assessment. */
  readonly reTestCredits: number;
  readonly reTestWindowDays: number;
  readonly maxApps: number | null;
  readonly maxRunCostUsd: number;
}

const CEILINGS = pricing.ceilings.perRunCostUsd as Record<AssessmentDepth, number>;

export const ENTITLEMENTS: Readonly<Record<PlanTier, Entitlement>> = {
  free: {
    plan: 'free',
    depth: 'limited',
    reportTier: 'free',
    pdfExport: false,
    evidenceArtefacts: false,
    badgeEligible: false,
    // One per app per 90 days. A free tier without a cooling-off period is a
    // free tier that funds someone else's continuous monitoring.
    cooldownDays: 90,
    reTestCredits: 0,
    reTestWindowDays: 0,
    maxApps: 3,
    maxRunCostUsd: CEILINGS.limited,
  },
  one_off: {
    plan: 'one_off',
    depth: 'full',
    reportTier: 'paid',
    pdfExport: true,
    evidenceArtefacts: true,
    badgeEligible: true,
    cooldownDays: null,
    reTestCredits: 1,
    reTestWindowDays: 30,
    maxApps: null,
    maxRunCostUsd: CEILINGS.full,
  },
  certified: {
    plan: 'certified',
    depth: 'continuous',
    reportTier: 'paid',
    pdfExport: true,
    evidenceArtefacts: true,
    badgeEligible: true,
    cooldownDays: null,
    reTestCredits: 2,
    reTestWindowDays: 30,
    maxApps: null,
    maxRunCostUsd: CEILINGS.continuous,
  },
  agency: {
    plan: 'agency',
    depth: 'continuous',
    reportTier: 'paid',
    pdfExport: true,
    evidenceArtefacts: true,
    badgeEligible: true,
    cooldownDays: null,
    reTestCredits: 4,
    reTestWindowDays: 30,
    maxApps: null,
    maxRunCostUsd: CEILINGS.continuous,
  },
  organisation: {
    plan: 'organisation',
    depth: 'continuous',
    reportTier: 'paid',
    pdfExport: true,
    evidenceArtefacts: true,
    badgeEligible: true,
    cooldownDays: null,
    reTestCredits: 8,
    reTestWindowDays: 30,
    maxApps: null,
    maxRunCostUsd: CEILINGS.continuous,
  },
};

/**
 * Every plan, cheapest first.
 *
 * Derived from `ENTITLEMENTS` rather than written out again: a hand-kept second
 * list is a list that loses a tier the day one is added, and the surface that
 * reads this is the operator's plan picker — where a missing option looks like
 * the plan does not exist.
 */
export const PLAN_TIERS = Object.keys(ENTITLEMENTS) as readonly PlanTier[];

export function entitlementFor(plan: PlanTier): Entitlement {
  const entitlement = ENTITLEMENTS[plan];
  if (!entitlement) throw new Error(`No entitlement defined for plan "${plan}".`);
  return entitlement;
}

export type RefusalCode =
  | 'cooldown_active'
  | 'app_limit_reached'
  | 'subscription_inactive'
  | 'credit_required'
  | 'not_authorised';

export interface AssessmentRequestContext {
  readonly plan: PlanTier;
  readonly subscriptionStatus:
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'paused'
    | 'cancelled'
    | 'incomplete'
    | null;
  readonly appsInWorkspace: number;
  /**
   * Completed assessments of this app, newest first.
   *
   * The free tier's cooling-off period is the only thing that reads this now.
   * The re-test window used to as well, and that is what broke it — see
   * `reTestWindow` below.
   */
  readonly previousAssessments: readonly { readonly completedAt: Date; readonly paid: boolean }[];
  /**
   * When this application's purchase was paid, which is when its re-test
   * window starts. Null when nothing has been bought for it.
   */
  readonly lastPaidAt: Date | null;
  /** How many re-tests have been taken since that payment. */
  readonly reTestsUsed: number;
  readonly appIsAuthorised: boolean;
  readonly now?: Date;
}

/**
 * When the free re-tests stop being free.
 *
 * Measured in days from the **payment**, not from the last assessment, and the
 * difference is the whole of this: with the window measured from the last
 * assessment, using a re-test moved the window, so a customer who assessed once
 * a month had a window that never closed.
 *
 * Defined here rather than in `usage.ts` because the meter a customer reads and
 * the decision that grants the credit have to be the same arithmetic. They were
 * not. `usage.ts` computed it from `lastPaidAssessmentAt` and
 * `decideAssessmentRequest` computed it from `previousAssessments[0]`, and the
 * screen showed one answer while the decision used another.
 */
export function reTestWindow(entitlement: Entitlement, lastPaidAt: Date | null): Date | null {
  if (!lastPaidAt || entitlement.reTestCredits === 0) return null;
  const ends = new Date(lastPaidAt);
  ends.setUTCDate(ends.getUTCDate() + entitlement.reTestWindowDays);
  return ends;
}

export interface EntitlementDecision {
  readonly allowed: boolean;
  readonly depth: AssessmentDepth;
  readonly reportTier: ReportTier;
  readonly maxRunCostUsd: number;
  readonly usesReTestCredit: boolean;
  readonly refusal?: {
    readonly code: RefusalCode;
    readonly message: string;
    readonly retryAfter?: Date;
  };
}

/**
 * The one place that decides whether an assessment may run and how deep it goes.
 *
 * Authorisation is checked first, and separately, because it is not a
 * commercial question: an unauthorised target is refused on every plan, and no
 * amount of money changes that.
 */
export function decideAssessmentRequest(context: AssessmentRequestContext): EntitlementDecision {
  const entitlement = entitlementFor(context.plan);
  const now = context.now ?? new Date();
  const base = {
    depth: entitlement.depth,
    reportTier: entitlement.reportTier,
    maxRunCostUsd: entitlement.maxRunCostUsd,
    usesReTestCredit: false,
  };

  if (!context.appIsAuthorised) {
    return {
      ...base,
      allowed: false,
      refusal: {
        code: 'not_authorised',
        message:
          'This application has no verified, unexpired authorisation to test. No plan changes that — complete ownership verification first.',
      },
    };
  }

  if (context.plan !== 'free') {
    const active =
      context.subscriptionStatus === 'active' || context.subscriptionStatus === 'trialing';
    const oneOff = context.plan === 'one_off';
    if (!active && !oneOff) {
      return {
        ...base,
        allowed: false,
        refusal: {
          code: 'subscription_inactive',
          message: `Your subscription is ${context.subscriptionStatus ?? 'not set up'}. Reactivate it to run an assessment.`,
        },
      };
    }
  }

  if (entitlement.maxApps !== null && context.appsInWorkspace > entitlement.maxApps) {
    return {
      ...base,
      allowed: false,
      refusal: {
        code: 'app_limit_reached',
        message: `The free tier covers ${entitlement.maxApps} applications. Remove one or upgrade.`,
      },
    };
  }

  const last = context.previousAssessments[0];
  if (entitlement.cooldownDays !== null && last) {
    const nextAllowed = new Date(last.completedAt);
    nextAllowed.setUTCDate(nextAllowed.getUTCDate() + entitlement.cooldownDays);
    if (nextAllowed > now) {
      return {
        ...base,
        allowed: false,
        refusal: {
          code: 'cooldown_active',
          message: `A free assessment of this application ran on ${last.completedAt.toISOString().slice(0, 10)}. The next free one is available from ${nextAllowed.toISOString().slice(0, 10)}; a paid report has no waiting period.`,
          retryAfter: nextAllowed,
        },
      };
    }
  }

  /*
   * A re-test inside the window is free, and is spent explicitly rather than
   * silently, so a customer can see that it was used.
   *
   * ## What this did instead, measured on 2026-10-11
   *
   * It was:
   *
   *     const last = context.previousAssessments[0];
   *     if (entitlement.reTestCredits > 0 && last?.paid) {
   *       const windowEnds = last.completedAt + reTestWindowDays;
   *       const creditsUsed = context.previousAssessments.filter(
   *         (a) => !a.paid && a.completedAt > last.completedAt,
   *       ).length;
   *
   * Three things were wrong and each hid the next.
   *
   *   · `creditsUsed` counts assessments completed strictly **after the most
   *     recent one**, which is empty by construction. It was always zero, for
   *     every plan. A credit was never spent, so `reTestCredits` — 1, 2, 4, 8
   *     — never mattered.
   *   · The window ran from the most recent assessment rather than from the
   *     payment, so taking a re-test moved the window forward thirty days.
   *     Assess once a month and it never closes.
   *   · `paid` on a history row is `exists (an invoice for this app paid before
   *     this assessment completed)`, which is true of every assessment after
   *     the first purchase — including the free re-tests. So `last?.paid` was
   *     true for all of them and the guard let every one through.
   *
   * Measured rather than read: a one-off purchase with five runs a month apart
   * returned `usesReTestCredit: true` on the sixth, five months after the
   * purchase, with the single included credit long gone. The meter on
   * `/console/billing` clamped the count it displays to the limit, so the one
   * screen that would have shown it showed "1 of 1".
   *
   * `tests/billing.test.ts` had a case called "stops spending credits once they
   * are used up" and it passed — on a history whose newest row carried
   * `paid: false`, which that query cannot produce once anything is bought.
   *
   * Now: the window comes from the payment, and the credits spent are counted
   * by the same rule the meter counts them by, which is `uses_retest_credit`
   * on the assessments since that payment.
   */
  if (entitlement.reTestCredits > 0) {
    const windowEnds = reTestWindow(entitlement, context.lastPaidAt);
    if (windowEnds && windowEnds > now && context.reTestsUsed < entitlement.reTestCredits) {
      return { ...base, allowed: true, usesReTestCredit: true };
    }
  }

  return { ...base, allowed: true };
}

// ---------------------------------------------------------------------------
// Resolving what a customer is entitled to, from what they have actually bought
// ---------------------------------------------------------------------------

/** The smallest database surface this needs. `pg.PoolClient` satisfies it. */
export interface EntitlementSql {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface ResolvedPlan {
  readonly plan: PlanTier;
  readonly entitlement: Entitlement;
  readonly subscriptionStatus:
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'paused'
    | 'cancelled'
    | 'incomplete'
    | null;
  /** Why they got this plan, so the console can explain it rather than assert it. */
  readonly because: string;
}

/**
 * A one-off purchase attaches to the app it was bought for, so buying a deep
 * report on one application does not silently upgrade every other application
 * in the workspace. A subscription covers the whole workspace.
 */
export async function resolvePlan(
  sql: EntitlementSql,
  input: { organisationId: string; appId?: string | null },
): Promise<ResolvedPlan> {
  const subscription = await sql.query<{
    plan: PlanTier;
    status: ResolvedPlan['subscriptionStatus'];
  }>(
    `select plan, status from public.subscriptions
      where organisation_id = $1 and status in ('trialing', 'active', 'past_due', 'paused')
      order by case status when 'active' then 0 when 'trialing' then 1 else 2 end
      limit 1`,
    [input.organisationId],
  );

  const live = subscription.rows[0];
  if (live && (live.status === 'active' || live.status === 'trialing') && live.plan !== 'free') {
    return {
      plan: live.plan,
      entitlement: entitlementFor(live.plan),
      subscriptionStatus: live.status,
      because: `An active ${live.plan} subscription covers this workspace.`,
    };
  }

  if (input.appId) {
    const purchase = await sql.query<{ id: string }>(
      `select id from public.invoices
        where organisation_id = $1 and app_id = $2 and status = 'paid'
          and amount_paid_cents > amount_refunded_cents
        limit 1`,
      [input.organisationId, input.appId],
    );
    if (purchase.rows.length > 0) {
      return {
        plan: 'one_off',
        entitlement: entitlementFor('one_off'),
        subscriptionStatus: live?.status ?? null,
        because: 'A deep report was purchased for this application.',
      };
    }
  }

  return {
    plan: 'free',
    entitlement: entitlementFor('free'),
    subscriptionStatus: live?.status ?? null,
    because: live
      ? `Your subscription is ${live.status}, so the free tier applies until it is active again.`
      : 'No purchase or active subscription applies, so the free tier applies.',
  };
}
