/**
 * A finding cannot be declared away.
 *
 * `packages/assurance` turns an assessment into the nine questions a visitor
 * actually asks. Two of those questions ask whether they apply at all, and both
 * answer by reading what the *owner* told us about their own application:
 * `account_takeover` applies only if `declared.authentication`, `payments` only
 * if `declared.payments`.
 *
 * That is fine as a reason to say "there was nothing here to test". It is not
 * fine as a reason to discard something we found, and that is what it was doing:
 * `assuranceFor` decided the state from `applies` and the not-tested reasons
 * *before* it looked at the findings, so a published finding against the
 * question's own criteria never reached the page. The visitor was shown
 *
 *     Not tested — The owner says this application takes no payments, and we
 *     found no checkout to test.
 *
 * on an application where `trustFindings` had filed SEC-12 because it found a
 * card field in the application's own document. Both halves of that sentence
 * were false, and the owner's checkbox wrote them.
 *
 * This is not a hypothetical route. `packages/engine/src/stages/trust-checks.ts`
 * raises SEC-12 on `measurements.collectsCardDetails` alone — the declaration
 * is consulted only in the *other* branch, to explain an absence — and
 * `deterministic.ts` raises SEC-03, SEC-05 and SEC-11 with no reference to
 * `hasAuthentication` at all. The engine is right to work that way: a
 * declaration is a claim we go looking to confirm, never a fact we take on
 * trust. The list was the half that forgot.
 *
 * The same ordering hid a gate. `GATE-CRITICAL-SECURITY` is attached to
 * `account_takeover`, and an assessment that failed it on an application whose
 * owner ticked "no sign-in" reported the gate nowhere: the grid said "not
 * tested", and the grid is the only public surface a finding reaches.
 * `/a/[slug]` renders `AssuranceList` and nothing else that touches
 * `public.findings`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSURANCE_CLAIMS,
  assuranceFor,
  assuranceHeadline,
  type AssuranceInput,
} from '../packages/assurance/src/index.ts';
import { getRubric } from '../packages/rubric/src/rubric.ts';

const RUBRIC = '1.1.0';

const CRITERIA = getRubric(RUBRIC).dimensions.flatMap((dimension) =>
  dimension.criteria.map((criterion) => criterion.id),
);

const base: AssuranceInput = {
  appName: 'Kettle',
  assessedOn: '2026-09-24',
  rubricVersion: RUBRIC,
  depth: 'full',
  gateFailures: [],
  findings: [],
  rubricCriteria: CRITERIA,
  declared: { authentication: true, payments: true, personalData: true },
};

const lineFor = (id: string, input: AssuranceInput) =>
  assuranceFor(input).find((line) => line.claim.id === id)!;

/**
 * The criteria of a claim that the rubric under test actually defines.
 *
 * A finding has to be against a criterion the rubric has, or the coverage rules
 * take over for a different reason and the test stops being about declarations.
 */
function knownCriteriaOf(claimId: string): string[] {
  const claim = ASSURANCE_CLAIMS.find((candidate) => candidate.id === claimId)!;
  return claim.criteria.filter((id) => CRITERIA.includes(id));
}

