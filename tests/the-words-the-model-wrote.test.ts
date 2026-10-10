/**
 * Most of the words in a paid report were written by a model, and nothing read
 * them.
 *
 * The assistant beside the report has had every reply checked since the day it
 * shipped. The route that does it says so in its own header: this is "the only
 * text the product sends a customer that no build-time gate has read". That
 * sentence was false, and in the direction that matters — a model writes the
 * title, the description and the remediation step of every finding a model
 * stage produces, plus the notes beside them, and PART 11 of the brief names
 * report text first in the list of outputs that may not call something secure
 * without a scope qualifier.
 *
 * Four things are held here: that the gate's rules live in one place now, that
 * they agree with the build-time linter's, that a finding survives having a
 * sentence withheld, and that the sentence a model needs most — the one
 * denying the claim — still gets through.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLAIM_QUALIFIERS,
  RESTRICTED_CLAIMS,
  checkDraftedText,
} from '../packages/shared/src/index.ts';
import { checkCopilotReply } from '../packages/copilot/src/index.ts';
import {
  unevidencedNote,
  withheldNotes,
  withholdOverclaims,
} from '../packages/engine/src/stages/model-stage.ts';
import { RESTRICTED_WORDS } from '../tools/copy-lint.mjs';
import { withoutComments } from './setup/source.ts';

const finding = {
  ruleId: 'SEC-05',
  dimension: 'security_posture' as const,
  severity: 'high' as const,
  confidence: 'high' as const,
  title: 'Session cookie is readable by script',
  description: 'The session cookie is set without HttpOnly, so any script on the page can read it.',
  remediation: 'Set HttpOnly and SameSite on the session cookie.',
  evidenceIds: ['ev-1'],
};

describe('one list, read by everything that drafts text', () => {
  it('is the same check the assistant uses', () => {
    /*
     * This compares answers, which a faithful copy would also pass; the test
     * below is the one that forbids a copy. Both are here because two lists
     * would disagree within a release and the one facing a customer in real
     * time would be the one nobody was maintaining — and the copilot package's
     * own tests go red when a word leaves the shared list, which is the proof
     * that there is one list rather than two that agree today.
     */
    const overclaim = 'After this change your application will be secure.';
    expect(checkCopilotReply(overclaim)).toEqual(checkDraftedText(overclaim));
  });

  it('leaves no second copy of the rules behind in the copilot package', () => {
    const guard = withoutComments(readFileSync('packages/copilot/src/guard.ts', 'utf8'));
    expect(guard).toMatch(/checkDraftedText/);
    expect(guard, 'the patterns moved rather than being copied').not.toMatch(/hack-proof|\bsafe\b/);
  });

  it('restricts every word the build-time linter restricts', () => {
    /*
     * The two halves of this gate are allowed to differ in shape — the model's
     * list carries reasons and catches predictions, which prose in the
     * repository cannot make — but a word the linter refuses in our own copy
     * cannot be one a model may write into a report. Checked by running the
     * word through the gate in a sentence with no qualifier in it.
     */
    for (const word of RESTRICTED_WORDS) {
      const verdict = checkDraftedText(`The application is ${word}.`);
      expect(verdict.allowed, `"${word}" passes the drafted-text gate`).toBe(false);
    }
    expect(RESTRICTED_CLAIMS.length).toBeGreaterThan(0);
    expect(CLAIM_QUALIFIERS).toContain('not');
  });
});

describe('a finding whose sentence we may not publish', () => {
  it('keeps the finding, withholds the sentence', () => {
    // Dropping it would lose a defect the customer paid to be told about over
    // a choice of words. The criterion, the severity and the evidence are ours
    // and the sentence cannot spoil them.
    const { findings, withheld } = withholdOverclaims([
      { ...finding, description: 'Fixing this will make your application secure.' },
    ]);
    const kept = findings[0]!;
    expect(kept.ruleId).toBe('SEC-05');
    expect(kept.severity).toBe('high');
    expect(kept.evidenceIds).toEqual(['ev-1']);
    expect(kept.title).toBe('Session cookie is readable by script');
    expect(kept.description).not.toContain('will make your application secure');
    expect(kept.description).toMatch(/withheld/);
    expect(withheld.join(' ')).toContain('SEC-05');
    /*
     * The replacement names the rule it tripped, which means it contains the
     * word — "it called something secure without a scope qualifier" — and the
     * qualifier in that sentence is what makes it publishable. Checked rather
     * than assumed: a withheld notice that would itself be withheld is the
     * recursion this gate invites, and it would be discovered by a customer
     * reading a sentence about a sentence about a sentence.
     */
    expect(checkDraftedText(kept.description).allowed).toBe(true);
  });

  it('leaves a finding alone when every sentence is publishable', () => {
    // The over-correction worth a test of its own: a gate that rewrote every
    // finding would be worse than the one that read none of them, and nothing
    // in the report would tell anybody it had happened.
    const { findings, withheld } = withholdOverclaims([finding]);
    expect(findings[0]).toBe(finding);
    expect(withheld).toEqual([]);
  });

  it('replaces a title with one that still names the finding', () => {
    const { findings } = withholdOverclaims([{ ...finding, title: 'Your payment flow is safe' }]);
    expect(findings[0]!.title).toContain('SEC-05');
    expect(findings[0]!.title).toContain('high');
    expect(findings[0]!.title).not.toMatch(/safe/);
  });

  it('checks the remediation step, which is where a promise would go', () => {
    const { findings } = withholdOverclaims([
      { ...finding, remediation: 'Do this and you will pass the next assessment.' },
    ]);
    expect(findings[0]!.remediation).toMatch(/withheld/);
    expect(findings[0]!.description).toBe(finding.description);
  });
});

describe('the notes beside the findings', () => {
  it('replaces one that states a claim we may not make', () => {
    const { notes, withheld } = withheldNotes([
      'The sign-in flow could not be reached without an account.',
      'Everything else about this application is secure.',
    ]);
    expect(notes[0]).toBe('The sign-in flow could not be reached without an account.');
    expect(notes[1]).toMatch(/withheld/);
    expect(withheld).toHaveLength(1);
  });

  it('lets through the sentence a model needs most', () => {
    // "We cannot tell you whether this is secure" has to survive the gate that
    // exists to make it say exactly that — the same reasoning the assistant's
    // half was written with.
    const { notes, withheld } = withheldNotes([
      'This run cannot tell you whether the application is secure; it tested what the authorisation allowed.',
      'Absence of a finding here is not evidence that there is no defect.',
    ]);
    expect(withheld).toEqual([]);
    expect(notes[0]).toMatch(/secure/);
  });
});

describe('the note about what was dropped', () => {
  it('withholds the titles it quotes', () => {
    /*
     * A claim we refuse to publish as a finding must not arrive in the note
     * explaining why we refused it. This was two lines at the call site and a
     * comment saying exactly that, and the mutation removing the withholding
     * left every test green — which is why it is a function now.
     */
    const note = unevidencedNote([
      { ...finding, title: 'The application is secure apart from this' },
    ]);
    expect(note).not.toContain('is secure apart from this');
    expect(note).toContain('SEC-05');
    expect(checkDraftedText(note!).allowed).toBe(true);
  });

  it('says nothing when nothing was dropped', () => {
    // A note reading "0 claim(s) were withheld" in a report is noise that
    // sounds like news.
    expect(unevidencedNote([])).toBeNull();
  });

  it('still names what was dropped when the titles are publishable', () => {
    const note = unevidencedNote([finding]);
    expect(note).toContain('Session cookie is readable by script');
    expect(note).toContain('1 claim(s)');
  });
});
