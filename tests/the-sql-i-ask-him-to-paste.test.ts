/**
 * `docs/sql/OUTSTANDING.sql` is the only file in this repository that somebody
 * runs against the production database by hand, and until now nothing checked
 * it.
 *
 * Anré has no migration runner. The deployment story is that he opens
 * Supabase's SQL window and pastes the blocks from that document in order. It
 * is assembled by hand — I append a copy of each new migration to it — so it
 * can diverge from `supabase/migrations/` in four ways, and every one of them
 * is worse than a test failing:
 *
 *   · a block whose SQL is not what the migration says, so the schema his
 *     database ends up with is not the one the tests ran against;
 *   · a migration missing from the document, so a rule the code assumes is
 *     simply absent in production and nothing says so until something breaks;
 *   · blocks out of order, so one referring to an object a later one creates
 *     fails halfway, in a SQL window, with no transaction around it;
 *   · the count in the first line, which is the sentence he reads to know when
 *     he is done, disagreeing with the number of blocks.
 *
 * Checked 2026-10-08 before this file existed: seventeen blocks, in order,
 * each matching its migration, none missing. So this starts green, which is
 * the wrong way round — but the alternative is leaving the one hand-assembled
 * artefact in the repository as the only thing with no test, and that is worse
 * than a test that was green on the day it was written.
 *
 * The comparison is statement lines only: a block may carry a shortened
 * version of the migration's own header banner, and prose drifting is not what
 * this is about.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = 'supabase/migrations';
const DOCUMENT = 'docs/sql/OUTSTANDING.sql';

/** Afrikaans for the counts this list could plausibly reach. */
const COUNT_WORDS: readonly string[] = [
  'nul',
  'een',
  'twee',
  'drie',
  'vier',
  'vyf',
  'ses',
  'sewe',
  'agt',
  'nege',
  'tien',
  'elf',
  'twaalf',
  'dertien',
  'veertien',
  'vyftien',
  'sestien',
  'sewentien',
  'agtien',
  'negentien',
  'twintig',
  'een-en-twintig',
  'twee-en-twintig',
  'drie-en-twintig',
  'vier-en-twintig',
  'vyf-en-twintig',
  'ses-en-twintig',
  'sewe-en-twintig',
  'agt-en-twintig',
  'nege-en-twintig',
  'dertig',
];

/** Lines that are SQL rather than explanation. */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith('--'));
}

const document = readFileSync(DOCUMENT, 'utf8');
const blocks = document.split(/^-- =+\n-- ([0-9]{14}_[a-z0-9_]+\.sql)\n-- =+\n/m);
const names = blocks.filter((_, index) => index % 2 === 1);
const bodies = blocks.filter((_, index) => index % 2 === 0).slice(1);
const onDisk = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort();

describe('the document he pastes', () => {
  it('has blocks at all, which is how this test passes having read nothing', () => {
    expect(names.length).toBeGreaterThan(5);
    expect(bodies.length).toBe(names.length);
  });

  it('names only migrations that exist', () => {
    const unknown = names.filter((name) => !onDisk.includes(name));
    expect(
      unknown,
      `the document names migrations that are not on disk:\n  ${unknown.join('\n  ')}`,
    ).toEqual([]);
  });

  it('carries each migration’s own SQL, statement for statement', () => {
    const wrong: string[] = [];
    for (const [index, name] of names.entries()) {
      if (!onDisk.includes(name)) continue;
      const expected = statements(readFileSync(join(MIGRATIONS, name), 'utf8'));
      const actual = statements(bodies[index] ?? '');
      if (expected.join('\n') !== actual.join('\n')) {
        wrong.push(
          `${name}: ${expected.length} statement line(s) in the migration, ${actual.length} in the document`,
        );
      }
    }
    expect(
      wrong,
      'a block in the document is not what the migration says, so pasting it would build a ' +
        `different schema from the one these tests ran against:\n  ${wrong.join('\n  ')}`,
    ).toEqual([]);
  });

  it('lists them in the order they must be run', () => {
    // Timestamp order is the order, because that is the order the test harness
    // applies them in. A block that comes before one it depends on fails
    // halfway through a paste, with nothing to roll back.
    expect(names).toEqual([...names].sort());
  });

  it('leaves out no migration from the first one it lists onwards', () => {
    const first = names[0];
    expect(first, 'the document lists nothing').toBeDefined();
    const expected = onDisk.filter((file) => file >= (first ?? ''));
    const missing = expected.filter((file) => !names.includes(file));
    expect(
      missing,
      'a migration is outstanding and not in the document, so it would never be applied and ' +
        `nothing would say so:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('says how many there are, in the line he reads to know when he is done', () => {
    const word = COUNT_WORDS[names.length];
    expect(word, `no Afrikaans word on file for ${names.length}; add it`).toBeDefined();
    const first = document.split('\n')[0] ?? '';
    expect(
      first.toLowerCase(),
      `the first line of the document should say "${word} migrasies" and says: ${first}`,
    ).toContain(`${word} migrasies`);
  });

  it('is counted the same way in the page that sends him there', () => {
    // `docs/DOEN.md` section 4 is the instruction; the document is the thing.
    // Two counts written by hand in two files is two chances to be wrong.
    const word = COUNT_WORDS[names.length];
    const doen = readFileSync('docs/DOEN.md', 'utf8').toLowerCase();
    expect(doen, `DOEN.md should say "${word} migrasies" somewhere`).toContain(`${word} migrasies`);
  });
});
