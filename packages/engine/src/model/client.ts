/**
 * The model client.
 *
 * Everything the engine sends to Claude goes through here, so that four things
 * are true of every call without a stage having to remember them:
 *
 *   · It is metered, and refused if the run has no cost headroom left.
 *   · It names the versioned prompt it used, by hash.
 *   · Its stable system prefix is cached, because we send the same instructions
 *     on every step of an agentic loop.
 *   · It can be replaced by a scripted transport in tests, so the test suite is
 *     hermetic and costs nothing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import {
  CostCeilingExceededError,
  CostMeter,
  DEFAULT_MODEL,
  type TokenUsage,
} from '../runtime/cost.ts';
import { CeilingExceededError } from '../runtime/scope.ts';
import { getPrompt } from './prompts.ts';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly run: (input: Record<string, unknown>) => Promise<string>;
}

export interface ModelRequest {
  /** Pipeline stage, used for the cost breakdown. */
  readonly stage: string;
  /** Prompt id in /prompts. The prompt decides the model unless overridden. */
  readonly promptId: string;
  readonly messages: Anthropic.MessageParam[];
  readonly model?: string;
  readonly effort?: Effort;
  readonly maxTokens?: number;
  readonly tools?: readonly ToolDefinition[];
  /** When set, the response is parsed and validated against this schema. */
  readonly outputSchema?: z.ZodType;
  /** Extra instructions appended after the cached prompt body. */
  readonly context?: string;
}

/**
 * Why the loop below stopped, when it stopped for a reason of ours.
 *
 * `null` means the model finished on its own terms and `stopReason` carries
 * the API's own word for it. The others are ceilings we imposed, and they are
 * named because every one of them used to arrive at the caller as an empty
 * `parsed` — indistinguishable from a model that answered and failed to match
 * the schema, which is a different fault with a different fix.
 */
export type LoopHalt = 'tool_iteration_ceiling' | 'refused' | 'output_truncated';

export interface ModelResult<T = unknown> {
  readonly text: string;
  readonly parsed: T | null;
  readonly stopReason: string | null;
  readonly haltedBy: LoopHalt | null;
  readonly usage: TokenUsage;
  readonly model: string;
  readonly promptSha256: string;
  readonly toolCalls: readonly { name: string; input: unknown; output: string }[];
}

export interface TransportRequest {
  readonly model: string;
  readonly system: Anthropic.TextBlockParam[];
  readonly messages: Anthropic.MessageParam[];
  readonly maxTokens: number;
  readonly effort: Effort;
  readonly tools?: Anthropic.Tool[];
  readonly outputSchema?: z.ZodType;
}

export interface TransportResponse {
  readonly content: Anthropic.ContentBlock[];
  readonly stopReason: string | null;
  readonly usage: TokenUsage;
  readonly parsed?: unknown;
}

export interface ModelTransport {
  readonly name: string;
  send(request: TransportRequest): Promise<TransportResponse>;
}

/** The real transport. Streams, because agentic turns can be long. */
export class AnthropicTransport implements ModelTransport {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async send(request: TransportRequest): Promise<TransportResponse> {
    if (request.outputSchema) {
      const response = await this.client.messages.parse({
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: request.effort,
          format: zodOutputFormat(request.outputSchema as never),
        },
      });
      return {
        content: response.content,
        stopReason: response.stop_reason,
        usage: toUsage(response.usage),
        parsed: response.parsed_output,
      };
    }

    const stream = this.client.messages.stream({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages,
      thinking: { type: 'adaptive' },
      output_config: { effort: request.effort },
      ...(request.tools ? { tools: request.tools } : {}),
    });
    const response = await stream.finalMessage();
    return {
      content: response.content,
      stopReason: response.stop_reason,
      usage: toUsage(response.usage),
    };
  }
}

function toUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
}

/**
 * A limit the run has reached, as opposed to a boundary it was turned back at.
 *
 * The scope boundary is deliberately not here: a refused URL is something the
 * model is told to note and work around, and every tool description says so.
 * These two are not workaroundable — there is no other URL that costs less or
 * counts less — so they leave the loop rather than becoming advice.
 */
function isCeiling(error: unknown): boolean {
  return error instanceof CostCeilingExceededError || error instanceof CeilingExceededError;
}

export class ModelClient {
  constructor(
    private readonly transport: ModelTransport,
    private readonly meter: CostMeter,
  ) {}

  get transportName(): string {
    return this.transport.name;
  }

