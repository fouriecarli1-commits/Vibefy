/**
 * The assistant that sits beside a customer's report.
 *
 * Somebody who has just been handed a score and a list of findings has
 * questions, and until now the only way to ask them was to email us. So this
 * answers them — about their own assessment, and about getting the badge onto
 * their site.
 *
 * It is the first text this product sends a customer that no gate has read
 * before it goes out. Every other sentence in the console passes `check:copy`
 * at build time; this one is written while the customer waits. That is the
 * whole reason this file is mostly rules rather than plumbing.
 *
 * Three of those rules are the product rather than caution:
 *
 *   · It explains the assessment. It never revises it. A customer who can
 *     argue a finding down in conversation is a customer who has bought a
 *     score, and then nobody's score means anything.
 *   · It never predicts what a future assessment will do. "Fix this and
 *     you'll pass" is a promise about a run that has not happened, made by
 *     the party that would be paid for it.
 *   · It does not sell. We take money to help fix applications, which is the
 *     sharpest conflict in this business; an assistant that mentions the
 *     service while explaining a fault is that conflict speaking out loud.
 */

export { checkCopilotReply, type CopilotCheck } from './guard.ts';

export const COPILOT_MODEL = 'claude-opus-5';

/**
 * What one workspace's assistant may cost us in an hour, in dollars.
 *
 * A ceiling rather than a trust exercise: an assistant with no limit is a bill
 * with a chat interface.
 *
 * Hourly and per organisation rather than per conversation, and the difference
 * is not pedantry. A conversation is a client-side idea — the browser decides
 * what history to send back, so "this conversation has cost $2" is a figure the
 * spender reports about themselves. An hour of one workspace's assistant spend
 * is a fact the database owns, and it is the one a script pointed at the
 * endpoint would actually run into.
 *
 * At current prices this is a long afternoon of real questions and a short
 * career for anything automated.
 */
export const COPILOT_CEILING_USD = 2;

/** The window that ceiling is measured over. */
export const COPILOT_CEILING_WINDOW_MINUTES = 60;

/** What a customer is told when their workspace has reached it. */
export const COPILOT_CEILING_REACHED =
  'This workspace has used its hour of assistant time. It resets within the hour, and nothing else about your assessment or your badge is affected — the limit is on me, not on you.';

/** How much of the conversation is carried. Older turns fall away. */
export const COPILOT_HISTORY_TURNS = 12;

export type CopilotRole = 'user' | 'assistant';

export interface CopilotTurn {
  readonly role: CopilotRole;
  readonly content: string;
}

/** One finding, as the assistant is allowed to see it. */
export interface CopilotFinding {
  readonly title: string;
  readonly severity: string;
  readonly dimension: string;
  readonly confidence: string;
  readonly summary: string;
  readonly evidenceCount: number;
}

/**
 * Everything the assistant knows.
 *
 * Assembled from the customer's own rows and nothing else. It has no search, no
 * browsing, and no memory between conversations — so an answer it cannot ground
 * in this object is an answer it has to decline, which is the point.
 */
export interface CopilotContext {
  readonly appName: string;
  readonly assessedOn: string;
  readonly rubricVersion: string;
  readonly overallScore: number | null;
  readonly status: string;
  readonly scopeStatement: string;
  readonly findings: readonly CopilotFinding[];
  readonly badge: {
    readonly status: string | null;
    readonly embedHtml: string | null;
    readonly embedJsx: string | null;
    readonly verificationUrl: string | null;
  };
}

/**
 * The instruction, built around the customer's own assessment.
 *
 * The grounding is in the prompt rather than in a tool because there is nothing
 * to look up: the whole world this assistant may talk about fits in a few
 * hundred lines, and a retrieval step would only add a way to fetch the wrong
 * customer's findings.
 */
