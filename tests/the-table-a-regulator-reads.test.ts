/**
 * The privacy notice publishes a retention figure per evidence kind, and the
 * test that held our numbers together read a different document.
 *
 * `tests/governance.test.ts` pins `RETENTION_SCHEDULE` — the per-data-class
 * table rendered on `/console/privacy` — to `RETENTION_DAYS` in the engine, by
 * its longest and shortest values. That is the right pin for that surface.
 *
 * `legal/privacy-policy.md` publishes something finer: a row per kind of
 * artefact, with its own number. HTTP exchanges ninety days, console logs
 * sixty, DOM snapshots thirty, screenshots and browser traces thirty. That
 * document is the one a customer is given to rely on and the one a regulator
 * would read, and nothing joined it to the code. Raise `console_log` to a
 * hundred and twenty and the notice understates how long we keep somebody's
 * data, in the sentence they were handed.
 *
 * The completeness half matters more than any single row: a new evidence kind
 * with no row in that table is a thing we keep and never said we keep.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RETENTION_DAYS } from '../packages/engine/src/runtime/evidence.ts';

const POLICY = readFileSync('legal/privacy-policy.md', 'utf8');
const APPEALS = readFileSync('legal/appeals-and-corrections.md', 'utf8');
const GOVERNANCE_MIGRATION = readFileSync(
  'supabase/migrations/20260822093000_governance.sql',
  'utf8',
);

/**
 * The interval a table's `due_at` defaults to, read from the migration.
 *
 * The migration rather than the generated `schema.sql`, because the migration
 * is where somebody changes it, and from the table's own block rather than the
 * file, because two tables in it have a `due_at` and they promise different
 * things to different people.
 */
function dueAtDaysFor(table: string): number {
  const start = GOVERNANCE_MIGRATION.indexOf(`create table public.${table}`);
  if (start === -1) throw new Error(`no create table for ${table}`);
  const end = GOVERNANCE_MIGRATION.indexOf('\n);', start);
  const block = GOVERNANCE_MIGRATION.slice(start, end === -1 ? undefined : end);
  const interval = /due_at[^;]*?interval '(\d+) days'/.exec(block);
  if (!interval) throw new Error(`${table} sets no due_at interval in days`);
  return Number(interval[1]);
}

/**
 * Which row of the published table speaks for which evidence kind.
 *
 * Written out because the mapping is editorial: the notice groups kinds the way
 * a reader thinks about them ("screenshots and browser traces"), not the way
 * the engine names them. Every kind must appear here or the last test fails,
 * so the list cannot fall behind the engine quietly.
 */
const PUBLISHED_AS: Readonly<Record<keyof typeof RETENTION_DAYS, RegExp>> = {
  http_exchange: /HTTP exchanges from your application/i,
  console_log: /Console logs from your application/i,
  dom_snapshot: /DOM snapshots of your application/i,
  screenshot: /Screenshots and browser traces/i,
  playwright_trace: /Screenshots and browser traces/i,
  header_scan: /Header scans, dependency reports/i,
  dependency_report: /Header scans, dependency reports/i,
  lighthouse_report: /Header scans, dependency reports/i,
  accessibility_scan: /Header scans, dependency reports/i,
};

function publishedDaysFor(pattern: RegExp): number {
  const row = POLICY.split('\n').find((line) => line.startsWith('|') && pattern.test(line));
  if (!row) throw new Error(`no row in the privacy notice matches ${pattern}`);
  const keptFor = row.split('|').at(-2) ?? '';
  const days = /(\d+)\s*days/i.exec(keptFor);
  if (!days) throw new Error(`the row matching ${pattern} names no number of days: ${keptFor}`);
  return Number(days[1]);
}

describe('the retention figures in the privacy notice', () => {
  it('matches what the engine stamps, kind by kind', () => {
    for (const [kind, pattern] of Object.entries(PUBLISHED_AS)) {
      const enforced = RETENTION_DAYS[kind as keyof typeof RETENTION_DAYS];
      expect(publishedDaysFor(pattern), `${kind} in legal/privacy-policy.md`).toBe(enforced);
    }
  });

  it('has a row for every kind the engine can capture', () => {
    // The half that cannot be satisfied by coincidence. A kind added to the
    // engine with no row in the notice is data we keep and never said we keep,
    // and the engine is where somebody adds one.
    expect(Object.keys(PUBLISHED_AS).sort()).toEqual(Object.keys(RETENTION_DAYS).sort());
  });

  it('still says the deletion is done by a job rather than by intention', () => {
    // The sentence under the table is the operative promise: the dates above it
    // are stamped on capture and a sweep deletes on them. If that sentence goes,
    // the table is a statement of hope.
    expect(POLICY).toMatch(/enforced by scheduled deletion jobs, not by intention/i);
  });

  it('reads a real number, so a broken parse cannot pass as agreement', () => {
    // The positive control. Every assertion above rests on this function
    // finding a row and a number in it; a parse that quietly returned
    // something falsy would make them all trivially true.
    expect(publishedDaysFor(/HTTP exchanges from your application/i)).toBeGreaterThan(0);
    expect(() => publishedDaysFor(/a row the notice does not contain/)).toThrow(/no row/);
  });
});

describe('the deadlines the documents promise', () => {
  it('gives an appeal the fourteen days the appeals policy publishes', () => {
    /*
     * Published as "decision within 14 days of acknowledgement", and set by a
     * column default rather than by a person remembering — which is the half
     * the migration's own comment is about: "a published appeals route with no
     * deadline is not a route". What was missing is anything joining the two
     * numbers, so a change to either would have been quiet.
     */
    expect(APPEALS).toMatch(/Decision within 14 days/i);
    expect(dueAtDaysFor('appeals')).toBe(14);
  });

  it('gives a data request the thirty days the privacy notice publishes', () => {
    // "We respond within 30 days", two sentences after the notice calls these
    // working flows in the product rather than an email address in a footer.
    expect(POLICY).toMatch(/respond within 30 days/i);
    expect(dueAtDaysFor('data_requests')).toBe(30);
  });

  it('reads the right table, so one deadline cannot stand in for the other', () => {
    // The positive control this needs most: both tables have a `due_at`, and a
    // parse that found the first one in the file would have made the two
    // assertions above agree with each other rather than with the documents.
    expect(dueAtDaysFor('appeals')).not.toBe(dueAtDaysFor('data_requests'));
    expect(() => dueAtDaysFor('a_table_that_does_not_exist')).toThrow(/no create table/);
  });
});
