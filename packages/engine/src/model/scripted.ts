/**
 * A deterministic transport for tests.
 *
 * The test suite must never call the real API: it would cost money, it would be
 * non-deterministic, and it would make the tests unrunnable without a key. This
 * replays scripted responses in order and fails loudly when a stage asks for one
 * that was not scripted, which is how a test catches a stage that has started
 * making calls nobody expected.
 */
import type { ModelTransport, TransportRequest, TransportResponse } from './client.ts';
import type { TokenUsage } from '../runtime/cost.ts';

export interface ScriptedStep {
  /** Plain text reply. */
  readonly text?: string;
  /** Structured reply, returned as `parsed` when the request had a schema. */
  readonly parsed?: unknown;
  /** Tool calls the model should make on this step. */
  readonly toolUses?: readonly { name: string; input: Record<string, unknown> }[];
  readonly usage?: Partial<TokenUsage>;
  readonly stopReason?: string;
}

export class ScriptedTransport implements ModelTransport {
  readonly name = 'scripted';
  private index = 0;
  readonly requests: TransportRequest[] = [];

  constructor(private readonly steps: readonly ScriptedStep[]) {}

  get stepsConsumed(): number {
    return this.index;
  }

  async send(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request);
    const step = this.steps[this.index];
    if (!step) {
      throw new Error(
        `ScriptedTransport ran out of steps at call ${this.index + 1}. The stage made a model call the test did not anticipate.`,
      );
    }
    this.index += 1;

    const usage: TokenUsage = {
      inputTokens: step.usage?.inputTokens ?? 1000,
      outputTokens: step.usage?.outputTokens ?? 400,
      cacheCreationInputTokens: step.usage?.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: step.usage?.cacheReadInputTokens ?? 0,
    };

    if (step.toolUses && step.toolUses.length > 0) {
      return {
        content: step.toolUses.map((use, position) => ({
          type: 'tool_use' as const,
          id: `scripted_${this.index}_${position}`,
          name: use.name,
          input: use.input,
        })) as never,
        stopReason: 'tool_use',
        usage,
      };
    }

    return {
      content: [{ type: 'text', text: step.text ?? '', citations: null }] as never,
      stopReason: step.stopReason ?? 'end_turn',
      usage,
      ...(step.parsed !== undefined ? { parsed: step.parsed } : {}),
    };
  }
}
