/**
 * Source with its comments removed.
 *
 * Twenty-five test files strip comments before asserting something about code,
 * because the comment above a rule necessarily names the thing the rule
 * forbids. On 2026-10-10 they did it seven different ways, and two of those
 * ways were wrong:
 *
 *   · **Sixteen stripped block comments first.** A line comment containing an
 *     opening sequence then runs to the next closing one and takes the code
 *     between them with it:
 *
 *         // we removed the installGlobalDispatcher() call /*
 *         installGlobalDispatcher();
 *         // *\/
 *
 *     Block-first leaves nothing of the call. Line-first removes all three
 *     comments and leaves it where the assertion can see it. A stripper that
 *     can delete the thing being looked for is a stripper that can make any of
 *     these assertions pass.
 *
 *   · **Four matched `//` anywhere on a line.** `const url = 'https://x/y'`
 *     becomes `const url = 'https:` — so a rule about what a line contains
 *     stops seeing the rest of any line with a URL in it.
 *
 * Four files already carried a local `withoutComments` with exactly this name
 * and exactly the second fault, and one of them guards "the service-role key
 * must never reach a public read" over `apps/web/lib/badge-verification.ts` —
 * a file whose whole subject is a Supabase client and its URLs. Nothing is
 * compromised there today, because no line in it carries a URL. The day one
 * does, and carries a forbidden token after it, that absence assertion starts
 * passing for the wrong reason.
 *
 * The remaining copies were left in place and reordered rather than replaced.
 * A twenty-three-site mechanical rewrite of the suite, by regex, at three in
 * the morning, produced four call sites that compiled and stripped the wrong
 * thing — including one that swallowed a comment as its own argument. The
 * order is fixed everywhere; migrating the rest to this function is a
 * deliberate job for daylight, noted in `docs/RUNBOOK.md`.
 *
 * So: line comments first, and only where `//` follows the start of a line or
 * a space. That one condition does the whole job, because the character in
 * front of the slashes is the difference: a comment is preceded by whitespace
 * or starts the line, a scheme by a colon, a protocol-relative URL by a quote.
 * A trailing comment after code is therefore removed, and the URL on the same
 * kind of line is not.
 *
 * This paragraph said the opposite until 2026-10-10 — that a trailing comment
 * survives, on the theory that it could not be told apart from a scheme. It
 * can, `tests/source-stripping.test.ts` has said so since the day it was
 * written, and the sentence here was simply left behind. A false sentence in
 * the file every source-text assertion rests on is worth more than a defect in
 * one of them.
 */
export function withoutComments(source: string): string {
  return source.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * The same removal, with the lines kept where they were.
 *
 * Two assertions in this suite report a line number — the one that points at an
 * unmeasured score and the one that points at a handler which swallows a
 * failure and says nothing — and `withoutComments` collapses a block comment to
 * a single space, which moves every line after it. A message pointing at the
 * wrong line is worse than one pointing at none, because somebody reads that
 * line and concludes the test is wrong.
 *
 * Both had their own copy. One of them stripped blocks first, which is the
 * order the paragraph above says can delete the code an assertion looks for,
 * and matched only a line comment that begins a line, so a trailing one
 * survived and its text was searched as though it were code. One function in
 * the one place the order is decided, as above: the character of every comment
 * becomes a space and every newline stays.
 */
export function commentsBlanked(source: string): string {
  return scan(source, 'blank');
}

/**
 * Comments found by reading the file rather than by pattern.
 *
 * The regexes above cannot see a string, and a string can contain the end of a
 * comment. `packages/engine/src/runtime/http.ts` has `accept: '*\/*'` in a
 * header literal, which closed the block comment above it and opened another —
 * blanking seventy lines of real code, including the call a test was asserting
 * was there. The assertion failed honestly; the one beside it, `.not.toMatch`,
 * had been passing for the wrong reason, which is the exact failure the shared
 * stripper exists to prevent and the reason this file's own header says a
 * stripper that can delete the thing being looked for can make any assertion
 * pass.
 *
 * So this walks the characters once, which is the only way to tell a comment
 * from text that looks like one: quotes open strings, strings end at their own
 * quote, and a comment opener inside one is three characters of a header value.
 *
 * One shape is still not handled, and saying so is cheaper than pretending
 * otherwise: a regular expression literal is read as division, so a regex
 * containing a quote — `/'/` — opens a string that runs to the next quote.
 * Nothing in this repository is written that way, and the day something is, it
 * shows up as a test that fails rather than one that passes.
 */
function scan(source: string, mode: 'blank' | 'remove'): string {
  let out = '';
  let index = 0;
  const keep = (text: string) => {
    out += text;
  };
  const drop = (text: string) => {
    out += mode === 'blank' ? text.replace(/[^\n]/g, ' ') : text.replace(/[^\n]/g, '');
  };

  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      drop(source.slice(index, stop));
      index = stop;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      drop(source.slice(index, stop));
      index = stop;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (source[cursor] === char) {
          cursor += 1;
          break;
        }
        // A template literal may run over lines; the other two may not, and a
        // newline inside one means the quote was never closed — an apostrophe
        // in a comment this scanner has already passed, most likely. Stopping
        // at the line keeps the damage to that line.
        if (char !== '`' && source[cursor] === '\n') break;
        cursor += 1;
      }
      keep(source.slice(index, cursor));
      index = cursor;
      continue;
    }

    keep(char);
    index += 1;
  }

  return out;
}
