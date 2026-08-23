/**
 * Prohibited-use screening.
 *
 * The interesting property is not that it refuses malware — it is that it does
 * not refuse honest customers whose subject matter merely sounds alarming, and
 * that it never fails open when something goes wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  CostMeter,
  ModelClient,
  ScriptedTransport,
  deterministicScreen,
  screenIntake,
} from '../packages/engine/src/index.ts';

const submission = (description: string, appName = 'Test App') => ({
  appName,
  description,
  category: 'productivity',
  targetAudience: 'small businesses',
  primaryUrl: 'https://example.test',
});

describe('the deterministic pre-filter', () => {
  it.each([
    [
      'a phishing page that harvests credentials for a bank login',
      'phishing_or_credential_harvesting',
    ],
    ['a keylogger that records everything typed on the machine', 'malware'],
    [
      'lets you track my ex without them noticing anything at all',
      'targeting_a_private_individual',
    ],
    [
      'a scraper that bypasses their rate limits to collect listings faster',
      'terms_breaching_scraping',
    ],
  ])('refuses "%s"', (description, category) => {
    const result = deterministicScreen(submission(description));
    expect(result?.verdict).toBe('refused');
    expect(result?.category).toBe(category);
    expect(result?.quotedBasis.length, 'a refusal must quote what it relied on').toBeGreaterThan(0);
  });

  it.each([
    'A budgeting app that helps freelancers track expenses, including cryptocurrency purchases they have made.',
    'Security awareness training that shows employees simulated phishing emails, run by their own employer.',
    'A dating app for people over fifty who want to meet for coffee rather than anything else.',
    'A password manager that stores credentials locally and never sends them anywhere.',
    'A firearms licensing compliance tracker for licensed dealers to manage their statutory paperwork.',
  ])(
    'does not refuse a legitimate app that merely touches a sensitive subject: %s',
    (description) => {
      const result = deterministicScreen(submission(description));
      expect(result?.verdict, description).not.toBe('refused');
    },
  );

  it('asks for more rather than guessing when the description is too thin', () => {
    const result = deterministicScreen(submission('an app'));
    expect(result?.verdict).toBe('needs_human_review');
    expect(result?.reasoning).toMatch(/not a refusal/i);
  });
});

describe('the full screen', () => {
  const client = (steps: ConstructorParameters<typeof ScriptedTransport>[0]) =>
    new ModelClient(new ScriptedTransport(steps), new CostMeter({ maxRunCostUsd: 1 }));

  it('defers to a human when no judgement pass is available', async () => {
    const result = await screenIntake(
      submission('A tool that helps small shops manage their stock levels across two warehouses.'),
    );
    expect(result.verdict).toBe('needs_human_review');
    expect(result.source).toBe('unavailable');
  });

  it('clears an application the judgement pass finds unremarkable', async () => {
    const result = await screenIntake(
      submission('A tool that helps small shops manage their stock levels across two warehouses.'),
      client([
        {
          parsed: {
            verdict: 'cleared',
            category: null,
            confidence: 'high',
            quotedBasis: 'manage their stock levels',
            reasoning:
              'Inventory management for retailers. Nothing in the Acceptable Use Policy applies.',
          },
        },
      ]),
    );
    expect(result.verdict).toBe('cleared');
    expect(result.source).toBe('model');
  });

  it('downgrades a refusal that quotes nothing, rather than acting on it', async () => {
    const result = await screenIntake(
      submission('A tool that helps small shops manage their stock levels across two warehouses.'),
      client([
        {
          parsed: {
            verdict: 'refused',
            category: 'malware',
            confidence: 'high',
            quotedBasis: '   ',
            reasoning: 'It feels wrong.',
          },
        },
      ]),
    );
    expect(result.verdict).toBe('needs_human_review');
    expect(result.reasoning).toMatch(/must quote the words it relied on/i);
  });

  it('never fails open when the screen itself breaks', async () => {
    const result = await screenIntake(
      submission('A tool that helps small shops manage their stock levels across two warehouses.'),
      client([]), // the transport throws on the first call
    );
    expect(result.verdict).toBe('needs_human_review');
    expect(result.reasoning).toMatch(/never fails open/i);
  });
});
