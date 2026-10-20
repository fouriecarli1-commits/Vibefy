/**
 * Unit-economics instrumentation.
 *
 * PART 9: "If unit cost exceeds price, the business is dead — so make the number
 * visible from day one." Every model call and every container second is metered
 * here, and the ceilings are hard: a runaway agent loop hits a wall rather than
 * generating an unbounded bill.
 *
 * Prices are per million tokens, in USD, and are data rather than constants
 * scattered through the code — when Anthropic changes them, one table changes.
 */

import type { AssessmentDepth } from '../stages/types.ts';

export interface ModelPricing {
  /** USD per million input tokens. */
  readonly input: number;
  /** USD per million output tokens. */
  readonly output: number;
  /** Multiplier on the input rate for tokens written to the prompt cache. */
  readonly cacheWriteMultiplier: number;
  /** Multiplier on the input rate for tokens served from the prompt cache. */
  readonly cacheReadMultiplier: number;
}

const STANDARD_CACHE = { cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1 } as const;

/**
 * Verified against the published Anthropic price list, per row.
 *
 * Opus 5 and Haiku 4.5 on 2026-08-22; Sonnet 5 corrected on 2026-09-20, where
 * it had been carrying Sonnet 4.6's rates of $3 and $15. Nothing used it, so
 * nothing was billed wrongly — but the ledger is the whole point of this file
 * ("make the number visible from day one"), and a number that is visible and
 * fifty per cent high is worse than one nobody is looking at. Dated per row on
 * purpose: one date over the whole table says every row was checked on the day
 * any row was, which is what let that one sit there.
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  'claude-opus-5': { input: 5, output: 25, ...STANDARD_CACHE },
  'claude-sonnet-5': { input: 2, output: 10, ...STANDARD_CACHE },
  'claude-haiku-4-5': { input: 1, output: 5, ...STANDARD_CACHE },
};

/**
 * The model a request falls back to when neither the caller nor the prompt names
 * one.
 *
 * Every prompt bundle in `prompts/` declares its own model in front matter, and
 * `loadPrompt` refuses one that does not — so in practice this is reached only
 * by a caller that passes no prompt. It is deliberately the expensive one: a
 * cheap default would silently downgrade a stage somebody forgot to configure,
 * and a quiet downgrade of the model behind a published finding is worse than a
 * bill.
 *
 * There was a `TRIAGE_MODEL = 'claude-haiku-4-5'` here too, under "deterministic
 * triage and summarisation do not need the expensive model". Nothing read it:
 * the choice lives in each prompt's front matter, where
 * `prohibited-use-screening.md` does name haiku. It was a second place a model
 * is named, which is the shape that lets two statements of one rule drift — and
 * the sentence was already not true of summarisation, because `synthesis.md`
 * declares opus. Whether the narrative a customer reads should be written by a
 * cheaper model is a cost-against-quality decision and is in
 * `docs/OPEN_ITEMS.md`, not a constant nothing consults.
 */
export const DEFAULT_MODEL = 'claude-opus-5';

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens?: number;
  readonly cacheReadInputTokens?: number;
}

export class CostCeilingExceededError extends Error {
  constructor(
    message: string,
    readonly detail: { ceiling: string; limitUsd: number; observedUsd: number },
  ) {
    super(message);
    this.name = 'CostCeilingExceededError';
  }
}

/**
 * A call whose cost cannot be established.
 *
 * The sibling of the refusal in `priceFor`, and for the same sentence: an
 * unpriced model is an unmetered bill, and so is a call whose token counts
 * arrive as anything other than finite numbers. The ceiling is this product's
 * last line against a runaway loop, and the one way to get past it is to make
 * the total stop being a number.
 */
export class UnmeteredCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnmeteredCallError';
  }
}

/**
 * A count that can be billed, or a refusal to pretend it is nought.
 *
 * Absent is refused along with NaN and negative, for the two fields that are
 * not optional. A missing token count is the commonest way this arrives — a
 * transport that forgets one, a response shape that changed — and nought is
 * precisely the wrong reading of it: it is the only value that both passes
 * every check and hides the call from the ceiling.
 */
