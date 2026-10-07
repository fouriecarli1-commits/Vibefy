/**
 * The retention table in the Privacy Policy, against the days the engine stamps.
 *
 * `tests/governance.test.ts` already holds `RETENTION_SCHEDULE` — the table
 * rendered on `/console/privacy` — against the engine's per-kind figures, and
 * it does so by comparing the maximum and the minimum. That is the right test
 * for a one-line summary and it cannot see inside a row.
 *
 * The Privacy Policy's own table is per data category, and one of its rows
 * names three kinds at one figure:
 *
 *     | HTTP exchanges, console logs and DOM snapshots | … | 90 days |
 *
 * The engine stamps those three at 90, 60 and 30. So a customer told their DOM
 * snapshots are kept for ninety days has them deleted on the thirtieth, and a
 * console log on the sixtieth. The direction is the safe one for privacy — we
 * keep less than we said, not more — and it is the unsafe one for the customer:
 * decision 797 is about a paid report whose evidence has been deleted under it,
 * and a customer contesting a finding inside the window the notice gave them
 * finds the evidence gone.
 *
 * Both directions are held here. Nothing may outlive what the notice promises,
 * which is the privacy obligation; and the notice may not promise longer than
 * the engine keeps, which is the one that was broken.
 *
 * The policy is `1.0.0-draft · Status: not in force`, so no account has
 * consented to the old wording and nothing re-prompts. The row is split to say
 * what each kind actually gets. Which figure each *should* be is a policy
 * question and is in `docs/OPEN_ITEMS.md`: it was not resolved by raising
 * retention to match a sentence, because keeping somebody's DOM snapshots three
 * times longer to make a draft true is the worse of the two errors.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RETENTION_DAYS } from '../packages/engine/src/runtime/evidence.ts';

const policy = readFileSync(join(import.meta.dirname, '..', 'legal/privacy-policy.md'), 'utf8');

/** The retention cell of the row whose first cell names this text. */
function retentionCellFor(what: string): string {
  const row = policy.split('\n').find((line) => line.startsWith('|') && line.includes(what));
  expect(row, `no row in the Privacy Policy names "${what}"`).toBeDefined();
  const cells = row!.split('|').map((cell) => cell.trim());
  return cells[cells.length - 2] ?? '';
}

/** The day count a retention cell promises, or null where it promises none. */
function daysIn(cell: string): number | null {
  const match = /(\d+)\s+days/.exec(cell);
  return match ? Number(match[1]) : null;
}

/**
 * Each evidence kind, and the words the policy uses for it.
 *
 * Written out rather than derived: the policy is prose for a person and the
 * mapping from "browser traces" to `playwright_trace` is a judgement, not a
 * transformation. A kind added to the engine without a line here fails the last
 * test in this file.
 */
const NAMED_IN_THE_POLICY: Readonly<Record<keyof typeof RETENTION_DAYS, string>> = {
  http_exchange: 'HTTP exchanges from your application',
  console_log: 'Console logs from your application',
  dom_snapshot: 'DOM snapshots of your application',
  screenshot: 'Screenshots and browser traces',
  playwright_trace: 'Screenshots and browser traces',
  header_scan: 'Header scans, dependency reports',
  dependency_report: 'Header scans, dependency reports',
  lighthouse_report: 'Header scans, dependency reports',
  accessibility_scan: 'Header scans, dependency reports',
};

describe('what the Privacy Policy promises about each kind', () => {
  it('is a document this test can read, with a retention column', () => {
    expect(policy).toContain('for how long');
    expect(daysIn(retentionCellFor('HTTP exchanges from your application'))).not.toBeNull();
  });

  for (const [kind, named] of Object.entries(NAMED_IN_THE_POLICY) as [
    keyof typeof RETENTION_DAYS,
    string,
  ][]) {
    it(`matches what the engine stamps on a ${kind}`, () => {
      const promised = daysIn(retentionCellFor(named));
      expect(promised, `the row naming "${named}" promises no day count`).not.toBeNull();
      // Equality in both directions on purpose. Longer than promised is
      // over-retention of somebody else's data; shorter is evidence gone from
      // under a finding inside the window the customer was given to contest it.
      expect(promised).toBe(RETENTION_DAYS[kind]);
    });
  }
});

describe('the rule that has to keep holding', () => {
  it('names every kind the engine knows, so a new one cannot arrive unpromised', () => {
    expect(Object.keys(NAMED_IN_THE_POLICY).sort()).toEqual(Object.keys(RETENTION_DAYS).sort());
  });

  it('keeps screenshots the shortest, which is why the brief names them', () => {
    // PART 8.2: a screenshot of a working application can incidentally capture
    // a real person.
    expect(RETENTION_DAYS.screenshot).toBe(Math.min(...Object.values(RETENTION_DAYS)));
  });
});