  /**
   * One request, with the agentic loop when tools are supplied. The loop is
   * written out rather than delegated to the SDK's tool runner because every
   * iteration has to re-check the cost ceiling and route each tool call through
   * the scope guard — control the runner does not expose.
   */
  async run<T = unknown>(request: ModelRequest): Promise<ModelResult<T>> {
    const prompt = getPrompt(request.promptId);
    const model = request.model ?? prompt.model ?? DEFAULT_MODEL;
    const maxTokens = request.maxTokens ?? 16_000;
    const effort = request.effort ?? 'high';

    // Stable first, volatile second: the prompt body is identical on every step
    // of a loop, so it is the cache breakpoint and the per-run context follows it.
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: prompt.body, cache_control: { type: 'ephemeral' } },
    ];
    if (request.context) system.push({ type: 'text', text: request.context });

    const tools = request.tools?.map(
      (tool): Anthropic.Tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
      }),
    );
    const byName = new Map((request.tools ?? []).map((tool) => [tool.name, tool]));

    const messages: Anthropic.MessageParam[] = [...request.messages];
    const toolCalls: { name: string; input: unknown; output: string }[] = [];
    let lastResponse: TransportResponse | null = null;
    let haltedBy: LoopHalt | null = null;
    let iterations = 0;
    /*
     * How many turns an exploring stage gets.
     *
     * Twenty-four was not enough to work through an application: the halt note
     * this loop produces — "it was still working when the stage stopped
     * asking" — was the ordinary outcome rather than the exception, and every
     * finding it had not reached yet was simply absent from the report. The
     * spending ceiling is the real bound on an exploration and it is checked on
     * every iteration; this number only decides whether the money is allowed to
     * be spent on finishing.
     */
    const maxIterations = tools ? 48 : 1;

    while (iterations < maxIterations) {
      iterations += 1;
      this.meter.assertHeadroom();

      const response = await this.transport.send({
        model,
        system,
        messages,
        maxTokens,
        effort,
        ...(tools ? { tools } : {}),
        ...(request.outputSchema ? { outputSchema: request.outputSchema } : {}),
      });
      lastResponse = response;
      this.meter.recordModelCall(request.stage, model, response.usage);

      // Checked before the content is read, because on both of these there is
      // either nothing to read or not all of it. A declined request is an HTTP
      // 200 whose content is empty, and a truncated one is a half-written
      // answer that will not parse — and both used to reach the caller as "the
      // stage produced no structured output", which is a third thing.
      if (response.stopReason === 'refusal') {
        haltedBy = 'refused';
        break;
      }
      if (response.stopReason === 'max_tokens') {
        haltedBy = 'output_truncated';
        break;
      }

      if (response.stopReason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content as never });
        continue;
      }
      if (response.stopReason !== 'tool_use' || !tools) break;

      const uses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (uses.length === 0) break;

      messages.push({ role: 'assistant', content: response.content as never });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        const tool = byName.get(use.name);
        /*
         * A refused tool call comes back to the model as an error result rather
         * than thrown: the model should learn the boundary and continue, not
         * die. Every tool description says so — "that refusal is the boundary
         * working, so note it and try something else".
         *
         * A ceiling is not a boundary to learn. It is the run stopping, and
         * handing it back as a tool result told the model to try something
         * else — which is refused too, and again, until the iteration ceiling
         * ran out. Meanwhile nothing reached the pipeline, so the run was never
         * classified as stopped and never carried a reason.
         */
        let output: string;
        let isError = false;
        if (!tool) {
          output = `No such tool: ${use.name}`;
          isError = true;
        } else {
          try {
            output = await tool.run((use.input ?? {}) as Record<string, unknown>);
          } catch (error) {
            if (isCeiling(error)) throw error;
            output = error instanceof Error ? error.message : String(error);
            isError = true;
          }
        }
        toolCalls.push({ name: use.name, input: use.input, output });
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: output,
          is_error: isError,
        });
      }

      messages.push({ role: 'user', content: results });

      // Said here rather than inferred from the loop condition, so that a run
      // which used its last turn on a tool call is distinguishable from one
      // that finished. Without it the caller saw an empty `parsed` and reported
      // a schema failure, when what happened is that the model was still
      // working when we stopped asking.
      if (iterations >= maxIterations) haltedBy = 'tool_iteration_ceiling';
    }

    if (!lastResponse) throw new Error('Transport returned no response');

    const text = lastResponse.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return {
      text,
      parsed: (lastResponse.parsed ?? null) as T | null,
      stopReason: lastResponse.stopReason,
      haltedBy,
      usage: lastResponse.usage,
      model,
      promptSha256: prompt.sha256,
      toolCalls,
    };
  }
}
