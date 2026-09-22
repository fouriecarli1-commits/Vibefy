/**
 * The tick list the badge sends people to.
 *
 * Anré asked for a list telling a visitor that an application is safe code,
 * virus-free and compliant. That list would be worth nothing, and not because a
 * rule forbids it: it is the same list every scam publishes about itself. A
 * sceptical visitor has read "100% secure, no viruses, fully compliant" on the
 * worst sites on the internet, which is exactly why they are looking for a
 * second opinion in the first place.
 *
 * So each line says what was tested, when, what was found, and what it does not
 * mean. These tests hold that shape, and they hold the one failure that would
 * make the whole thing worthless: a tick for something nobody checked.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSURANCE_CLAIMS,
  ASSURANCE_LEGEND,
  VERIFICATION_STEPS,
  assuranceFor,
  assuranceHeadline,
  type AssuranceInput,
} from '../packages/assurance/src/index.ts';
import { getRubric } from '../packages/rubric/src/rubric.ts';

const CRITERIA = getRubric('1.0.0').dimensions.flatMap((dimension) =>
  dimension.criteria.map((criterion) => criterion.id),
);

const base: AssuranceInput = {
  appName: 'Kettle',
  assessedOn: '2026-09-18',
  rubricVersion: '1.0.0',
  depth: 'full',
  gateFailures: [],
  findings: [],
  rubricCriteria: CRITERIA,
  declared: { authentication: true, payments: true, personalData: true },
};

const lineFor = (id: string, input: AssuranceInput = base) =>
  assuranceFor(input).find((line) => line.claim.id === id)!;

describe('a tick for something nobody checked', () => {
  it('cannot happen when the rubric has no criterion for the question', () => {
    // The single worst bug available here, and the exact failure mode of every
    // assurance seal that has ever been embarrassing: no findings renders as a
    // pass, and the visitor is shown a tick for a question nobody asked.
    expect(lineFor('payments').state).toBe('not_tested');
    expect(lineFor('payments').notTestedBecause).toMatch(/not a pass/i);
  });

  it('cannot happen when only part of the question has a criterion', () => {
    // Found by rendering the page rather than by reading the code. "Is it
    // running anything it should not be?" has two criteria, one of which 1.0.0
    // defines. Requiring all of them to be missing gave it a tick under a
    // sentence promising we had checked every script against known
    // cryptominers, which we had not.
    const hostile = ASSURANCE_CLAIMS.find((claim) => claim.id === 'hostile_code')!;
    const known = hostile.criteria.filter((id) => CRITERIA.includes(id));
    expect(known.length).toBeGreaterThan(0);
    expect(known.length).toBeLessThan(hostile.criteria.length);
    expect(lineFor('hostile_code').state).toBe('not_tested');
  });

  it('cannot happen when the rubric has the check and the run did not reach it', () => {
    // The other half of the same failure, and the one that was live: the
    // rubric defines SEC-12, the engine has a check for it, and the check is
    // read from the landing page. A checkout lives at /checkout, so for most
    // applications that take payments nothing looked — and "no findings"
    // printed a tick under "If I pay, does my card go to a proper payment
    // company?".
    const unreached = assuranceFor({
      ...base,
      rubricCriteria: [...CRITERIA, 'SEC-12', 'SEC-13', 'PRI-07'],
      notTested: [{ criterion: 'SEC-12', because: 'No checkout was found on the landing page.' }],
    });
    const payments = unreached.find((line) => line.claim.id === 'payments')!;
    expect(payments.state).toBe('not_tested');
    expect(payments.notTestedBecause).toMatch(/no checkout was found/i);
    expect(payments.notTestedBecause).toMatch(/not a pass/i);
    // And the questions the run did reach are unaffected.
    expect(unreached.find((line) => line.claim.id === 'someone_there')!.state).toBe(
      'checked_clear',
    );
  });

  it('is carried from the run to the page rather than re-derived there', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    // The engine decides what it could not test; the page shows it. A page that
    // worked it out for itself would be guessing about a run it did not watch.
    expect(readFileSync('packages/engine/src/pipeline.ts', 'utf8')).toMatch(/notTestedCriteria/);
    expect(readFileSync('apps/worker/src/persist.ts', 'utf8')).toMatch(/not_tested/);
    expect(readFileSync('apps/web/app/a/[slug]/page.tsx', 'utf8')).toMatch(/a\.not_tested/);
  });

  it('lights up on its own once the rubric defines the criterion', () => {
    const withFuture = assuranceFor({
      ...base,
      rubricCriteria: [...CRITERIA, 'SEC-12', 'SEC-13', 'PRI-07'],
    });
    for (const id of ['payments', 'hostile_code', 'someone_there']) {
      expect(withFuture.find((line) => line.claim.id === id)!.state, id).toBe('checked_clear');
    }
  });
});

describe('what each line is allowed to say', () => {
  it('never promises anything about the future or about safety', () => {
    const prose = ASSURANCE_CLAIMS.flatMap((claim) => [
      claim.question,
      claim.whatWeChecked,
      claim.limitation,
    ])
      .join(' ')
      .toLowerCase();
    for (const phrase of [
      'is secure',
      'is safe',
      'virus-free',
      'no viruses',
      'guaranteed',
      'fully compliant',
    ]) {
      expect(prose, phrase).not.toContain(phrase);
    }
  });

  it('carries a limitation on every question, shown on a tick as loudly as on a cross', () => {
    for (const claim of ASSURANCE_CLAIMS) {
      expect(claim.limitation.length, claim.id).toBeGreaterThan(40);
    }
    const page = readFileSync(
      join(process.cwd(), 'apps/web/components/assurance-list.tsx'),
      'utf8',
    );
    expect(page).toContain('What this does not mean');
    expect(page).toMatch(/line\.state !== 'not_tested'/);
  });

  it('refuses to give a legal opinion about POPIA or the GDPR', () => {
    // The question Anré most wants answered, and the one we are least entitled
    // to answer. What is present and what matches is a fact; whether it is
    // lawful is a lawyer's.
    const privacy = ASSURANCE_CLAIMS.find((claim) => claim.id === 'what_they_collect')!;
    expect(privacy.limitation).toMatch(/not a legal opinion/i);
    expect(privacy.limitation).toMatch(/POPIA/);
    expect(privacy.limitation).toMatch(/We are not lawyers/i);
  });

  it('says a tick means we looked and did not find, not that it cannot happen', () => {
    expect(ASSURANCE_LEGEND).toMatch(/did not find/i);
    expect(ASSURANCE_LEGEND).toMatch(/not that it cannot happen/i);
    expect(ASSURANCE_LEGEND).toMatch(/Absence of a finding is not evidence of absence/i);
  });
});

describe('what a visitor is not shown', () => {
  it('never publishes a stranger’s open findings on a public page', () => {
    // A list of somebody else's weaknesses is a map, not a disclosure — and it
    // is the owner's to publish, not ours.
    const component = readFileSync(
      join(process.cwd(), 'apps/web/components/assurance-list.tsx'),
      'utf8',
    );
    expect(component).not.toMatch(/line\.findings\.length/);
    expect(component).not.toMatch(/\.ruleId/);
    expect(component).not.toMatch(/\.severity/);
    expect(component).toMatch(/theirs to share, not ours to publish/i);
  });

  it('is not read as the anonymous role, so it is not public through the API either', () => {
    // A view granted to `anon` is public data whatever a page chooses to
    // render.
    const page = readFileSync(join(process.cwd(), 'apps/web/app/a/[slug]/page.tsx'), 'utf8');
    // This one function, not everything between it and the next landmark: the
    // page has since grown another loader that reads genuinely public data as
    // `anon`, which is correct for that one and would have failed this.
    const start = page.indexOf('async function loadAssurance');
    const loader = page.slice(start, page.indexOf('\n}', start));
    expect(loader).toContain('writeAsService');
    expect(loader).not.toContain('readAsAnon');
  });
});

describe('answering only what applies', () => {
  it('does not tick an account question for an application with no accounts', () => {
    const line = lineFor('account_takeover', {
      ...base,
      declared: { ...base.declared, authentication: false },
    });
    expect(line.state).toBe('not_tested');
    expect(line.notTestedBecause).toMatch(/no sign-in/i);
  });

  it('says a free assessment did not include the pass that tries this', () => {
    const line = lineFor('other_peoples_data', { ...base, depth: 'limited' });
    expect(line.state).toBe('not_tested');
    expect(line.notTestedBecause).toMatch(/free assessment/i);
  });

  it('treats a failed gate as a finding even when no finding was published', () => {
    const line = lineFor('leaked_keys', { ...base, gateFailures: ['GATE-EXPOSED-SECRET'] });
    expect(line.state).toBe('checked_found');
    expect(line.gateFailed).toBe(true);
  });

  it('does not turn an unscored observation into a problem for a visitor', () => {
    // `info` findings are the design-coherence observations, which the rubric
    // penalises at zero. Eleven type sizes is not something to tell a visitor
    // about an application's trustworthiness.
    const line = lineFor('usable', {
      ...base,
      findings: [{ ruleId: 'UX-06', severity: 'info' }],
    });
    expect(line.state).toBe('checked_clear');
  });

  it('does turn a real finding into a visible one', () => {
    const line = lineFor('usable', {
      ...base,
      findings: [{ ruleId: 'UX-02', severity: 'medium' }],
    });
    expect(line.state).toBe('checked_found');
  });
});

describe('the headline', () => {
  it('counts only the questions that were actually tested', () => {
    const lines = assuranceFor(base);
    const tested = lines.filter((line) => line.state !== 'not_tested').length;
    expect(assuranceHeadline(base, lines)).toContain(String(tested));
    expect(assuranceHeadline(base, lines)).toContain('2026-09-18');
  });

  it('says what the mark means and that it means nothing else', () => {
    const lines = assuranceFor(base);
    expect(assuranceHeadline(base, lines)).toMatch(/all it means/i);
  });
});

describe('the three steps', () => {
  it('describes a mechanism rather than a promise', () => {
    const prose = VERIFICATION_STEPS.map((step) => `${step.title} ${step.body}`).join(' ');
    expect(prose).toMatch(/DNS|own server/i);
    expect(prose).toMatch(/published in full/i);
    expect(prose).toMatch(/refuses to record one without a named reviewer/i);
  });

  it('says none of them can be skipped by paying', () => {
    const component = readFileSync(
      join(process.cwd(), 'apps/web/components/assurance-list.tsx'),
      'utf8',
    );
    expect(component.replace(/\s+/g, ' ')).toMatch(/skipped by paying/i);
  });
});

describe('where it sits on the page', () => {
  const page = readFileSync(join(process.cwd(), 'apps/web/app/a/[slug]/page.tsx'), 'utf8');

  it('comes before the score, which does not answer the visitor’s question', () => {
    const list = page.indexOf('<AssuranceList');
    const facts = page.indexOf('The assessment');
    expect(list).toBeGreaterThan(-1);
    expect(list).toBeLessThan(facts);
  });

  it('still comes after the scope statement, which bounds everything above it', () => {
    const scope = page.indexOf('What was assessed, and what was not');
    expect(page.indexOf('<AssuranceList')).toBeGreaterThan(scope);
  });
});
