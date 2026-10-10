/**
 * What a run may cost, said twice.
 *
 * `COST_CEILING_BY_DEPTH` in the engine is what the cost meter enforces, and
 * the meter "kills the run when exceeded" — it is a hard stop, not a typical
 * spend. `config/pricing.json`'s `ceilings.perRunCostUsd` is what the plan
 * promises: `entitlementFor(plan).maxRunCostUsd` reads it, the free-tier
 * exposure arithmetic multiplies it, and the admin console prints it to a
 * person as `up to $X.XX a run`.
 *
 * They are the same quantity and they do not agree for `limited`, which is the
 * free tier: the engine stops the run at $0.50 and the console says $1.00.
 * Measured on 2026-10-10, with each number separately pinned by a test that
 * knows nothing about the other —
 * `tests/the-plan-is-not-the-customers-to-declare.test.ts` asserts the engine's
 * 0.5 and `tests/the-ceiling-that-is-only-a-number.test.ts` builds the free
 * tier's monthly exposure from the pricing file's 1.
 *
 * Both directions have a consequence and neither is mine to pick:
 *
 *   · If the engine is right, the sentence shown to whoever administers
 *     accounts is wrong, and the free-tier exposure in the governance
 *     explanation is overstated by a factor of two — conservative for safety,
 *     wrong for pricing.
 *   · If the pricing file is right, a free assessment is being cut off halfway
 *     through work the plan paid for, and the report comes back thinner than
 *     it should.
 *
 * So this asserts they agree, with that one disagreement named and explained
 * rather than hidden. It is in `docs/OPEN_ITEMS.md` as a decision. The day it
 * is made, the exception comes out and this holds for every depth.
 *
 * There is a third fact in the same place: `ClaimedRequest.maxRunCostUsd` is
 * read off the request row by the worker and never used. The run's ceiling
 * comes from the depth table instead, so the per-organisation ceiling the web
 * app computes and records is carried and ignored.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COST_CEILING_BY_DEPTH } from '../packages/engine/src/runtime/cost.ts';
import { ENTITLEMENTS } from '../packages/billing/src/entitlements.ts';
import { withoutComments } from './setup/source.ts';

const pricing = JSON.parse(readFileSync('config/pricing.json', 'utf8')) as {
  ceilings: { perRunCostUsd: Record<string, number> };
};

/** The one disagreement, with what it costs in each direction. */
const DISAGREES: Readonly<Record<string, string>> = {
  limited:
    'The engine stops a free run at $0.50 and the plan, the exposure arithmetic and the admin console all say $1.00. Resolving it downward makes the sentence true and halves the stated free-tier exposure; resolving it upward doubles what a free account can actually cost us. A decision about money, recorded in docs/OPEN_ITEMS.md.',
};

describe('the ceiling a run is held to', () => {
  const depths = Object.keys(COST_CEILING_BY_DEPTH);

  it('has depths to compare, or the comparison below is empty', () => {
    expect(depths.length).toBeGreaterThan(2);
    expect(depths).toContain('limited');
    expect(Object.keys(pricing.ceilings.perRunCostUsd).sort()).toEqual([...depths].sort());
  });

  it('is the same number in the engine and in the pricing file, or the difference is written down', () => {
    const differs = depths
      .filter(
        (depth) =>
          COST_CEILING_BY_DEPTH[depth as keyof typeof COST_CEILING_BY_DEPTH] !==
          pricing.ceilings.perRunCostUsd[depth],
      )
      .filter((depth) => !(depth in DISAGREES));
    expect(
      differs,
      `The engine enforces one number and the plan promises another:\n  ${differs
        .map(
          (depth) =>
            `${depth}: engine ${COST_CEILING_BY_DEPTH[depth as keyof typeof COST_CEILING_BY_DEPTH]}, pricing ${pricing.ceilings.perRunCostUsd[depth]}`,
        )
        .join('\n  ')}`,
    ).toEqual([]);
  });

  it('does not record a disagreement that has been resolved', () => {
    // An exception left behind after somebody made the numbers agree is a note
    // nobody is holding anybody to.
    const settled = Object.keys(DISAGREES).filter(
      (depth) =>
        COST_CEILING_BY_DEPTH[depth as keyof typeof COST_CEILING_BY_DEPTH] ===
        pricing.ceilings.perRunCostUsd[depth],
    );
    expect(settled, `Recorded as disagreeing but no longer: ${settled.join(', ')}`).toEqual([]);
  });

  it('explains each disagreement in enough words to act on', () => {
    for (const [depth, reason] of Object.entries(DISAGREES)) {
      expect(reason.length, depth).toBeGreaterThan(80);
    }
  });

  it('is the number the plan hands to the console, so the sentence is about this', () => {
    // `up to $X.XX a run` in apps/web/app/admin/accounts/actions.ts reads
    // `entitlement.maxRunCostUsd`, which is the pricing file's figure.
    expect(ENTITLEMENTS.free.maxRunCostUsd).toBe(pricing.ceilings.perRunCostUsd.limited);
    const actions = withoutComments(readFileSync('apps/web/app/admin/accounts/actions.ts', 'utf8'));
    expect(actions).toMatch(/entitlement\.maxRunCostUsd\.toFixed\(2\)/);
  });
});

describe('the ceiling recorded on the request', () => {
  const worker = withoutComments(readFileSync('apps/worker/src/run-assessment.ts', 'utf8'));

  it('is read off the row, which is why it is worth asking what uses it', () => {
    const queue = withoutComments(readFileSync('apps/worker/src/queue.ts', 'utf8'));
    expect(queue).toMatch(/maxRunCostUsd: Number\(row\.max_run_cost_usd\)/);
  });

  it('is not what the run is held to, which is the depth table instead', () => {
    // Stated as the measurement rather than as a wish. The per-organisation
    // ceiling the web app computes and writes to the row is carried into the
    // worker and ignored; changing that is part of the decision above, because
    // honouring it is what makes the plan's number the real one.
    expect(worker).toMatch(/maxRunCostUsd: COST_CEILING_BY_DEPTH\[job\.depth\]/);
    expect(worker).not.toMatch(/maxRunCostUsd: job\.maxRunCostUsd/);
  });
});