function billable(value: number | undefined, field: string, stage: string): number {
  const number = value as number;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) {
    throw new UnmeteredCallError(
      `The ${stage} stage reported ${field} as ${String(value)}, which cannot be costed. ` +
        `Nothing is recorded: a call counted as nought is a call the ceiling cannot see.`,
    );
  }
  return number;
}

export function priceFor(model: string): ModelPricing {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    throw new Error(
      `No price on file for model "${model}". Add it to MODEL_PRICING before using it — an unpriced model is an unmetered bill.`,
    );
  }
  return pricing;
}

export function costOfCall(model: string, usage: TokenUsage): number {
  const pricing = priceFor(model);
  const perToken = (rate: number) => rate / 1_000_000;
  return (
    usage.inputTokens * perToken(pricing.input) +
    usage.outputTokens * perToken(pricing.output) +
    (usage.cacheCreationInputTokens ?? 0) * perToken(pricing.input * pricing.cacheWriteMultiplier) +
    (usage.cacheReadInputTokens ?? 0) * perToken(pricing.input * pricing.cacheReadMultiplier)
  );
}

export interface CostLimits {
  /** Kills the run when exceeded. Free runs get a materially tighter cap. */
  readonly maxRunCostUsd: number;
}

export interface CostRecord {
  readonly model: string | null;
  readonly stage: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly aiCostUsd: number;
  readonly computeSeconds: number;
  readonly computeCostUsd: number;
  readonly storageBytes: number;
  readonly thirdPartyCalls: number;
  readonly thirdPartyCostUsd: number;
}

/** Container cost, so a slow Playwright run shows up rather than hiding. */
export const COMPUTE_USD_PER_SECOND = 0.0000117; // ~$0.042/hour, a small always-on machine

export class CostMeter {
  private readonly records: CostRecord[] = [];

  constructor(private readonly limits: CostLimits) {
    if (!(limits.maxRunCostUsd > 0)) {
      throw new Error('A cost meter without a positive ceiling is not a ceiling');
    }
  }

  get totalUsd(): number {
    return this.records.reduce(
      (total, record) =>
        total + record.aiCostUsd + record.computeCostUsd + record.thirdPartyCostUsd,
      0,
    );
  }

  get remainingUsd(): number {
    return Math.max(0, this.limits.maxRunCostUsd - this.totalUsd);
  }

  get entries(): readonly CostRecord[] {
    return this.records;
  }

  /**
   * Called before every model request. Refusing here rather than after the call
   * is the difference between a ceiling and a report of what we already spent.
   */
  assertHeadroom(estimatedUsd = 0): void {
    /*
     * Written as the negation of the safe case, not as the unsafe one.
     *
     * `total > limit` is false when `total` is NaN, so a single unmeasurable
     * figure anywhere in the ledger turned a hard ceiling into no ceiling at
     * all — every later call waved through, for the rest of the run, with the
     * meter reading NaN and nothing saying so. The copilot route carries this
     * lesson in a comment of its own ("`NaN >= 2` is false, so a spend figure
     * that came back malformed also permitted the call") and the meter that
     * guards the much larger spend did not.
     *
     * `!(total <= limit)` fails closed on NaN: the run stops and says the
     * ceiling was reached, which is the right answer when the truth is "we
     * cannot tell how much this has cost".
     */
    if (!(this.totalUsd + estimatedUsd <= this.limits.maxRunCostUsd)) {
      throw new CostCeilingExceededError(
        `Run would exceed its cost ceiling of $${this.limits.maxRunCostUsd.toFixed(2)}`,
        {
          ceiling: 'maxRunCostUsd',
          limitUsd: this.limits.maxRunCostUsd,
          observedUsd: Number((this.totalUsd + estimatedUsd).toFixed(6)),
        },
      );
    }
  }

