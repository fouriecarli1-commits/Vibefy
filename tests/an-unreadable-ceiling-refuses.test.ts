/**
 * A ceiling that cannot be read refuses, rather than permitting.
 *
 * `POST /api/copilot` checks an hour of a workspace's assistant spend against
 * `COPILOT_CEILING_USD` before calling the model. The read ended in
 * `.catch(() => 0)`.
 *
 * So anything that made the ceiling unreadable — a connection the pool could not
 * hand out, a statement timeout, the day somebody renames
 * `public.assistant_spend_since` — turned a hard ceiling into no ceiling. Not for
 * one request: for every request, in every workspace, for as long as the
 * condition lasted, with the model being called each time and nothing written
 * anywhere to say the check had been skipped. A script pointed at the endpoint,
 * which is the thing the ceiling exists for, would have run into nothing.
 *
 * The build brief calls these hard ceilings and says a runaway agent loop must
 * not be able to generate an unbounded bill. A ceiling whose failure mode is
 * "spend freely" is not one, however carefully the number is chosen.
 *
 * `NaN` was the same defect from the other side: `Number('')` or a malformed
 * value gives `NaN`, and `NaN >= 2` is false, so a spend figure we could not read
 * also permitted the call.
 *
 * There is no argument here about the direction to err in. Refusing costs one
 * customer one answer and says so in a sentence; permitting costs money that
 * nobody has agreed to spend, and the first anybody hears of it is an invoice.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COPILOT_CEILING_UNREADABLE,
  COPILOT_CEILING_REACHED,
  COPILOT_CEILING_USD,
} from '../packages/copilot/src/index.ts';

const route = readFileSync(join(process.cwd(), 'apps/web/app/api/copilot/route.ts'), 'utf8');

/**
 * The route with its comments removed.
 *
 * Because the comment explaining this defect quotes the defect, and a test that
 * reads source has to be able to tell an explanation from the thing explained.
 */
const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('the spend read', () => {
  it('does not turn a failure into a spend of nothing', () => {
    // The exact shape that was there. Written as source inspection because the
    // alternative is booting a Next route handler with a broken pool, and what
    // is being pinned is a decision rather than a computation.
    expect(code).not.toMatch(/\.catch\(\(\) => 0\)/);
    expect(code).toMatch(/\.catch\(\(\) => null\)/);
  });

  it('refuses when it cannot be read', () => {
    expect(code).toContain('COPILOT_CEILING_UNREADABLE');
    // Refused, not merely logged and continued.
    expect(code).toMatch(/spentThisHour === null/);
  });

  it('treats a figure that is not a number as unreadable', () => {
    // `NaN >= 2` is false, so this permitted the call before.
    expect(code).toMatch(/Number\.isFinite/);
  });
});

describe('what the customer is told', () => {
  it('is not the same sentence as reaching the ceiling', () => {
    // Telling somebody they have used their hour when they have not is a lie
    // that makes them wait an hour for nothing, and it hides an incident that
    // needs a person.
    expect(COPILOT_CEILING_UNREADABLE).not.toBe(COPILOT_CEILING_REACHED);
    expect(COPILOT_CEILING_UNREADABLE.length).toBeGreaterThan(40);
  });

  it('says it is our fault and not theirs, because it is', () => {
    expect(COPILOT_CEILING_UNREADABLE).toMatch(/our|us|me\b/i);
  });

  it('does not quote a spend figure it does not have', () => {
    expect(COPILOT_CEILING_UNREADABLE).not.toMatch(new RegExp(`\\$?${COPILOT_CEILING_USD}\\b`));
  });
});
