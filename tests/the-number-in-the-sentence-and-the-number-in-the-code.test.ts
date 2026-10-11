/**
 * How many findings a free report shows, said in prose in three places.
 *
 * `FREE_TIER_FINDING_LIMIT` is a private constant in `packages/report/src/redact.ts`
 * and nothing publishes it. What is published is the word:
 *
 *   · `config/pricing.json`, the free tier — "Headline score and top three findings";
 *   · `CAPABILITIES` in `packages/billing/src/usage.ts`, which `/console/billing`
 *     renders — "Headline and top three findings";
 *   · the report itself — "A free report shows the three most serious findings."
 *
 * Three sentences and a number, with nothing joining them. Raise the limit to
 * five and all three go on saying three; lower it to two and they promise a
 * finding the report does not contain, in the only document where the promise
 * is actually made to the person who paid nothing for it.
 *
 * The same shape, already half-joined, for the re-test:
 * `tests/the-credit-that-was-never-spent.test.ts` holds
 * `legal/refund-and-cancellation.md` to `reTestCredits` and `reTestWindowDays`.
 * The two other places that make that promise — the pricing tier and the list
 * of what a free report is missing — were not in that join, and the second one
 * is the sentence a free reader is shown.
 *
 * Measured rather than read: the limit is counted off `redactForTier`, so the
 * number this file compares against is the one a report is actually cut to.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, entitlementFor } from '../packages/billing/src/index.ts';
import {
  redactForTier,
  type ReportFinding,
  type ReportSource,
} from '../packages/report/src/index.ts';

const WORDS: Readonly<Record<number, string>> = {
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
};

const pricing = JSON.parse(readFileSync('config/pricing.json', 'utf8')) as {
  tiers: { id: string; contents: string }[];
};
const tierContents = (id: string) => {
  const tier = pricing.tiers.find((row) => row.id === id);
  if (!tier) throw new Error(`No ${id} tier in config/pricing.json`);
  return tier.contents;
};

const finding = (ruleId: string, severity: ReportFinding['severity']): ReportFinding => ({
  id: `f-${ruleId}`,
  ruleId,
  dimension: 'security_posture',
  severity,
  confidence: 'high',
  title: `Something about ${ruleId}`,
  description: 'A description.',
  remediation: 'A step.',
  evidence: [],
});

const source: ReportSource = {
  assessmentId: '11111111-2222-3333-4444-555555555555',
  appName: 'Kettle',
  appUrl: 'https://kettle.example',
  organisationName: 'Kettle Ltd',
  rubricVersion: '1.0.0',
  assessedOn: '2026-08-22',
  reviewedOn: '2026-08-22',
  overallScore: 46.25,
  band: 'Weak',
  certificationEligible: false,
  certificationBlockers: [],
  dimensions: [],
  // Eight, so the limit is a cut rather than the whole list.
  findings: [
    finding('SEC-01', 'critical'),
    finding('SEC-02', 'critical'),
    finding('SEC-03', 'high'),
    finding('SEC-04', 'high'),
    finding('SEC-05', 'medium'),
    finding('SEC-06', 'medium'),
    finding('SEC-07', 'low'),
    finding('SEC-08', 'info'),
  ],
  narrative: null,
  notTested: [],
  stages: [],
  scopeStatement: 'A scope statement.',
  promptBundleSha256: 'b'.repeat(64),
  intendedForAppStore: false,
};

/** What a free report is cut to, counted off the function that cuts it. */
const free = redactForTier(source, 'free');
const LIMIT = free.findings.length;

describe('the free tier finding limit', () => {
  it('is a cut, and this file would be vacuous without one', () => {
    // The positive control: eight findings in, fewer out, and the rest counted
    // rather than dropped silently.
    expect(source.findings.length).toBeGreaterThan(LIMIT);
    expect(free.hiddenFindingCount).toBe(source.findings.length - LIMIT);
    expect(WORDS[LIMIT]).toBeDefined();
  });

  it('is the number the pricing tier promises', () => {
    expect(tierContents('free')).toContain(`top ${WORDS[LIMIT]} findings`);
  });

  it('is the number the plan comparison promises', () => {
    const report = CAPABILITIES.find((capability) => capability.label === 'Report');
    expect(report).toBeDefined();
    expect(report!.describe(entitlementFor('free'))).toContain(`top ${WORDS[LIMIT]} findings`);
  });

  it('is the number the report itself states', () => {
    const render = readFileSync('packages/report/src/render.ts', 'utf8');
    expect(render).toContain(`A free report shows the ${WORDS[LIMIT]} most serious findings.`);
  });
});

describe('the re-test a free report says it is missing', () => {
  const entitlement = entitlementFor('one_off');
  const promise = `${WORDS[entitlement.reTestCredits]} free re-test within ${entitlement.reTestWindowDays} days`;

  it('is the entitlement, in the list a free reader is shown', () => {
    // `withheld` is rendered as "The full report adds:". It is the only place
    // the promise reaches somebody who has not bought anything yet.
    expect(free.withheld.map((line) => line.toLowerCase())).toContain(promise);
  });

  it('is the entitlement, in the tier that sells it', () => {
    expect(tierContents('one_off').toLowerCase()).toContain(promise);
  });
});
