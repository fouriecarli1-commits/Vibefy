/**
 * The statement we draft, and the four things we refuse to write.
 *
 * Every larger organisation publishes an accessibility statement and every
 * small one knows it should. They are usually written from a template, which is
 * why so many of them claim conformance with a standard nobody checked them
 * against. Drafting one from a real assessment is the only thing that makes it
 * worth anything — and it puts us one careless sentence away from publishing a
 * claim, under a customer's name, that we cannot support.
 *
 * So two refusals are held here rather than intended.
 *
 * It never drafts "fully conformant". An automated pass plus a human review
 * finds a minority of real barriers, and full conformance is a claim about
 * every page and every assistive technology, including the ones nobody opened.
 *
 * And the parts only the publisher can answer are left visibly empty. A
 * statement pointing at an unread inbox is the commonest way one of these
 * becomes untrue, and a date invented on somebody's behalf is a promise made
 * with their name on it.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCESSIBILITY_CRITERIA,
  STATEMENT_DISCLAIMER,
  draftAccessibilityStatement,
  type StatementInput,
} from '../packages/report/src/index.ts';
import type { ReportFinding } from '../packages/report/src/types.ts';

const finding = (overrides: Partial<ReportFinding> = {}): ReportFinding => ({
  id: 'f1',
  ruleId: 'UX-03',
  dimension: 'practicality_ux',
  severity: 'medium',
  confidence: 'high',
  title: 'Text below the readable contrast threshold',
  description: 'Body text is rendered at 2.8:1 against its background on the pricing page.',
  remediation: 'Darken the text until the ratio passes.',
  evidence: [],
  ...overrides,
});

const input = (findings: ReportFinding[]): StatementInput => ({
  appName: 'Kettle',
  organisationName: 'Kettle Ltd',
  assessedOn: '2026-09-19',
  rubricVersion: '1.1.0',
  findings,
  scopeStatement: 'This assessment covered the web application at kettle.example on 2026-09-19.',
});

describe('what it will and will not claim', () => {
  it('never drafts full conformance, even with nothing found', () => {
    // The sentence that would do the damage, and the one a template would
    // produce without thinking about it.
    const draft = draftAccessibilityStatement(input([]));
    expect(draft.markdown).not.toMatch(/fully conformant/i);
    expect(draft.conformance).toBe('none_found');
    expect(draft.markdown).toMatch(/not the same as conforming fully/i);
  });

  it('says partially conformant when something was found', () => {
    const draft = draftAccessibilityStatement(input([finding()]));
    expect(draft.conformance).toBe('partially_conformant');
    expect(draft.markdown).toMatch(/partially conformant/i);
  });

  it('says it does not conform when something serious was found', () => {
    // A statement that calls a serious barrier partial conformance is the kind
    // of wording that gets its publisher into trouble rather than out of it.
    for (const severity of ['critical', 'high'] as const) {
      const draft = draftAccessibilityStatement(input([finding({ severity })]));
      expect(draft.conformance, severity).toBe('non_conformant');
      expect(draft.markdown, severity).toMatch(/does \*\*not\*\* conform/i);
    }
  });

  it('does not count an observation that scores nothing as a barrier', () => {
    // `info` findings exist so that something can be recorded without moving a
    // score. Promoting one into a public legal claim would be the same mistake
    // in the other direction.
    const draft = draftAccessibilityStatement(input([finding({ severity: 'info' })]));
    expect(draft.barriers).toEqual([]);
    expect(draft.conformance).toBe('none_found');
  });

  it('looks only at the criteria that are about being able to use it', () => {
    const draft = draftAccessibilityStatement(
      input([finding({ ruleId: 'SEC-02', title: 'Session cookie readable by script' })]),
    );
    expect(draft.barriers).toEqual([]);
    expect(draft.markdown).not.toMatch(/Session cookie/);
  });

  it('names the criterion behind each barrier, so a reader can check it', () => {
    const draft = draftAccessibilityStatement(input([finding()]));
    expect(draft.markdown).toContain('criterion UX-03');
  });

  it('agrees with the rubric about which criteria those are', () => {
    // A criterion that is about accessibility and is missing from this list is
    // a barrier that never reaches the statement.
    expect(ACCESSIBILITY_CRITERIA).toContain('UX-03');
    expect(ACCESSIBILITY_CRITERIA).toContain('UX-04');
    expect(ACCESSIBILITY_CRITERIA).not.toContain('UX-07');
  });
});

describe('the parts we will not write', () => {
  const draft = draftAccessibilityStatement(input([finding()]));

  it('leaves every one of them visibly empty', () => {
    for (const gap of draft.gaps) {
      expect(draft.markdown, gap.placeholder).toContain(gap.placeholder);
    }
    expect(draft.gaps.length).toBeGreaterThanOrEqual(4);
  });

  it('says why each one is ours to leave alone', () => {
    for (const gap of draft.gaps) {
      expect(gap.why.length, gap.placeholder).toBeGreaterThan(60);
    }
  });

  it('leaves the two that carry legal weight', () => {
    // How somebody reports a barrier and what happens if nobody answers. Those
    // are the parts of a statement that are actually enforceable, and they
    // depend on where the publisher and their users are.
    const placeholders = draft.gaps.map((gap) => gap.placeholder);
    expect(placeholders).toContain('[YOUR FEEDBACK ROUTE]');
    expect(placeholders).toContain('[YOUR ENFORCEMENT PROCEDURE]');
  });

  it('invents no date for fixing anything', () => {
    // A date is a commitment, and putting one in on somebody's behalf makes a
    // promise with their name on it.
    expect(draft.markdown).toContain('[YOUR PLAN AND DATES]');
    expect(draft.markdown).not.toMatch(/will be fixed by \d/i);
  });
});

describe('what it says about itself', () => {
  const draft = draftAccessibilityStatement(input([]));

  it('calls itself a draft in its first two lines', () => {
    // PART 11 of the brief: drafted legal text is never presented as final or
    // as legal advice. Somebody who copies the top of this file still copies
    // the sentence saying what it is.
    expect(draft.markdown.split('\n').slice(0, 3).join(' ')).toMatch(/this is a draft/i);
    expect(draft.disclaimer).toBe(STATEMENT_DISCLAIMER);
    expect(draft.disclaimer).toMatch(/not legal advice/i);
  });

  it('says it is the publisher’s statement rather than ours', () => {
    expect(draft.disclaimer).toMatch(/not a statement VibefyCode makes/i);
    expect(draft.disclaimer).toMatch(/publish under your own name/i);
  });

  it('warns that publishing it with the gaps still in is worse than nothing', () => {
    expect(draft.disclaimer).toMatch(/worse than none/i);
  });

  it('carries the scope of the assessment it was drafted from', () => {
    // Without it, a statement drafted from a check of one page reads as a
    // statement about a whole application.
    expect(draft.markdown).toContain('This assessment covered the web application at');
  });

  it('tells somebody to review it, and how often', () => {
    expect(draft.markdown).toMatch(/at least once a year/i);
  });
});