export function copilotSystemPrompt(context: CopilotContext): string {
  const findings = context.findings.length
    ? context.findings
        .map(
          (finding, index) =>
            `${index + 1}. [${finding.severity}, ${finding.dimension}, confidence ${finding.confidence}, ${finding.evidenceCount} piece(s) of evidence] ${finding.title}\n   ${finding.summary}`,
        )
        .join('\n')
    : 'No findings were published for this assessment.';

  return [
    'You are the VibefyCode assistant. You help one customer understand one assessment of one',
    'application, and help them place the badge on their site. You are speaking to the person who',
    'owns the application.',
    '',
    '## The assessment you are discussing',
    '',
    `Application: ${context.appName}`,
    `Assessed on: ${context.assessedOn}`,
    `Rubric version: ${context.rubricVersion}`,
    `Overall score: ${context.overallScore === null ? 'not scored' : `${context.overallScore} out of 100`}`,
    `Status: ${context.status}`,
    '',
    'Scope statement, which is the authoritative description of what was and was not tested:',
    context.scopeStatement,
    '',
    '## Findings',
    '',
    findings,
    '',
    '## The badge',
    '',
    context.badge.status
      ? [
          `Badge status: ${context.badge.status}`,
          context.badge.verificationUrl
            ? `Verification page: ${context.badge.verificationUrl}`
            : '',
          context.badge.embedHtml ? `\nHTML snippet:\n${context.badge.embedHtml}` : '',
          context.badge.embedJsx ? `\nReact snippet:\n${context.badge.embedJsx}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : 'No badge has been issued for this application yet.',
    '',
    '## What you do',
    '',
    '- Explain findings in plain language: what was observed, why it matters, and what a fix',
    '  would involve. Be concrete and technical when the person is technical.',
    '- Explain what the score means and how the rubric arrived at it.',
    '- Help them put the badge on their site. Ask what they built it with, then give them the',
    '  right snippet and say where it goes. The React snippet for React or Next.js; the HTML one',
    '  otherwise, since the HTML will not compile inside a component.',
    '- Say plainly when something is outside what was assessed.',
    '',
    '## What you never do',
    '',
    '- Never revise, dispute or soften the assessment. You explain what was found; you do not',
    '  decide what should have been found. If they disagree with a finding, tell them the appeals',
    '  process exists and that a human reviews it — do not adjudicate it yourself.',
    '- Never predict a future score, or say that a change will raise one, or that it will make',
    '  them eligible for a badge. The next assessment decides that, and you are not it.',
    '- Never offer, recommend or mention any paid VibefyCode service. If they ask whether we can',
    '  fix it for them, say the service exists, that it is deliberately kept separate from',
    '  scoring, and that the details are on the services page. Then stop.',
    '- Never call an application, or any part of one, secure, safe, compliant, guaranteed, or',
    '  certified. The assessment is point-in-time and scope-limited. Say "no issue of this kind',
    '  was found in what was tested" rather than "this is fine".',
    '- Never invent a finding, a score, a date or a rubric rule. Everything you state about this',
    '  assessment must be above. If it is not there, say you do not have it.',
    '',
    '## How you write',
    '',
    'Plainly, and briefly. No preamble, no restating the question. If a list is the honest shape',
    'of an answer, use one; otherwise write sentences. You may use markdown.',
  ].join('\n');
}

/**
 * Phrases the assistant is not permitted to send, checked on the way out.
 *
 * A duplicate of the prompt's rules, and deliberately so. A system prompt is an
 * instruction and this is a gate: the first is what we ask for, the second is
 * what a customer can actually receive. Every other line of copy in this
 * product passes `check:copy` before it ships, and it would be strange for the
 * only text written at runtime to be the only text nobody checks.
 */
/**
 * What the customer sees when a reply is refused.
 *
 * It says what happened rather than pretending the assistant had nothing to
 * say. A blank answer teaches somebody that the feature is broken; this one
 * teaches them where the limit is, which is a thing worth knowing about a
 * company that rates software.
 */
export const COPILOT_WITHHELD =
  'I drafted an answer and then stopped myself: it made a claim about your application that a scope-limited assessment cannot support. Ask me again more narrowly — about a specific finding, or about what was actually tested — and I can answer that properly.';

/** Trims a conversation to the turns that are carried. */
export function recentTurns(turns: readonly CopilotTurn[]): CopilotTurn[] {
  return turns.slice(-COPILOT_HISTORY_TURNS);
}
