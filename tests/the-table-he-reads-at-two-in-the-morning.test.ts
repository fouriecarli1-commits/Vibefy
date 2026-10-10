/**
 * The table in `docs/DOEN.md` that tells him what a message means.
 *
 * Step 1 of that document sends him to the Vercel log when the badge shows a
 * grey frame, and says the message there is "a full sentence saying what to
 * change". Then a table maps the sentence to the thing to do. It is the last
 * thing standing between him and being stuck.
 *
 * Measured on 2026-10-10: the sentence above it said three forms, the table had
 * four rows, and the two functions behind it can return six sentences. Two of
 * the six had no row at all — a connection string that is not a URL, and one
 * that starts with another scheme — so hitting either left him reading a table
 * that did not mention his message.
 *
 * The count is gone, because a number beside a list is one more thing to go
 * stale, and the rows are tied to the code here: every sentence the functions
 * can produce has a row, and every row names a phrase the functions can
 * produce. Driven with real inputs rather than compared as text, because what
 * matters is the sentence he will actually see.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutComments } from './setup/source.ts';
import {
  whatIsWrongWithTheConnectionString,
  whyTheDatabaseRefused,
} from '../apps/web/lib/connection-string.ts';

const DOEN = readFileSync('docs/DOEN.md', 'utf8');

/** The table's left column: the phrases the document tells him to look for. */
const phrases = (() => {
  const intro = DOEN.indexOf('Elke vorm wat dit');
  if (intro < 0) throw new Error('docs/DOEN.md no longer introduces the message forms');
  const table = DOEN.slice(intro, DOEN.indexOf('\n\n', DOEN.indexOf('|', intro)));
  return [...table.matchAll(/^\| `([^`]+)`(?:[^|]*`([^`]+)`)?/gm)].flatMap((row) =>
    [row[1], row[2]].filter((value): value is string => typeof value === 'string'),
  );
})();

/** Every failure the two functions recognise, as the input that produces it. */
const CASES: readonly { what: string; sentence: string | null }[] = [
  { what: 'not a URL at all', sentence: whatIsWrongWithTheConnectionString('just-a-password') },
  {
    what: 'another scheme',
    sentence: whatIsWrongWithTheConnectionString('https://db.example/postgres'),
  },
  {
    what: 'the placeholder left in',
    sentence: whatIsWrongWithTheConnectionString(
      // secret-scan-allow: the unreplaced placeholder is the case under test
      'postgresql://postgres:[YOUR-PASSWORD]@db.abc.supabase.co:5432/postgres',
    ),
  },
  {
    what: 'the dedicated pooler',
    sentence: whatIsWrongWithTheConnectionString(
      'postgresql://postgres:pw@db.abc.supabase.co:6543/postgres',
    ),
  },
  {
    what: 'the direct connection',
    sentence: whatIsWrongWithTheConnectionString(
      'postgresql://postgres:pw@db.abc.supabase.co:5432/postgres',
    ),
  },
  {
    what: 'the pooler with the wrong username',
    sentence: whatIsWrongWithTheConnectionString(
      'postgresql://postgres:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
    ),
  },
  { what: 'the tripped breaker', sentence: whyTheDatabaseRefused('circuit breaker open') },
];

describe('every message the functions can produce', () => {
  it('is a set this test actually built, and each one says something', () => {
    expect(CASES).toHaveLength(7);
    for (const { what, sentence } of CASES) {
      expect(sentence, `${what} produced no sentence`).not.toBeNull();
      expect(sentence!.length, what).toBeGreaterThan(40);
    }
  });

  it('found the table in the document', () => {
    expect(phrases.length).toBeGreaterThan(5);
  });

  it.each(CASES.map((c) => [c.what, c.sentence] as const))(
    'has a row in the table he reads: %s',
    (what, sentence) => {
      const covered = phrases.filter((phrase) => sentence!.includes(phrase));
      expect(
        covered,
        `No row in docs/DOEN.md matches the sentence for ${what}:\n  ${sentence}\n` +
          `Rows name: ${phrases.join(' | ')}`,
      ).not.toEqual([]);
    },
  );
});

describe('every sentence in the source, not only the ones I thought of', () => {
  /*
   * `CASES` above is a hand-kept list, which is the shape this whole night has
   * been about. A form added to the functions needs a case added here, and
   * nothing forced that: a mutation adding a sixth sentence to
   * `connection-string.ts` passed every assertion above.
   *
   * So the sentences are read out of the source as well, and this check asks
   * the weaker question its source can answer: does every sentence the file
   * can return have *some* row naming a phrase inside one of its literal runs?
   *
   * Weaker because a phrase can span an interpolation. The dedicated-pooler
   * sentence reads `which is ${dedicated ? 'the dedicated pooler' : 'the
   * direct connection'}`, so "which is the dedicated pooler" exists only once
   * it is rendered — which is why the table also carries a row for `publishes
   * no IPv4 address`, a run of that same sentence, and why the rendered
   * sentences in `CASES` are what the per-case assertions above use. Two
   * checks over two sources, each asking what it can actually see.
   */
  const literalRuns = (() => {
    const source = withoutComments(readFileSync('apps/web/lib/connection-string.ts', 'utf8'));
    const returns = [...source.matchAll(/return\s+(?:'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g)];
    return returns
      .map((match) => match[1] ?? match[2] ?? '')
      .filter((text) => text.length > 30)
      .map((text) => text.split(/\$\{[^}]*\}/));
  })();

  it('found them, and more than a couple', () => {
    expect(literalRuns.length).toBeGreaterThan(4);
  });

  it('every one has a row naming a phrase inside it', () => {
    const uncovered = literalRuns
      .filter((runs) => !runs.some((run) => phrases.some((phrase) => run.includes(phrase))))
      .map((runs) => runs.join('…').slice(0, 90));
    expect(
      uncovered,
      `Sentences connection-string.ts can return that no row in docs/DOEN.md mentions:\n  ${uncovered.join('\n  ')}\n` +
        'He would read the table and not find his message.',
    ).toEqual([]);
  });
});

describe('every row in the table', () => {
  it('names a phrase at least one message really contains', () => {
    const sentences = CASES.map((c) => c.sentence!).join('\n');
    const stale = phrases.filter((phrase) => !sentences.includes(phrase));
    expect(
      stale,
      `Rows in docs/DOEN.md naming phrases no message contains:\n  ${stale.join('\n  ')}\n` +
        'He would be looking for a line that cannot appear.',
    ).toEqual([]);
  });

  it('is not introduced by a count, which is one more thing to go stale', () => {
    // It said "Sy drie vorms" above four rows, over six possible messages.
    expect(DOEN).not.toMatch(/drie vorms/);
  });
});

describe('a connection string with nothing visibly wrong', () => {
  it('gets no sentence, so the table is never consulted for a working one', () => {
    // The positive control: a diagnosis that always spoke would make every
    // assertion above pass and tell him to change a string that is correct.
    expect(
      whatIsWrongWithTheConnectionString(
        'postgresql://postgres.abcdefgh:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
      ),
    ).toBeNull();
    expect(whyTheDatabaseRefused('password authentication failed')).toBeNull();
  });
});
