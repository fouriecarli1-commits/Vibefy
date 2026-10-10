/**
 * The comment stripper every source-text assertion rests on.
 *
 * `tests/setup/source.ts` says why it is one function and why it works in that
 * order. This is the part that would go red if either changed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withoutComments } from './setup/source.ts';

describe('what it removes', () => {
  it('takes out a line comment', () => {
    expect(withoutComments('// a note\nconst a = 1;')).toContain('const a = 1;');
    expect(withoutComments('// a note\nconst a = 1;')).not.toContain('a note');
  });

  it('takes out a block comment, including a multi-line one', () => {
    expect(withoutComments('/* a\n * note\n */\nconst a = 1;')).not.toContain('note');
    expect(withoutComments('/* a\n * note\n */\nconst a = 1;')).toContain('const a = 1;');
  });

  it('takes out a trailing block comment without eating the code', () => {
    expect(withoutComments('const a = 1; /* why */')).toContain('const a = 1;');
  });
});

describe('what it must not remove', () => {
  it('keeps a line a commented-out mention was meant to hide', () => {
    // The order that matters. Block-first runs from the opener in the first
    // line to the closer in the third and deletes the call between them.
    const source = ['// removed the call /*', 'dangerous();', '// */'].join('\n');
    expect(withoutComments(source)).toContain('dangerous();');
  });

  it('keeps the rest of a line that contains a URL', () => {
    // Four of the strippers this replaced matched `//` anywhere, so this line
    // became `const url = 'https:` and a rule about what follows stopped
    // seeing it.
    const source = "const url = 'https://vibefycode.com/badge/x.svg';";
    expect(withoutComments(source)).toContain('badge/x.svg');
  });

  it('keeps a protocol-relative URL too', () => {
    expect(withoutComments("src: '//cdn.example/x.js',")).toContain('cdn.example');
  });

  it('keeps code that merely follows a comment on an earlier line', () => {
    expect(withoutComments('// one\n// two\nkeep();\n// three')).toContain('keep();');
  });
});

describe('where the line it keeps and the line it cuts differ', () => {
  it('takes out a trailing comment after code, which a URL is not', () => {
    /*
     * The distinction is the character in front of the slashes, and it does
     * the whole job: a comment is preceded by whitespace or starts the line, a
     * scheme is preceded by a colon, and a protocol-relative URL by a quote.
     *
     * Written down because the first draft of this file asserted the opposite
     * — that a trailing comment survives — on the theory that it could not be
     * told apart from a scheme. It can, and the stricter behaviour is the
     * better one, so the assertion follows the function rather than the other
     * way round.
     */
    expect(withoutComments('const a = 1; // mentions dangerous()')).not.toContain('dangerous()');
    expect(withoutComments('const a = 1; // mentions dangerous()')).toContain('const a = 1;');
    expect(withoutComments("fetch('https://x/y');")).toContain('x/y');
  });
});

describe('who strips comments', () => {
  /*
   * One function, and nothing beside it.
   *
   * There were seven inline spellings across five files on 2026-10-10, two of
   * them wrong in ways that could delete the thing an assertion was looking
   * for. They are gone; this is what stops the eighth. A suite where every
   * file decides for itself how to strip a comment is a suite where one of
   * them decides wrongly and passes.
   */
  const STRIPPER = /\.replace\(\s*\/\\?\(\^\|\\s\\?\)?\\\/\\\//;
  const BLOCK_STRIPPER = /\.replace\(\s*\/\\\/\\\*\[/;

  /**
   * The one file allowed to contain the pattern, because it is the pattern.
   *
   * Named rather than derived: a guard that excluded "whatever file matches"
   * would excuse the next copy as readily as the original. The same trap as
   * the stub checker reading its own scan list, which took a rename to fix.
   */
  const THE_FUNCTION = 'tests/setup/source.ts';

  const testFiles = readdirSync('tests')
    .filter((entry) => entry.endsWith('.test.ts'))
    .map((entry) => `tests/${entry}`);

  it('found the suite, or this proves nothing', () => {
    expect(testFiles.length).toBeGreaterThan(100);
  });

  it('recognises a stripper when it sees one', () => {
    // The positive control: both spellings that were in the suite this
    // morning, and the one that survives in the shared function.
    expect(STRIPPER.test(String.raw`source.replace(/(^|\s)\/\/.*$/gm, '$1')`)).toBe(true);
    expect(BLOCK_STRIPPER.test(String.raw`source.replace(/\/\*[\s\S]*?\*\//g, ' ')`)).toBe(true);
    expect(STRIPPER.test("source.replace(/x/, 'y')")).toBe(false);
  });

  /**
   * The two files allowed to contain the pattern, and why each one is.
   *
   * Named with reasons rather than derived, because a guard that excused
   * "whatever matches" would excuse the next copy as readily as these two —
   * the same trap as the stub checker that matched its own scan list, which
   * took a rename to fix.
   */
  const ALLOWED: Readonly<Record<string, string>> = {
    'tests/source-stripping.test.ts':
      'This file. Its positive control has to contain the pattern to prove the sweep can see one, which is the whole reason the control exists.',
    'tests/the-score-nobody-may-publish-unmeasured.test.ts':
      'A different function: it replaces every comment character with a space so that line and column numbers survive, because its failure message points at a line in the file it read. Stripping to nothing would move every line after the first comment.',
  };

  it('is nobody but the shared function', () => {
    const offenders = testFiles.filter((path) => {
      if (path in ALLOWED) return false;
      const source = readFileSync(path, 'utf8');
      return STRIPPER.test(source) || BLOCK_STRIPPER.test(source);
    });
    expect(
      offenders,
      'strip comments through withoutComments in tests/setup/source.ts, which is the one place ' +
        'the order of the two strips is decided',
    ).toEqual([]);
  });

  it('is in the shared function, which this test did not find because it is not a test file', () => {
    // The other half of the claim above: the pattern exists somewhere, and
    // the sweep would be vacuous if it did not.
    const source = readFileSync(THE_FUNCTION, 'utf8');
    expect(STRIPPER.test(source) || BLOCK_STRIPPER.test(source)).toBe(true);
  });
});

describe('the two files allowed their own stripper', () => {
  it('still contain one, so the exceptions are not stale', () => {
    // An exception for a file that no longer needs it is a hole kept open for
    // nothing, and it would be the obvious place for the next copy to land.
    for (const path of [
      'tests/source-stripping.test.ts',
      'tests/the-score-nobody-may-publish-unmeasured.test.ts',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(/\\\/\\\//.test(source) || source.includes('replace('), path).toBe(true);
    }
  });
});
