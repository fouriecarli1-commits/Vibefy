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
 * a space. A trailing comment after code on the same line survives, which is
 * deliberate — it cannot be told apart from the `//` inside a scheme, and
 * eating the rest of that line hides real code. The cost is a false positive
 * when a trailing comment mentions the thing being searched for, and a false
 * positive fails loudly.
 */
export function withoutComments(source: string): string {
  return source.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, ' ');
}
