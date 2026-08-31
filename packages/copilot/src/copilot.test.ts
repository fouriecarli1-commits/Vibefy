/**
 * The rules the assistant is held to.
 *
 * This is the first text the product sends a customer that no build-time gate
 * has read. Every other sentence in the console passes `check:copy` before it
 * ships; this one is written while the customer waits — so the rules live in
 * two places on purpose, the prompt and the outgoing check, and these tests are
 * about the second.
 *
 * The three that are the product rather than caution: it explains but never
 * revises the assessment, it never predicts a future score, and it does not
 * sell the service that would be paid to fix what it is describing.
 */
import { describe, expect, it } from 'vitest';
import {
  COPILOT_COST_CEILING_USD,
  COPILOT_HISTORY_TURNS,
  COPILOT_MODEL,
  COPILOT_WITHHELD,
  checkCopilotReply,
  copilotSystemPrompt,
  recentTurns,
  type CopilotContext,
} from './index.ts';

const context: CopilotContext = {
  appName: 'Kettle',
  assessedOn: '2026-08-31',
  rubricVersion: '1.0.0',
  overallScore: 88.6,
  status: 'approved',
  scopeStatement: 'A'.repeat(140),
  findings: [
    {
      title: 'Session cookie is readable by script',
      severity: 'high',
      dimension: 'security_posture',
      confidence: 'high',
      summary: 'The session cookie is set without HttpOnly.',
      evidenceCount: 2,
    },
  ],
  badge: {
    status: 'active',
    embedHtml: '<a href="https://example.test/a/kettle"><img src="..."></a>',
    embedJsx: '<a href="https://example.test/a/kettle">\n  <img src="..." />\n</a>',
    verificationUrl: 'https://example.test/a/kettle',
  },
};

describe('what the assistant is told', () => {
  const prompt = copilotSystemPrompt(context);

  it('carries the assessment it is allowed to discuss', () => {
    expect(prompt).toContain('Kettle');
    expect(prompt).toContain('88.6 out of 100');
    expect(prompt).toContain('Session cookie is readable by script');
  });

  it('carries the scope statement, which is what bounds every answer', () => {
    expect(prompt).toContain(context.scopeStatement);
  });

  it('carries both snippet forms and which one goes where', () => {
    expect(prompt).toContain(context.badge.embedHtml!);
    expect(prompt).toContain(context.badge.embedJsx!);
    expect(prompt).toMatch(/will not compile inside a component/i);
  });

  it('forbids revising the assessment, and points at appeals instead', () => {
    expect(prompt).toMatch(/never revise, dispute or soften/i);
    expect(prompt).toMatch(/appeals/i);
  });

  it('forbids predicting a future score', () => {
    expect(prompt).toMatch(/never predict a future score/i);
  });

  it('forbids selling the remediation service', () => {
    // The sharpest conflict in the business, spoken aloud by an assistant that
    // is at that moment describing a fault.
    expect(prompt).toMatch(/never offer, recommend or mention any paid/i);
    expect(prompt).toMatch(/kept separate from/i);
  });

  it('forbids the absolute words the rest of the product forbids', () => {
    expect(prompt).toMatch(/secure, safe, compliant, guaranteed, or\s+certified/i);
  });

  it('says plainly when there is no badge yet, rather than inventing one', () => {
    const withoutBadge = copilotSystemPrompt({
      ...context,
      badge: { status: null, embedHtml: null, embedJsx: null, verificationUrl: null },
    });
    expect(withoutBadge).toMatch(/No badge has been issued/i);
  });

  it('says plainly when nothing was published, rather than leaving a gap', () => {
    const withoutFindings = copilotSystemPrompt({ ...context, findings: [] });
    expect(withoutFindings).toMatch(/No findings were published/i);
  });
});

describe('what may reach the customer', () => {
  it('allows an ordinary explanation', () => {
    const reply =
      'The session cookie is set without HttpOnly, so a script on the page can read it. ' +
      'Adding that flag is a one-line change in whatever sets the cookie.';
    expect(checkCopilotReply(reply).allowed).toBe(true);
  });

  it('refuses to call an application secure', () => {
    const check = checkCopilotReply('Once you fix that, your app is secure.');
    expect(check.allowed).toBe(false);
    expect(check.reasons.join(' ')).toMatch(/secure/i);
  });

  it('refuses to guarantee anything', () => {
    expect(checkCopilotReply('That will guarantee a clean result.').allowed).toBe(false);
  });

  it('refuses to predict the next assessment', () => {
    // The one somebody would most want to hear, from the party that would be
    // paid to make it happen.
    for (const draft of [
      'Fix that and you will pass next time.',
      'This would raise your score to about 95.',
      'That should improve your score.',
    ]) {
      expect(checkCopilotReply(draft).allowed, draft).toBe(false);
    }
  });

  it('refuses to claim compliance or certification', () => {
    expect(checkCopilotReply('After that you are compliant.').allowed).toBe(false);
    expect(checkCopilotReply('You will be certified once this is done.').allowed).toBe(false);
  });

  it('refuses the marketing absolutes outright', () => {
    for (const draft of ['It is bulletproof now.', 'That makes it hack-proof.']) {
      expect(checkCopilotReply(draft).allowed, draft).toBe(false);
    }
  });

  it('does not trip on the words appearing inside a denial', () => {
    // The sentence the assistant is supposed to say must survive the gate that
    // exists to make it say it.
    const honest =
      'I cannot tell you whether this is secure — no assessment can. What I can tell you is ' +
      'that no issue of this kind was found in what was tested.';
    expect(checkCopilotReply(honest).allowed).toBe(true);
  });

  it('explains itself when it withholds, rather than going blank', () => {
    // A blank answer teaches somebody the feature is broken. This one teaches
    // them where the limit is, which is worth knowing about a company that
    // rates software.
    expect(COPILOT_WITHHELD).toMatch(/scope-limited/i);
    expect(COPILOT_WITHHELD.length).toBeGreaterThan(80);
  });
});

describe('what one conversation may cost', () => {
  it('has a ceiling at all', () => {
    // An assistant with no limit is a bill with a chat interface.
    expect(COPILOT_COST_CEILING_USD).toBeGreaterThan(0);
    expect(COPILOT_COST_CEILING_USD).toBeLessThanOrEqual(1);
  });

  it('carries a bounded slice of the conversation', () => {
    const turns = Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `turn ${index}`,
    }));
    const carried = recentTurns(turns);
    expect(carried).toHaveLength(COPILOT_HISTORY_TURNS);
    expect(carried.at(-1)?.content).toBe('turn 39');
  });

  it('leaves a short conversation alone', () => {
    const turns = [{ role: 'user' as const, content: 'hello' }];
    expect(recentTurns(turns)).toEqual(turns);
  });

  it('names a model the cost table can price', () => {
    // An unpriced model is an unmetered bill; the engine's price table refuses
    // one, and this has to name something that table knows.
    expect(COPILOT_MODEL).toBe('claude-opus-5');
  });
});