describe('an owner’s declaration that a question does not apply', () => {
  it('does not discard a finding against that question', () => {
    // Exactly the shape trust-checks.ts produces: has_payments false, and a
    // card field found in the application's own page anyway.
    const ruleId = knownCriteriaOf('payments')[0];
    expect(ruleId).toBeDefined();

    const line = lineFor('payments', {
      ...base,
      declared: { ...base.declared, payments: false },
      findings: [{ ruleId: ruleId!, severity: 'high' }],
    });

    expect(line.state).toBe('checked_found');
    expect(line.findings).toHaveLength(1);
    // And the sentence that was false must be gone, not merely outvoted.
    expect(line.notTestedBecause).toBeNull();
  });

  it('is said out loud when we looked anyway and found something', () => {
    // A cross under "We looked at where a card number goes" is true but
    // incomplete: the reader is entitled to know the owner told us there was
    // nothing here. That sentence is the most useful one on the page — it is a
    // measurement contradicting a declaration — so it is not dropped.
    const ruleId = knownCriteriaOf('payments')[0]!;
    const line = lineFor('payments', {
      ...base,
      declared: { ...base.declared, payments: false },
      findings: [{ ruleId, severity: 'high' }],
    });

    expect(line.partialBecause).toMatch(/owner/i);
    expect(line.partialBecause).toMatch(/checked anyway|looked anyway/i);
  });

  it('does not discard a failed gate either', () => {
    const line = lineFor('account_takeover', {
      ...base,
      declared: { ...base.declared, authentication: false },
      gateFailures: ['GATE-CRITICAL-SECURITY'],
    });

    expect(line.state).toBe('checked_found');
    expect(line.gateFailed).toBe(true);
    expect(line.notTestedBecause).toBeNull();
  });

  it('still reads as not tested when nothing was found', () => {
    // The declaration keeps doing the job it is good for. An application with
    // no sign-in and no findings against the question is not given a tick
    // either — "not tested" is the honest answer and stays the answer.
    const line = lineFor('account_takeover', {
      ...base,
      declared: { ...base.declared, authentication: false },
    });

    expect(line.state).toBe('not_tested');
    expect(line.notTestedBecause).toMatch(/no sign-in/i);
    expect(line.partialBecause).toBeNull();
  });
});

describe('a gap in coverage', () => {
  it('does not discard a finding against the part that was covered', () => {
    const [covered] = knownCriteriaOf('usable');
    expect(covered).toBeDefined();

    const line = lineFor('usable', {
      ...base,
      findings: [{ ruleId: covered!, severity: 'medium' }],
      notTested: [{ criterion: covered!, because: 'The keyboard pass did not run.' }],
    });

    expect(line.state).toBe('checked_found');
    expect(line.partialBecause).toMatch(/not reached|did not run/i);
  });

  it('says which rubric version is short, rather than implying full coverage', () => {
    const claim = ASSURANCE_CLAIMS.find((candidate) => candidate.id === 'hostile_code')!;
    const known = knownCriteriaOf('hostile_code');
    // Only meaningful while this claim is genuinely half-covered; if a later
    // rubric defines both, this assertion has nothing to say and says so.
    if (known.length === 0 || known.length === claim.criteria.length) {
      expect(known.length).toBe(claim.criteria.length);
      return;
    }

    const line = lineFor('hostile_code', {
      ...base,
      findings: [{ ruleId: known[0]!, severity: 'critical' }],
    });

    expect(line.state).toBe('checked_found');
    expect(line.partialBecause).toContain(RUBRIC);
    expect(line.partialBecause).toMatch(/part of this/i);
  });
});

describe('the headline', () => {
  it('counts a question we looked at despite the declaration', () => {
    const ruleId = knownCriteriaOf('payments')[0]!;
    const input: AssuranceInput = {
      ...base,
      declared: { ...base.declared, payments: false },
      findings: [{ ruleId, severity: 'high' }],
    };
    const lines = assuranceFor(input);

    expect(assuranceHeadline(input, lines)).toMatch(/turned something up/);
  });
});

describe('an info finding', () => {
  it('does not override a declaration that the question does not apply', () => {
    // `info` scores nothing and is not a problem. It must not turn "not tested"
    // into "something found" any more than it may turn a tick into a cross —
    // the whole reason the severity filter exists.
    const ruleId = knownCriteriaOf('payments')[0]!;
    const line = lineFor('payments', {
      ...base,
      declared: { ...base.declared, payments: false },
      findings: [{ ruleId, severity: 'info' }],
    });

    expect(line.state).toBe('not_tested');
  });
});

describe('the page', () => {
  it('prints the shortfall rather than leaving it to be inferred', () => {
    // A value on the line that no component reads is a correction nobody sees.
    const component = readFileSync(
      join(process.cwd(), 'apps/web/components/assurance-list.tsx'),
      'utf8',
    );
    expect(component).toContain('line.partialBecause');
    expect(component).toContain('How much of this was covered');
  });
});