  recordModelCall(stage: string, model: string, usage: TokenUsage): CostRecord {
    /*
     * Checked before it is stored, because one bad record poisons the total
     * for the rest of the run and the total is the ceiling.
     *
     * `TokenUsage` says these are numbers and the SDK's own types agree, which
     * is exactly why nothing looked: every transport that is not the real
     * client — the scripted one in tests, anything written next year — supplies
     * them by hand, and `undefined` through an arithmetic expression is NaN
     * rather than an error.
     */
    const counted: TokenUsage = {
      inputTokens: billable(usage.inputTokens, 'input tokens', stage),
      outputTokens: billable(usage.outputTokens, 'output tokens', stage),
      // The two optional ones default, because the API omits them when no
      // cache was involved and that genuinely is nought.
      cacheCreationInputTokens: billable(
        usage.cacheCreationInputTokens ?? 0,
        'cache creation tokens',
        stage,
      ),
      cacheReadInputTokens: billable(usage.cacheReadInputTokens ?? 0, 'cache read tokens', stage),
    };
    const record: CostRecord = {
      model,
      stage,
      inputTokens: counted.inputTokens,
      outputTokens: counted.outputTokens,
      cacheReadTokens: counted.cacheReadInputTokens ?? 0,
      aiCostUsd: costOfCall(model, counted),
      computeSeconds: 0,
      computeCostUsd: 0,
      storageBytes: 0,
      thirdPartyCalls: 0,
      thirdPartyCostUsd: 0,
    };
    this.records.push(record);
    this.assertHeadroom();
    return record;
  }

  recordCompute(stage: string, seconds: number, storageBytes = 0, thirdPartyCalls = 0): CostRecord {
    // The same rule for the same reason. A clock that goes backwards over a
    // long stage is the way this one arrives: a negative duration is not a
    // refund, and a NaN one is not free.
    seconds = billable(seconds, 'compute seconds', stage);
    storageBytes = billable(storageBytes, 'stored bytes', stage);
    thirdPartyCalls = billable(thirdPartyCalls, 'third-party calls', stage);
    const record: CostRecord = {
      model: null,
      stage,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      aiCostUsd: 0,
      computeSeconds: seconds,
      computeCostUsd: seconds * COMPUTE_USD_PER_SECOND,
      storageBytes,
      thirdPartyCalls,
      thirdPartyCostUsd: 0,
    };
    this.records.push(record);
    this.assertHeadroom();
    return record;
  }

  /** One row per stage, ready to insert into `cost_records`. */
  summariseByStage(): Record<string, CostRecord> {
    const byStage: Record<string, CostRecord> = {};
    for (const record of this.records) {
      const existing = byStage[record.stage];
      byStage[record.stage] = existing
        ? {
            ...existing,
            model: existing.model ?? record.model,
            inputTokens: existing.inputTokens + record.inputTokens,
            outputTokens: existing.outputTokens + record.outputTokens,
            cacheReadTokens: existing.cacheReadTokens + record.cacheReadTokens,
            aiCostUsd: existing.aiCostUsd + record.aiCostUsd,
            computeSeconds: existing.computeSeconds + record.computeSeconds,
            computeCostUsd: existing.computeCostUsd + record.computeCostUsd,
            storageBytes: existing.storageBytes + record.storageBytes,
            thirdPartyCalls: existing.thirdPartyCalls + record.thirdPartyCalls,
            thirdPartyCostUsd: existing.thirdPartyCostUsd + record.thirdPartyCostUsd,
          }
        : record;
    }
    return byStage;
  }
}

/**
 * Ceilings by assessment depth. Free runs cost us the least, by design.
 *
 * Keyed by the depth union rather than by `string`, so a depth added to the
 * union without a ceiling here fails to compile. It used to be a `string` map
 * read as `COST_CEILING_BY_DEPTH[depth] ?? 1`, which gave a new depth a dollar
 * — a number nobody chose, sitting between the cheapest and the dearest of the
 * ones somebody did.
 */
export const COST_CEILING_BY_DEPTH: Readonly<Record<AssessmentDepth, number>> = {
  limited: 0.5,
  full: 4,
  continuous: 2,
};
