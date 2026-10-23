/**
 * The one human gate in the product, deciding from a screen that did not load.
 *
 * Nothing is certified here without a person approving it on `/review/[id]`,
 * and the queue page says in a comment beside its only button that deciding
 * needs the evidence and the evidence is on that page. Six reads built it, and
 * every one of them dropped its error and fell back to an empty list.
 *
 * So a failed read rendered as an assessment with no findings, no evidence and
 * no failed stages — identical, on screen, to a clean run with nothing to find
 * — and the three decision forms sat at the bottom of it unchanged. A reviewer
 * could approve what the page had not fetched, and nothing on the page or in
 * the log said a word. "AI never certifies alone" is the promise; a person
 * cannot look at what was never there to look at.
 *
 * The reporting half of this was committed on 2026-10-22 and the gating half
 * written down in `docs/OPEN_ITEMS.md` rather than left to be remembered. This
 * is the gating half: what the decision rests on is told apart from what is
 * merely useful, the page says which, and the decision is withheld until the
 * page can show what it is about.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commentsBlanked } from './setup/source.ts';

const path = 'apps/web/app/review/[id]/page.tsx';
const source = readFileSync(path, 'utf8');
/** Comments blanked, so prose about a rule cannot stand in for the rule. */
const code = commentsBlanked(source);

describe('what the decision rests on', () => {
  it('is read with its error kept, and collected', () => {
    expect(code).toContain('couldNotRead');
    /*
     * The three that are the assessment: what was found, what it was found
     * from, and what did not run. Each must be read through the helper *and*
     * left blocking — the first version of this test asked only that they were
     * read, and passed with the stage log quietly downgraded to something the
     * decision does not rest on.
     */
    for (const name of ['findings', 'evidence', 'stage log']) {
      const from = code.indexOf(`'${name}'`);
      expect(from, `${name} is not read through the helper`).toBeGreaterThan(-1);
      const call = code.slice(from, code.indexOf('  );', from));
      expect(call, `${name} no longer withholds the decision`).not.toContain('false');
    }
  });

  it('is told apart from what is merely useful', () => {
    /*
     * The review history and the previous score are worth knowing and are not
     * what the decision rests on. Withholding the decision for them would be a
     * reviewer unable to work because a list of earlier decisions did not load.
     */
    // Sliced from the name rather than from the call, so indentation is not
    // part of what this holds.
    for (const name of ['review history', 'previous score']) {
      const from = code.indexOf(`'${name}'`);
      expect(from, `${name} is not read through the helper`).toBeGreaterThan(-1);
      const call = code.slice(from, code.indexOf('  );', from));
      expect(call, `${name} is treated as something the decision rests on`).toContain('false');
    }
  });

  it('says so when one of those two is missing, because of what it costs', () => {
    // Without the previous score the large-move rule does not fire, which is
    // also what happens on a first assessment. The page is the only place that
    // can tell a reader which of the two this is.
    expect(code).toContain('alsoMissing');
    expect(source).toMatch(/first\s*\n?\s*assessment/i);
  });
});

describe('the decision itself', () => {
  it('is withheld while any of it could not be read', () => {
    const decision = code.slice(code.indexOf('aria-labelledby="decide"'));
    const gate = decision.indexOf('couldNotRead.length > 0 ?');
    const approve = decision.indexOf('action={approveAssessment}');
    const adjust = decision.indexOf('action={adjustAssessment}');
    const reject = decision.indexOf('action={rejectAssessment}');
    expect(gate, 'the decision section does not ask whether the page loaded').toBeGreaterThan(-1);
    // Every one of the three, after the gate rather than beside it. A fourth
    // added later outside it is the bug this counts.
    for (const [name, at] of [
      ['approve', approve],
      ['adjust', adjust],
      ['reject', reject],
    ] as const) {
      expect(at, `the ${name} form is not inside the gate`).toBeGreaterThan(gate);
    }
  });

  it('has exactly three forms, all of them behind it', () => {
    const decision = code.slice(code.indexOf('aria-labelledby="decide"'));
    const forms = decision.match(/<ActionForm /g) ?? [];
    expect(forms).toHaveLength(3);
    const gate = decision.indexOf('couldNotRead.length > 0 ?');
    expect(decision.indexOf('<ActionForm '), 'a form before the gate').toBeGreaterThan(gate);
  });

  it('says why, where the buttons were', () => {
    const withheld = source.slice(source.indexOf('Not from this screen'));
    expect(withheld).toMatch(/deciding about what you cannot\s*\n?\s*see/i);
    // And that nothing is lost by waiting, because the alternative a reviewer
    // reaches for is deciding anyway.
    expect(withheld).toMatch(/stays in the\s*\n?\s*queue/i);
    expect(withheld).toMatch(/reload/i);
  });
});

describe('the page as a whole', () => {
  it('says at the top that an empty list is not evidence of nothing', () => {
    expect(source).toMatch(/Part of this page did not load/);
    expect(source).toMatch(/not evidence that there was nothing to show/);
  });

  it('tells a read that failed apart from an assessment that is not there', () => {
    // `if (!assessment) notFound()` told a reviewer it did not exist, which for
    // the one page they cannot work without is the less useful of the two
    // answers available.
    expect(code).toContain('PGRST116');
    expect(code).toContain('notFound()');
    expect(source).toMatch(/could not be read/i);
  });
});
