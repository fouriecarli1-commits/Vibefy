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

/** Verified against the published Anthropic price list on 2026-08-22. */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  'claude-opus-5': { input: 5, output: 25, ...STANDARD_CACHE },
  'claude-sonnet-5': { input: 3, output: 15, ...STANDARD_CACHE },
  'claude-haiku-4-5': { input: 1, output: 5, ...STANDARD_CACHE },
};

export const DEFAULT_MODEL = 'claude-opus-5';
/** Deterministic triage and summarisation do not need the expensive model. */
export const TRIAGE_MODEL = 'claude-haiku-4-5';

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
    if (this.totalUsd + estimatedUsd > this.limits.maxRunCostUsd) {
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
    const record: CostRecord = {
      model,
      stage,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadInputTokens ?? 0,
      aiCostUsd: costOfCall(model, usage),
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

/** Ceilings by assessment depth. Free runs cost us the least, by design. */
export const COST_CEILING_BY_DEPTH: Readonly<Record<string, number>> = {
  limited: 0.5,
  full: 4,
  continuous: 2,
};
