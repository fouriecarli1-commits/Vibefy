/**
 * The same assistant, a second grounding.
 *
 * The product already had one: beside a report, handed that assessment and
 * nothing else, refused the three things an assistant in a rating business must
 * never do — revise the assessment, predict the next one, or sell the service
 * that fixes it. The founder asked for "an AI engine so people can ask
 * questions about the app and their applications", and the honest answer was
 * not a second engine. It was the same one, grounded in the page they are
 * standing on.
 *
 * What this holds is the part that would rot: that the two prompts share one
 * copy of the rules, that the console's grounding carries no second statement
 * of the product's own gates, and that both paths go through the one function
 * with the ceiling, the gate and the ledger in it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { consoleSystemPrompt, copilotSystemPrompt } from '../packages/copilot/src/index.ts';
import { commentsBlanked } from './setup/source.ts';

const context = {
  plan: 'free',
  depth: 'limited',
  badgeEligible: false,
  cooldownDays: 90,
  maxApps: 3,
  applications: [
    {
      name: 'Futurebox',
      url: 'https://futurebox.studio',
      screening: 'cleared',
      authorised: false,
      nextStep: 'Prove the domain',
      nextStepMeans: 'Publish the DNS record or the challenge file, then press Verify.',
      latestAssessment: null,
      latestScore: null,
    },
  ],
};

describe('what the console assistant is given', () => {
  it('carries the step the card already shows, word for word', () => {
    // One reader behind both. A chat that describes an application differently
    // from the card beside it is worse than no chat: the customer now has two
    // answers and no way to tell which is the product's.
    const prompt = consoleSystemPrompt(context);
    expect(prompt).toContain('Prove the domain');
    expect(prompt).toContain('Publish the DNS record or the challenge file, then press Verify.');
    expect(prompt).toContain('Futurebox');
  });

  it('states the plan from the entitlement rather than from prose', () => {
    const prompt = consoleSystemPrompt(context);
    expect(prompt).toContain('Plan: free');
    expect(prompt).toContain('per 90 days');
    expect(prompt).toContain('Eligible to hold a badge: no');
  });

  it('says a plan with no cooling-off period has none, rather than nought days', () => {
    const prompt = consoleSystemPrompt({ ...context, cooldownDays: null });
    expect(prompt).toMatch(/No cooling-off period/);
    expect(prompt).not.toMatch(/per null days|per 0 days/);
  });

  it('says so when there is nothing to describe', () => {
    const prompt = consoleSystemPrompt({ ...context, applications: [] });
    expect(prompt).toMatch(/has not added an application yet/);
  });

  it('never writes out a rule the product enforces elsewhere', () => {
    /*
     * The temptation is a paragraph explaining the gates — authorisation
     * before assessment, screening before authorisation, what a badge needs.
     * Every one of those is enforced in code that can change, and the copy
     * would be the half nobody updates. So the prompt carries figures and
     * states, and points at the pages that say the rest properly.
     */
    const prompt = consoleSystemPrompt(context);
    expect(prompt).toContain('/how-it-works');
    expect(prompt).toContain('/legal');
    expect(prompt).toMatch(/point at the page/i);
  });

  it('is told it may describe only the applications it was handed', () => {
    expect(consoleSystemPrompt(context)).toMatch(/never discuss an\s+application belonging to/i);
  });
});

describe('the rules both groundings carry', () => {
  const onConsole = consoleSystemPrompt(context);
  const onReport = copilotSystemPrompt({
    appName: 'Kettle',
    assessedOn: '2026-08-22',
    rubricVersion: '1.0.0',
    overallScore: 82.5,
    status: 'published',
    scopeStatement: 'What was assessed, and what was not.',
    findings: [],
    badge: { status: null, embedHtml: null, embedJsx: null, verificationUrl: null },
  });

  it('refuses the same three things in both places', () => {
    for (const rule of [
      /Never revise, dispute or soften an assessment/,
      /Never predict a future score/,
      /Never offer, recommend or mention any paid VibefyCode service/,
      /Never call an application, or any part of one, secure/,
    ]) {
      expect(onReport, `report: ${rule}`).toMatch(rule);
      expect(onConsole, `console: ${rule}`).toMatch(rule);
    }
  });

  it('keeps one copy of them, so they cannot drift', () => {
    const source = commentsBlanked(readFileSync('packages/copilot/src/index.ts', 'utf8'));
    const copies = source.match(/Never predict a future score/g) ?? [];
    expect(copies, `the rule is written ${copies.length} times`).toHaveLength(1);
  });
});

describe('the route that answers either', () => {
  const route = commentsBlanked(readFileSync('apps/web/app/api/copilot/route.ts', 'utf8'));

  it('puts both paths through the ceiling, the gate and the ledger', () => {
    // A second endpoint would have been a second place to forget one of them,
    // and the one most easily forgotten is the ledger the daily cap reads.
    const calls = route.match(/answer\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    const shared = route.slice(route.indexOf('async function answer('));
    expect(shared).toMatch(/assistant_spend_since/);
    expect(shared).toMatch(/checkCopilotReply\(/);
    expect(shared).toMatch(/COPILOT_CEILING_USD/);
    expect(shared).toMatch(/cost_records/);
  });

  it('reads the console grounding as the caller', () => {
    // There is no workspace id on the request to swap. The applications come
    // from `readConsoleApplications`, which runs under the caller's own
    // row-level security.
    const console_ = route.slice(
      route.indexOf('onTheConsole'),
      route.indexOf('async function answer('),
    );
    expect(console_).toMatch(/readConsoleApplications\(user\.id\)/);
    expect(console_).toMatch(/readAsUser\(user\.id/);
    expect(console_, 'the service role has no business assembling a chat context').not.toMatch(
      /writeAsService/,
    );
  });

  it('still refuses a request that names nothing', () => {
    expect(route).toMatch(/No assessment named/);
  });
});
