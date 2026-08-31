/**
 * What a plan gives, and how much of it has been used.
 *
 * The billing page could already say what each plan costs and what it contains.
 * What it could not say is the thing a customer actually wants to know a month
 * later: how much of it is left. A re-test credit that exists only in the
 * entitlement table is a credit nobody knows they have, and an application
 * allowance you cannot see is one you discover by being refused.
 *
 * Pure functions on purpose. Reading rows out of the database and deciding what
 * they mean are two jobs, and only the second one is worth testing exhaustively.
 */
import { entitlementFor, type Entitlement, type PlanTier } from './entitlements.ts';

/**
 * One capability, phrased the same way for every plan so a reader can compare
 * down a column rather than across paragraphs.
 */
export interface Capability {
  readonly label: string;
  readonly describe: (entitlement: Entitlement) => string;
}

export const CAPABILITIES: readonly Capability[] = [
  {
    label: 'Assessment depth',
    describe: (entitlement) => entitlement.depth,
  },
  {
    label: 'Report',
    describe: (entitlement) =>
      entitlement.reportTier === 'paid' ? 'Full, with evidence' : 'Headline and top three findings',
  },
  {
    label: 'Evidence artefacts',
    describe: (entitlement) => (entitlement.evidenceArtefacts ? 'Included' : 'Not included'),
  },
  {
    label: 'PDF export',
    describe: (entitlement) => (entitlement.pdfExport ? 'Included' : 'Not included'),
  },
  {
    label: 'Badge',
    describe: (entitlement) => (entitlement.badgeEligible ? 'Eligible' : 'Not eligible'),
  },
  {
    label: 'Applications',
    describe: (entitlement) =>
      entitlement.maxApps === null ? 'No limit' : `Up to ${entitlement.maxApps}`,
  },
  {
    label: 'Free re-tests',
    describe: (entitlement) =>
      entitlement.reTestCredits === 0
        ? 'None'
        : `${entitlement.reTestCredits} within ${entitlement.reTestWindowDays} days`,
  },
  {
    label: 'Waiting period',
    describe: (entitlement) =>
      entitlement.cooldownDays === null
        ? 'None'
        : `One assessment per application every ${entitlement.cooldownDays} days`,
  },
  {
    label: 'Cost ceiling per run',
    describe: (entitlement) => `$${entitlement.maxRunCostUsd.toFixed(2)}`,
  },
];

export interface UsageInput {
  readonly plan: PlanTier;
  readonly appsInWorkspace: number;
  /** Paid assessments, most recent first. Only the most recent one opens a window. */
  readonly lastPaidAssessmentAt: Date | null;
  /** Free re-tests already taken since that paid assessment. */
  readonly reTestsUsed: number;
  readonly now?: Date;
}

/**
 * A consumable allowance and how much of it is gone.
 *
 * `limit` of null means there is nothing to run out of, which is a different
 * statement from "you have used none of it" and is rendered differently.
 */
export interface UsageMeter {
  readonly label: string;
  readonly used: number;
  readonly limit: number | null;
  readonly detail: string;
}

export function usageMeters(input: UsageInput): UsageMeter[] {
  const entitlement = entitlementFor(input.plan);
  const now = input.now ?? new Date();
  const meters: UsageMeter[] = [
    {
      label: 'Applications',
      used: input.appsInWorkspace,
      limit: entitlement.maxApps,
      detail:
        entitlement.maxApps === null
          ? 'This plan does not limit how many applications you add.'
          : `${entitlement.maxApps} on this plan.`,
    },
  ];

  if (entitlement.reTestCredits > 0) {
    const window = reTestWindow(entitlement, input.lastPaidAssessmentAt);
    const open = window !== null && window > now;
    meters.push({
      label: 'Free re-tests',
      // A credit outside its window is not a credit you still hold, so the meter
      // shows it spent rather than pretending it is available.
      used: open
        ? Math.min(input.reTestsUsed, entitlement.reTestCredits)
        : entitlement.reTestCredits,
      limit: entitlement.reTestCredits,
      detail: open
        ? `Until ${window.toISOString().slice(0, 10)}, ${entitlement.reTestWindowDays} days after your last paid assessment.`
        : input.lastPaidAssessmentAt
          ? 'The window after your last paid assessment has closed.'
          : 'The window opens when you buy an assessment.',
    });
  }

  return meters;
}

/** When the free re-test window closes, or null if it never opened. */
export function reTestWindow(entitlement: Entitlement, lastPaidAt: Date | null): Date | null {
  if (!lastPaidAt || entitlement.reTestCredits === 0) return null;
  const ends = new Date(lastPaidAt);
  ends.setUTCDate(ends.getUTCDate() + entitlement.reTestWindowDays);
  return ends;
}

/**
 * When this application may next be assessed, or null if there is no wait.
 *
 * Rendered beside the application rather than only refused at the moment of
 * asking. "Available from 28 November" answers the question; a button that
 * turns grey does not.
 */
export function nextAssessmentAvailable(plan: PlanTier, lastCompletedAt: Date | null): Date | null {
  const entitlement = entitlementFor(plan);
  if (entitlement.cooldownDays === null || !lastCompletedAt) return null;
  const next = new Date(lastCompletedAt);
  next.setUTCDate(next.getUTCDate() + entitlement.cooldownDays);
  return next;
}
