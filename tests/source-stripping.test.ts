/**
 * The comment stripper every source-text assertion rests on.
 *
 * `tests/setup/source.ts` says why it is one function and why it works in that
 * order. This is the part that would go red if either changed.
 */
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
