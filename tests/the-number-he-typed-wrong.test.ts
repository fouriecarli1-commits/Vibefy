/**
 * The repair tool, asked to repair nothing.
 *
 * `tools/idempotent-catch-up.mjs` takes a migration number and rewrites
 * everything from there onward into a form safe to run twice. The number is
 * compared as a string against the migration filenames, and a string that
 * sorts after all of them selects none — so a mistyped digit produced a file
 * of pure comments, exit 0, and a header reading
 *
 *     -- Covers 0 migration(s), from undefined onward, in order.
 *
 * Pasted into Supabase that answers "Success. No rows returned", which is
 * exactly what a correct catch-up on an up-to-date database also answers. The
 * person who typed the digit wrong is told he is finished.
 *
 * `tests/idempotent-catch-up.test.ts` is thorough about what the rewriting
 * does to each kind of statement and says nothing about the argument that
 * decides which statements it sees. This is that argument.
 *
 * It matters more since `docs/DOEN.md` started telling him to pass the number
 * every time — the advice that makes the output eight hundred lines instead of
 * eight thousand also makes a typo the normal way to fail.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const TOOL = 'tools/idempotent-catch-up.mjs';

type Run = { status: number; stdout: string; stderr: string };

/*
 * `spawnSync`, not `execFileSync`, which returns stdout alone. The first draft
 * of this helper hardcoded `stderr: ''` on the success path, so the assertion
 * about what a successful run prints to stderr could not have passed whatever
 * the tool did — the second signature of a test that proves nothing, in the
 * test written to catch the first.
 */
function run(...args: string[]): Run {
  const result = spawnSync('node', [TOOL, ...args], { encoding: 'utf8' });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

const migrations = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql'))
  .map((file) => file.replace(/\.sql$/, ''))
  .sort();

describe('a number no migration carries', () => {
  it('is refused rather than answered with an empty file', () => {
    const result = run('20261231000000');
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toMatch(/-- ▼/);
  });

  it('says which number was not found, because the message is the whole remedy', () => {
    const result = run('20261231000000');
    expect(result.stderr).toContain('20261231000000');
    expect(result.stderr).toMatch(/OUTSTANDING\.sql/);
  });

  it('is refused for a transposed digit in the middle of a real number', () => {
    // 20260923110000_second_step_at_the_action exists; this does not. The old
    // behaviour selected every migration at or after it by string order, which
    // for a transposition inside the date is a range nobody asked for.
    const real = migrations.find((name) => name.startsWith('20260923110000'));
    expect(real).toBeDefined();
    expect(run('20260923101000').status).not.toBe(0);
  });

  it('is refused for a misspelt name even when the digits are right', () => {
    expect(run('20260923110000_second_step_at_the_acton').status).not.toBe(0);
  });
});

describe('the numbers the documentation actually tells him to type', () => {
  /** Every block header in the file he is asked to paste. */
  const outstanding = [
    ...readFileSync('docs/sql/OUTSTANDING.sql', 'utf8').matchAll(
      /^-- (20\d{12}_[a-z0-9_]+)\.sql$/gm,
    ),
  ].map((match) => match[1]!);

  it('finds some, or this suite is asserting nothing', () => {
    expect(outstanding.length).toBeGreaterThan(10);
  });

  it('every one of them is accepted', () => {
    for (const name of outstanding) {
      const result = run(name);
      expect(result.status, `${name}: ${result.stderr}`).toBe(0);
      expect(result.stdout, name).toMatch(/-- ▼/);
    }
  });

  it('a bare timestamp without the name is accepted too', () => {
    // How tests/idempotent-catch-up.test.ts passes it, and a reasonable thing
    // to type. The refusal must not be stricter than the tool's own callers.
    const bare = migrations[0]!.slice(0, 14);
    expect(run(bare).status).toBe(0);
  });

  it('no argument at all still means every migration', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout.match(/-- ▼/g)?.length).toBe(migrations.length);
  });
});

describe('what the run tells the person who started it', () => {
  it('names the count and the starting migration on stderr, where a redirect cannot hide it', () => {
    // The documented invocation is `… > catch-up.sql`, so the header goes into
    // the file and not onto his screen. The confirmation he can act on has to
    // arrive on the other stream.
    const first = migrations.find((name) => name.startsWith('20260923110000'))!;
    const result = run(first);
    expect(result.stderr).toContain(first);
    /*
     * Counted from the migrations on disk rather than written here.
     *
     * This said `18`, which was true on the day and became false the moment a
     * nineteenth migration was added — a hand-kept number in a test about a
     * tool that exists because a hand-kept number went wrong. The count the
     * tool prints is the one he reads to know how many blocks to expect, so
     * what matters is that it matches what is outstanding, not what it was.
     */
    const outstanding = migrations.filter((name) => name >= first).length;
    expect(outstanding).toBeGreaterThan(1);
    expect(result.stderr).toMatch(new RegExp(`\\b${outstanding}\\b`));
  });

  it('names the starting migration in the header without the .sql it never had', () => {
    const first = migrations.find((name) => name.startsWith('20260923110000'))!;
    const header = run(first).stdout.split('\n').slice(0, 12).join('\n');
    expect(header).toContain(`from ${first} onward`);
    expect(header).not.toContain(`${first}.sql`);
  });

  it('the count in the header is the number of blocks beneath it', () => {
    const out = run(migrations[0]!.slice(0, 14)).stdout;
    const claimed = Number(/Covers (\d+) migration/.exec(out)![1]);
    expect(claimed).toBe(out.match(/-- ▼/g)!.length);
  });
});
