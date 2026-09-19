/**
 * The copy gate, at run time, for words we did not write.
 *
 * Everything else this gate guards is written by us and checked when the
 * repository is built. A trust page is the first surface where a *customer*
 * types something that appears beside our mark, and the build knows nothing
 * about what they will type.
 *
 * The risk is specific rather than general. Somebody who has just earned a
 * badge, writing a sentence about their own application on a page carrying our
 * seal, will reach for exactly the words the mark does not support — verified
 * secure, VibefyCode approved, certified. Most of them will mean no harm; all
 * of them will produce a page that says we made a claim we did not make.
 *
 * So the same rules apply to their words as to ours, and they are refused at
 * the moment of typing with a sentence explaining why, rather than removed
 * later by somebody who noticed.
 *
 * `tests/claim-check.test.ts` asserts this list and the build-time linter's
 * list are the same. Two lists would disagree within a release, and the one
 * facing the public would be the one nobody was maintaining.
 */

/** Never permitted. These turn the mark into a claim we do not make. */
export const FORBIDDEN_CLAIMS: readonly string[] = [
  'vibefycode verified secure',
  'vibefycode certified safe',
  'vibefycode approved',
  'guaranteed by vibefycode',
  'vibefycode compliant',
  'vibefycode certified secure',
  'certified secure',
  'hack-proof',
  'hackproof',
  'unhackable',
  'bank-grade security',
  'military-grade security',
  '100% secure',
  'fully secure',
  'guaranteed secure',
  'penetration tested by vibefycode',
];

/** Anything of the shape "VibefyCode <strong word>" extends the wordmark. */
export const MARK_EXTENSION =
  /\bvibefycode[\s-]+(verified|certified|approved|secure|safe|compliant|guaranteed|trusted)\b|\b(certified|approved|guaranteed|secured)\s+by\s+vibefycode\b/i;

/** The old name, on its own. A half-renamed sentence is how the wrong one ships. */
export const STALE_BRAND = /\bvibefy(?!code)\b/i;

export interface ClaimVerdict {
  readonly ok: boolean;
  /** Written to be shown to the person who typed it, not logged. */
  readonly reason: string | null;
  /** What they wrote that caused it, so they can find it. */
  readonly matched: string | null;
}

const ALLOWED = { ok: true, reason: null, matched: null } as const;

export function checkClaim(text: string): ClaimVerdict {
  const lower = text.toLowerCase();

  for (const phrase of FORBIDDEN_CLAIMS) {
    if (lower.includes(phrase)) {
      return {
        ok: false,
        matched: phrase,
        reason: `“${phrase}” is not something a VibefyCode badge supports, and a page carrying the mark cannot say it. The mark means one assessment, against a published rubric, on a date.`,
      };
    }
  }

  const extension = MARK_EXTENSION.exec(text);
  if (extension) {
    return {
      ok: false,
      matched: extension[0],
      reason: `“${extension[0]}” extends the mark. The wordmark is exactly “Verified by VibefyCode” and nothing may be added to it — not by us either.`,
    };
  }

  const stale = STALE_BRAND.exec(text);
  if (stale) {
    return {
      ok: false,
      matched: stale[0],
      reason: `“${stale[0]}” is the old name. The brand is VibefyCode.`,
    };
  }

  return ALLOWED;
}
