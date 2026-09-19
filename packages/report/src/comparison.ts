/**
 * Where a score stands against other applications of the same kind.
 *
 * Nothing else in a report answers "is that good", and it is the first thing
 * everybody asks. A 71 means nothing on its own — it is a number on a scale
 * nobody has an instinct for yet — and the honest way to give it meaning is to
 * say how many assessed applications in the same category scored lower.
 *
 * Two ways this goes wrong, and both are refusals rather than warnings.
 *
 * A percentile from a small sample is a number that looks like knowledge and is
 * not. With nineteen other applications, one of them moving is worth more than
 * five percentile points, and a figure that swings that far on one stranger's
 * re-assessment should not be printed beside a score somebody paid for. So
 * below the floor there is no number at all, and the report says why.
 *
 * And it never names another application. "Better than Kettle" is a claim about
 * Kettle, which Kettle did not agree to and is not ours to make. Everything
 * here is a count.
 */

/**
 * The smallest sample this will speak about.
 *
 * Twenty, because each peer is worth `100 / n` percentile points and five is
 * the most movement a single stranger should be able to cause. It is a
 * judgement rather than a law, and it is written down as one.
 */
export const MIN_PEERS_FOR_A_PERCENTILE = 20;

export interface ComparisonInput {
  readonly score: number;
  /** What kind of application this is. Null where the owner never said. */
  readonly category: string | null;
  /**
   * The most recent score of every *other* assessed application in the same
   * category. The caller excludes this application; including it would let an
   * application be above itself.
   */
  readonly peerScores: readonly number[];
}

export type Comparison =
  | { readonly kind: 'no_category'; readonly explanation: string }
  | {
      readonly kind: 'too_few';
      readonly have: number;
      readonly need: number;
      readonly explanation: string;
    }
  | {
      readonly kind: 'percentile';
      readonly percentile: number;
      readonly sampleSize: number;
      readonly category: string;
      readonly sentence: string;
      readonly limits: string;
    };

const LIMITS =
  'This compares against applications VibefyCode has assessed, using each one’s most recent score, in this category only. It says nothing about applications nobody has asked us to look at, and a category with a lot of careful work in it is a harder place to be average.';

export function compareToPeers(input: ComparisonInput): Comparison {
  if (!input.category || input.category.trim() === '') {
    return {
      kind: 'no_category',
      explanation:
        'This application has no category recorded, so there is no group to compare it with. Setting one in the console will put a comparison in the next report.',
    };
  }

  if (input.peerScores.length < MIN_PEERS_FOR_A_PERCENTILE) {
    return {
      kind: 'too_few',
      have: input.peerScores.length,
      need: MIN_PEERS_FOR_A_PERCENTILE,
      explanation: `There are ${input.peerScores.length} other assessed application${
        input.peerScores.length === 1 ? '' : 's'
      } in this category, and a percentile needs at least ${MIN_PEERS_FOR_A_PERCENTILE} before it means anything: with fewer, one of them being re-assessed moves the figure by more than five points. No number is given rather than one that would swing on a stranger.`,
    };
  }

  const below = input.peerScores.filter((peer) => peer < input.score).length;
  // Rounded down on purpose. This is a number about oneself, printed in a
  // document one shows to other people, and the direction to be wrong in is
  // the modest one.
  const percentile = Math.floor((below / input.peerScores.length) * 100);

  return {
    kind: 'percentile',
    percentile,
    sampleSize: input.peerScores.length,
    category: input.category,
    sentence: `This application scored higher than ${percentile}% of the ${input.peerScores.length} other assessed applications in ${input.category}.`,
    limits: LIMITS,
  };
}
