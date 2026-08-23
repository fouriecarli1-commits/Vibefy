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
import { CostMeter, DEFAULT_MODEL, type TokenUsage } from '../runtime/cost.ts';
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

export interface ModelResult<T = unknown> {
  readonly text: string;
  readonly parsed: T | null;
  readonly stopReason: string | null;
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
    let iterations = 0;
    const maxIterations = tools ? 24 : 1;

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
        // A refused tool call is returned to the model as an error result rather
        // than thrown: the model should learn the boundary and continue, not die.
        let output: string;
        let isError = false;
        if (!tool) {
          output = `No such tool: ${use.name}`;
          isError = true;
        } else {
          try {
            output = await tool.run((use.input ?? {}) as Record<string, unknown>);
          } catch (error) {
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
      usage: lastResponse.usage,
      model,
      promptSha256: prompt.sha256,
      toolCalls,
    };
  }
}
