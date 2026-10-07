/**
 * What the verification page shows when a criterion could not be established.
 *
 * `trust-checks.ts` opens by saying why it exists: "the verification page turns
 * 'no findings against this criterion' into a tick — so a criterion that
 * nothing checks does not produce a blank, it produces a *pass*, for something
 * nobody looked at. That is the one failure this product cannot survive."
 *
 * SEC-12 was fixed for exactly that and says so in its own note. PRI-07, one
 * criterion along in the same file, still does it.
 *
 * `measureTrust` reports `contactOutcome: 'unclear'` when nothing was found and
 * something was ambiguous — a company name with no registration number, a
 * string that might be a telephone number and might be a reference. That is the
 * ordinary shape of a small company's landing page. `trustFindings` then raises
 * no finding, records nothing as not tested, and `assuranceFor` turns the
 * silence into `checked_clear`: a tick against "can somebody reach a person
 * here?" on a page where we could not tell.
 *
 * Worse than a wrong answer, because a tick is the thing the badge is for.
 */
import { describe, expect, it } from 'vitest';
import {
  trustFindings,
  type TrustMeasurements,
} from '../packages/engine/src/stages/trust-checks.ts';

const measurements = (over: Partial<TrustMeasurements> = {}): TrustMeasurements => ({
  scriptHosts: [],
  minerHosts: [],
  minerSignatures: [],
  inlineScriptTruncated: false,
  collectsCardDetails: false,
  processorFramePresent: false,
  processorsPresent: [],
  checkoutObserved: false,
  contactRoutes: [],
  contactOutcome: 'found',
  ...over,
});

const run = (over: Partial<TrustMeasurements>) =>
  trustFindings(measurements(over), { payments: false }, ['evidence-1']);

describe('PRI-07, when nobody could be reached', () => {
  it('is a finding', () => {
    const outcome = run({ contactOutcome: 'not_found' });
    expect(outcome.findings.map((finding) => finding.ruleId)).toContain('PRI-07');
  });
});

describe('PRI-07, when the page was ambiguous about it', () => {
  const outcome = () => run({ contactOutcome: 'unclear' });

  it('is not a finding, because we did not establish one', () => {
    expect(outcome().findings.map((finding) => finding.ruleId)).not.toContain('PRI-07');
  });

  it('is not a pass either, which is what silence makes it', () => {
    // The whole defect in one assertion. No finding and no entry means
    // `checked_clear`, which renders as a tick.
    expect(outcome().notTested.map((entry) => entry.criterion)).toContain('PRI-07');
  });

  it('says what was ambiguous rather than only that something was', () => {
    const entry = outcome().notTested.find((item) => item.criterion === 'PRI-07');
    expect(entry?.because).toMatch(/could not|not established|ambiguous/i);
  });
});

describe('PRI-07, when somebody could be reached', () => {
  it('is left alone, and is neither a finding nor an open question', () => {
    const outcome = run({ contactOutcome: 'found', contactRoutes: ['contact_email'] });
    expect(outcome.findings.map((finding) => finding.ruleId)).not.toContain('PRI-07');
    expect(outcome.notTested.map((entry) => entry.criterion)).not.toContain('PRI-07');
  });
});
