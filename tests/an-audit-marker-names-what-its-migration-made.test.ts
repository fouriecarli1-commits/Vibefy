/**
 * Whether the migration audit can tell "applied" from "already there".
 *
 * `migration-audit.mjs` prints one line per migration asking whether the thing
 * it left behind exists. A migration can say its own marker; otherwise the
 * tool guesses from the first pattern it matches, and the first pattern is
 * usually `create or replace function public.<name>`.
 *
 * That guess is wrong for every migration that *replaces* a function an
 * earlier one created. The object is already there, so the marker is true
 * before the migration runs and the audit reports it as applied — to somebody
 * about to run a batch of them by hand on a live database.
 *
 * Three were wrong, and two of them are the two that matter most: the one that
 * stops a rejection authorising an approval, and the one that stops a payment
 * being applied twice. The third was written the night before this test and
 * found by reading the audit's output rather than trusting it.
 *
 * So the rule is held here rather than in a reading. Every migration whose
 * marker is a guess must name something no earlier migration created.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'supabase/migrations');
const files = readdirSync(DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

/** What the tool would guess, in its own order, for a migration with no marker. */
function guessedObject(sql: string): { kind: string; name: string } | null {
  let m: RegExpExecArray | null;
  if ((m = /create table (?:if not exists )?public\.(\w+)/i.exec(sql))) {
    return { kind: 'table', name: m[1]! };
  }
  if ((m = /create type public\.(\w+)/i.exec(sql))) return { kind: 'type', name: m[1]! };
  if ((m = /create (?:or replace )?function public\.(\w+)/i.exec(sql))) {
    return { kind: 'function', name: m[1]! };
  }
  return null;
}

const creates = (sql: string, kind: string, name: string) => {
  const pattern =
    kind === 'table'
      ? new RegExp(`create table (?:if not exists )?public\\.${name}\\b`, 'i')
      : kind === 'type'
        ? new RegExp(`create type public\\.${name}\\b`, 'i')
        : new RegExp(`create (?:or replace )?function public\\.${name}\\b`, 'i');
  return pattern.test(sql);
};

describe('every migration the audit guesses about', () => {
  it('names something no earlier migration had already created', () => {
    const wrong: string[] = [];

    for (const [index, name] of files.entries()) {
      const sql = readFileSync(join(DIR, name), 'utf8');
      // A migration that says its own marker has overruled the guess, which is
      // exactly what the tool's comment invites it to do.
      if (/^\s*--\s*audit-marker:/im.test(sql)) continue;

      const guess = guessedObject(sql);
      if (!guess) continue;

      const earlier = files
        .slice(0, index)
        .find((before) => creates(readFileSync(join(DIR, before), 'utf8'), guess.kind, guess.name));
      if (earlier) {
        wrong.push(
          `${name}: the audit would look for ${guess.kind} "${guess.name}", which ${earlier} already created. Give it an "-- audit-marker:" naming something this migration makes.`,
        );
      }
    }

    expect(wrong, wrong.join('\n')).toEqual([]);
  });
});
