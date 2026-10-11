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
import { dirname, join } from 'node:path';
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

  it('says how many there are, in the part he reads before he pastes', () => {
    /*
     * The header, not the first line.
     *
     * It was the first line until 2026-10-11, and the first line is now the
     * instruction — Ctrl+A, Ctrl+C, paste, Run — because of what he said when
     * he opened this file: *"Ek weet nie waar 'n sql moet begin nie."* The
     * count still has to be here and still has to be right; where it sits in
     * the header is a question about what a person reads first, and the answer
     * is not a number.
     */
    const word = COUNT_WORDS[names.length];
    expect(word, `no Afrikaans word on file for ${names.length}; add it`).toBeDefined();
    const header = document.split(/^-- BLOK 1 VAN /m)[0] ?? '';
    expect(header.length, 'the document has no header before its first block').toBeGreaterThan(200);
    expect(
      header.toLowerCase(),
      `the header should say "${word} migrasies" and does not`,
    ).toContain(`${word} migrasies`);
  });

  it('numbers every block, so "it stopped at twelve" is a sentence he can say', () => {
    /*
     * One hundred kilobytes of SQL with nineteen blocks in it, and no way to
     * tell from inside it where you are. The paste is still the whole file in
     * one go — `tools/outstanding-split.mjs` only adds the numbers — but a
     * number above each banner is the difference between "it broke" and "it
     * stopped at block twelve", which is the half of the report I can act on.
     */
    const stamped = [...document.matchAll(/^-- BLOK (\d+) VAN (\d+)$/gm)].map((match) => ({
      position: Number(match[1]),
      total: Number(match[2]),
    }));
    expect(stamped).toHaveLength(names.length);
    expect(stamped.map((entry) => entry.position)).toEqual(names.map((_, index) => index + 1));
    for (const entry of stamped) {
      expect(entry.total, 'a block says there are a different number of them').toBe(names.length);
    }
  });

  it('is split into one file per block, with nothing lost and nothing stale', () => {
    /*
     * `docs/sql/een-vir-een/` is for the day a block fails and the rest should
     * not be re-run. Generated from this document, so there is nothing to keep
     * in step by hand — and asserted here, because a folder that is quietly one
     * migration short is worse than no folder: it looks complete.
     */
    const folder = join(dirname(DOCUMENT), 'een-vir-een');
    const files = readdirSync(folder).sort();
    expect(files).toHaveLength(names.length);
    names.forEach((name, index) => {
      const expectedName = `${String(index + 1).padStart(2, '0')}-${name}`;
      expect(files[index]).toBe(expectedName);
      const split = statements(readFileSync(join(folder, expectedName), 'utf8'));
      const inDocument = statements(bodies[index] ?? '');
      expect(split.join('\n'), `${expectedName} is not what the document says`).toBe(
        inDocument.join('\n'),
      );
    });
  });

  it('is counted the same way in the page that sends him there', () => {
    // `docs/DOEN.md` section 4 is the instruction; the document is the thing.
    // Two counts written by hand in two files is two chances to be wrong.
    const word = COUNT_WORDS[names.length];
    const doen = readFileSync('docs/DOEN.md', 'utf8').toLowerCase();
    expect(doen, `DOEN.md should say "${word} migrasies" somewhere`).toContain(`${word} migrasies`);
  });
});
