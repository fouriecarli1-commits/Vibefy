/**
 * The two disagreement notices that repeated themselves every five minutes.
 *
 * `monitoring.ts` rides the five-minute beat and carries two lines about
 * conditions that are not moments:
 *
 *   · **`rubric version disagreement`** — the database says one rubric is
 *     current and the engine scores against another, which happens when a
 *     publish migration has landed and the deploy has not. It lasts until
 *     somebody deploys. While it lasts, `sweepSupersededRubric` raises nothing
 *     at all and returns zero, so the line announcing that a whole feature is
 *     off was burying itself two hundred and eighty-eight times a day.
 *   · **`cadence disagreement`** — the query selected an application that
 *     `isReassessmentDue` says is not due. That is a defect in the predicate,
 *     and a defect in a predicate does not fix itself between sweeps, so the
 *     same application said the same thing every five minutes until somebody
 *     changed the code or the data.
 *
 * Both are the decision `spend alert` made in September and `data-subject
 * request overdue` made yesterday. Three copies of one rule in two files is how
 * a rule forks, so this is the run that moved it into `said-once.ts` and pointed
 * all four call sites at it.
 *
 * The counts and return values are untouched. A count is not a sentence anybody
 * has to re-read.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saidOnceADay } from '../apps/worker/src/said-once.ts';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('the rule itself', () => {
  it('is true the first time and false after, on the same day', () => {
    const notices = saidOnceADay();
    const noon = new Date('2026-10-01T12:00:00.000Z');

    expect(notices.due('thing', noon)).toBe(true);
    expect(notices.due('thing', new Date(noon.getTime() + 5 * 60_000))).toBe(false);
    expect(notices.due('thing', new Date(noon.getTime() + 11 * 60 * 60_000))).toBe(false);
  });

  it('is true again tomorrow, because the condition is still true', () => {
    // The opposite defect, and the one a naive fix produces: said once ever, so
    // a condition nobody acted on goes quiet and reads as handled.
    const notices = saidOnceADay();
    const today = new Date('2026-10-01T12:00:00.000Z');

    expect(notices.due('thing', today)).toBe(true);
    expect(notices.due('thing', new Date('2026-10-02T00:30:00.000Z'))).toBe(true);
  });

  it('keys by the thing, so one quiet condition never silences another', () => {
    const notices = saidOnceADay();
    const noon = new Date('2026-10-01T12:00:00.000Z');

    expect(notices.due('request:a', noon)).toBe(true);
    expect(notices.due('request:b', noon)).toBe(true);
    expect(notices.due('request:a', noon)).toBe(false);
  });

  it('forgets on request, because tests share one process', () => {
    const notices = saidOnceADay();
    const noon = new Date('2026-10-01T12:00:00.000Z');

    expect(notices.due('thing', noon)).toBe(true);
    notices.forget();
    expect(notices.due('thing', noon)).toBe(true);
  });

  it('crosses the day boundary in UTC rather than wherever the worker runs', () => {
    // A worker in Johannesburg and one in Frankfurt must agree on when "today"
    // ended, or the same condition is said twice at the same instant.
    const notices = saidOnceADay();

    expect(notices.due('thing', new Date('2026-10-01T23:59:59.000Z'))).toBe(true);
    expect(notices.due('thing', new Date('2026-10-02T00:00:01.000Z'))).toBe(true);
  });
});

describe('the four call sites', () => {
  const monitoring = read('apps/worker/src/monitoring.ts');
  const governance = read('apps/worker/src/governance.ts');

  it('rations the rubric disagreement, which lasts until somebody deploys', () => {
    // The guard sits *before* the line it rations, so the window looks back.
    const at = monitoring.indexOf('rubric version disagreement —');
    expect(at).toBeGreaterThan(0);
    expect(monitoring).toContain('saidOnceADay');
    expect(monitoring.slice(at - 400, at)).toMatch(/notices\.due\(/);
  });

  it('rations the cadence disagreement per application, not per sweep', () => {
    const at = monitoring.indexOf("'cadence disagreement:");
    expect(at).toBeGreaterThan(0);
    expect(monitoring.slice(at - 400, at)).toMatch(/notices\.due\(/);
    // Per application: a key naming only the sweep would let one bad row
    // silence every other bad row.
    expect(monitoring).toMatch(/due\(`cadence:\$\{[\w.]+\}`/);
  });

  it('leaves the two in governance using the same rule rather than their own', () => {
    expect(governance).toContain("from './said-once.ts'");
    // The two hand-rolled maps are gone, so there is one rule and not three.
    expect(governance).not.toMatch(/const lastSaid = new Map/);
    expect(governance).not.toMatch(/const lastNamed = new Map/);
  });

  it('still returns the same counts, because a count is not a sentence', () => {
    // The rationing must sit around the logging and nowhere else.
    expect(monitoring).toMatch(/if \(raised > 0\) log\('superseded-rubric notices raised'/);
  });
});
