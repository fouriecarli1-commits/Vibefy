/**
 * An audit that reported on fewer migrations than it was given.
 *
 * `tools/migration-audit.mjs` derives one catalogue check per migration. When
 * it cannot derive one it prints `no marker found for … — add one by hand` to
 * stderr and `continue`s — dropping that migration from the generated query
 * and exiting 0. The documented invocation is
 *
 *     node tools/migration-audit.mjs > audit.sql
 *
 * so the warning goes to a screen nobody is reading and the exit code says
 * everything is fine. The resulting `audit.sql` then answers `nothing missing`
 * about a set that never contained the migration in question — which is the
 * one defect this whole tool exists to prevent, reproduced in the tool.
 *
 * `tests/migration-audit.test.ts` catches the case where a marker is missing
 * *in this repository*, which keeps CI honest. It says nothing about what the
 * tool does in the hands of somebody whose checkout is not CI-green, and
 * nothing about the exit code. That is this file.
 *
 * It also pins the other way an audit lies, which cost an hour tonight: a
 * stale `audit.sql`, generated before two markers were corrected, named two
 * migrations as missing from a database that had them. The file now says when
 * it was generated and how many migrations it covers.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TOOL = resolve('tools/migration-audit.mjs');
const MIGRATIONS = resolve('supabase/migrations');

type Run = { status: number; stdout: string; stderr: string };

function run(cwd: string): Run {
  const result = spawnSync('node', [TOOL], { cwd, encoding: 'utf8' });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * A checkout of this project with the migrations copied in, so a migration can
 * be added without one being left behind in `supabase/migrations`.
 */
function checkout(extra?: { name: string; sql: string }): string {
  const root = mkdtempSync(join(tmpdir(), 'audit-'));
  const dir = join(root, 'supabase', 'migrations');
  mkdirSync(dir, { recursive: true });
  for (const file of readdirSync(MIGRATIONS)) {
    if (file.endsWith('.sql')) copyFileSync(join(MIGRATIONS, file), join(dir, file));
  }
  if (extra) writeFileSync(join(dir, `${extra.name}.sql`), extra.sql);
  return root;
}

describe('a migration it could not derive a marker for', () => {
  /**
   * A migration that creates nothing the catalogue can be asked about and
   * names no marker of its own — the shape that is dropped.
   */
  const UNMARKABLE = {
    name: '29991231235959_an_update_that_creates_nothing',
    sql: 'update public.apps set name = name where false;\n',
  };

  it('is not silently left out of the query', () => {
    const { stdout } = run(checkout(UNMARKABLE));
    // Either it appears, or the run refused. What it must not do is produce a
    // query that omits it.
    const named = stdout.includes(UNMARKABLE.name);
    expect(named || stdout.trim() === '').toBe(true);
  });

  it('refuses rather than printing an audit that answers for fewer', () => {
    const result = run(checkout(UNMARKABLE));
    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it('says which migration, because the message is the remedy', () => {
    const result = run(checkout(UNMARKABLE));
    expect(result.stderr).toContain(UNMARKABLE.name);
  });
});

describe('this repository, where every migration carries a marker', () => {
  const clean = checkout();
  const result = run(clean);
  const total = readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).length;

  it('still generates an audit, or the refusal above is too strict', () => {
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/string_agg\(migration/);
  });

  it('has more than a handful of migrations, or these counts assert nothing', () => {
    expect(total).toBeGreaterThan(50);
  });

  it('says how many migrations it covers, and the number is the number of rows', () => {
    const claimed = Number(/covers (\d+) migration/i.exec(result.stdout)?.[1]);
    expect(claimed).toBe(total);
    const rows = new Set(
      [...result.stdout.matchAll(/\('(\d{14}_[a-z0-9_]+)'/g)].map((match) => match[1]!),
    );
    expect(rows.size).toBe(claimed);
  });

  it('says when it was generated, because a stale audit names migrations that are there', () => {
    // Measured tonight: an audit.sql from earlier in the same session, written
    // before two markers were corrected, reported those two as missing from a
    // database that had them. Nothing on the file said how old it was.
    const today = new Date().toISOString().slice(0, 10);
    expect(result.stdout).toContain(today);
  });

  it('reports the count it checked alongside the answer it gives', () => {
    // `nothing missing` is only worth anything next to how many were asked.
    expect(result.stdout).toMatch(/as checked/);
  });

  it('is still only comments and reads, with the header added', () => {
    const statements = result.stdout
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement.toLowerCase()).toMatch(/^(select|with)\b/);
    }
  });
});
