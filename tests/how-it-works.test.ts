/**
 * The page that has to be true before anybody will use this product.
 *
 * Somebody who built an app quickly is being asked to let a stranger's software
 * open it. "Trust us" is worth nothing there — it is what the thing they are
 * afraid of would also say. So the page describes the mechanism and states the
 * limits as facts about the code, and these assert the two properties that make
 * that worth reading: the numbers come from the code that enforces them, and the
 * page can be found without knowing it exists.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Relative paths, as the other root tests use: this suite runs from the
// repository root, where the workspace's package names are not resolvable.
import { DEFAULT_CEILING } from '../packages/engine/src/runtime/scope.ts';
import { RETENTION_DAYS } from '../packages/engine/src/runtime/evidence.ts';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const page = read('apps/web/app/how-it-works/page.tsx');

describe('the numbers are read from the code, not restated', () => {
  it('imports the ceiling the scope guard actually enforces', () => {
    // Prose drifts away from the limit it describes within a release, and the
    // drift always goes one way: the page keeps claiming the safer number.
    expect(page).toContain("from '@vibefycode/engine/scope'");
    expect(page).toContain('DEFAULT_CEILING.maxRequestsPerMinute');
    expect(page).toContain('DEFAULT_CEILING.maxTotalRequests');
    expect(page).toContain('DEFAULT_CEILING.maxDurationSeconds');
  });

  it('imports the retention periods the evidence store applies', () => {
    expect(page).toContain("from '@vibefycode/engine/evidence'");
    expect(page).toContain('RETENTION_DAYS');
  });

  it('writes no ceiling number out as a literal', () => {
    // The failure this prevents: someone lowers the ceiling in the guard and the
    // page goes on advertising the old, looser one — or the reverse, which is
    // worse, because then the page is a promise the code does not keep.
    // The unit conversion is exempt by name rather than by pattern: `60` also
    // means seconds-per-minute here, and a test that cannot tell the difference
    // would be satisfied by renaming rather than by fixing.
    const body = page.replace(/SECONDS_PER_MINUTE = 60/, 'SECONDS_PER_MINUTE');
    for (const value of [
      String(DEFAULT_CEILING.maxRequestsPerMinute),
      String(DEFAULT_CEILING.maxTotalRequests),
      String(DEFAULT_CEILING.maxDurationSeconds),
    ]) {
      expect(body, `${value} is written out rather than imported`).not.toMatch(
        new RegExp(`[^\\w./]${value}[^\\w]`),
      );
    }
  });

  it('lists every kind of evidence there is, by rendering them', () => {
    expect(Object.keys(RETENTION_DAYS).length).toBeGreaterThan(5);
    expect(page).toContain('Object.entries(RETENTION_DAYS)');
  });
});

describe('what the page has to say', () => {
  it('answers the question about source code first', () => {
    // It is the first thing anybody asks and the strongest true answer we have:
    // there is no code path that could read a repository.
    expect(page).toMatch(/never see your code/i);
    expect(page.indexOf('never see your code')).toBeLessThan(page.indexOf('five steps'));
  });

  it('states the limits as what the code cannot do', () => {
    expect(page).toMatch(/unable to do/i);
    expect(page).toMatch(/DELETE, PUT and PATCH are never sent/);
    expect(page).toMatch(/[Ss]ynthetic test accounts only/);
  });

  it('keeps the scope disclaimer, in the same words as everywhere else', () => {
    expect(page).toContain('not a penetration test');
    expect(page).toContain('Absence of a finding is not evidence');
  });
});

describe('it can be found', () => {
  it('is in the navigation, not only at a URL somebody has to know', () => {
    // The console overview taught this one: a page nothing links to is a page
    // that does not exist for the person who needs it.
    expect(read('apps/web/components/site-nav.tsx')).toContain("href: '/how-it-works'");
  });

  it('is offered from the home page, where the decision is being made', () => {
    expect(read('apps/web/app/page.tsx')).toContain('/how-it-works');
  });
});

describe('the page does not contradict the ceiling it prints', () => {
  // The first draft said "typically twenty to forty minutes" three lines above a
  // ceiling of thirty. Both numbers were rendered honestly and the sentence was
  // still false, which is the failure a page like this can least afford: someone
  // who spots it stops believing the rest of it, and they are right to.
  it('quotes no duration longer than the ceiling allows', () => {
    const limit = DEFAULT_CEILING.maxDurationSeconds / 60;
    for (const match of page.matchAll(/(\d+)\s*(?:to\s*(\d+)\s*)?minutes/g)) {
      for (const value of [match[1], match[2]].filter(Boolean)) {
        expect(
          Number(value),
          `${value} minutes exceeds the ${limit}-minute ceiling`,
        ).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('states the limit in minutes rather than in fractions of an hour', () => {
    // "0.5 hours" is a way of writing thirty minutes that nobody reads as thirty.
    expect(page).not.toMatch(/\{hours\}/);
    expect(page).toContain('{minutes} min');
  });
});
