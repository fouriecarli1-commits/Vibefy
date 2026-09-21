/**
 * Why the model loop stopped, said out loud.
 *
 * Four different faults used to arrive at the caller wearing the same
 * sentence — "the stage explored the application but produced no structured
 * output" — because each of them shows up as an empty `parsed` and nothing
 * distinguished them:
 *
 *   · the model answered and the answer did not match the schema;
 *   · it was still working when the loop used its last turn;
 *   · the answer was cut off at the token limit;
 *   · the model declined to answer at all.
 *
 * The value in telling them apart is that each one sends you somewhere
 * different: the schema, the iteration ceiling, `maxTokens`, or a person. One
 * sentence for all four sends you to the wrong place three times in four.
 */
import { describe, expect, it } from 'vitest';
import {
  CostMeter,
  ModelClient,
  ScriptedTransport,
  type ScriptedStep,
} from '../packages/engine/src/index.ts';

function client(steps: readonly ScriptedStep[]): ModelClient {
  return new ModelClient(new ScriptedTransport(steps), new CostMeter({ maxRunCostUsd: 5 }));
}

const echoTool = {
  name: 'look',
  description: 'Looks at something.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run: async () => 'nothing of note',
};

describe('the loop says why it stopped', () => {
  it('reports nothing when the model simply finished', async () => {
    const result = await client([{ text: 'All done.' }]).run({
      stage: 'functional_exploration',
      promptId: 'functional-exploration',
      messages: [{ role: 'user', content: 'Have a look.' }],
    });
    expect(result.haltedBy).toBeNull();
    expect(result.text).toBe('All done.');
  });

  it('names the iteration ceiling rather than leaving an empty answer to explain itself', async () => {
    // A model that keeps calling tools for ever is not misbehaving — an
    // exploration stage is meant to explore. The ceiling is ours, and when we
    // hit it we stopped asking; the run did not fail.
    const forever: ScriptedStep = {
      stopReason: 'tool_use',
      toolUses: [{ name: 'look', input: {} }],
    };
    const result = await client(Array.from({ length: 40 }, () => forever)).run({
      stage: 'functional_exploration',
      promptId: 'functional-exploration',
      tools: [echoTool],
      messages: [{ role: 'user', content: 'Have a look.' }],
    });
    expect(result.haltedBy).toBe('tool_iteration_ceiling');
    expect(result.toolCalls.length).toBeGreaterThan(20);
  });

  it('names a refusal, which is neither our fault nor the application’s', async () => {
    const result = await client([{ stopReason: 'refusal', text: '' }]).run({
      stage: 'adversarial_practicality',
      promptId: 'adversarial-practicality',
      messages: [{ role: 'user', content: 'Have a look.' }],
    });
    expect(result.haltedBy).toBe('refused');
  });

  it('names a truncated answer, which is a setting rather than a fault', async () => {
    const result = await client([
      { stopReason: 'max_tokens', text: 'It begins well and then' },
    ]).run({
      stage: 'adversarial_practicality',
      promptId: 'adversarial-practicality',
      messages: [{ role: 'user', content: 'Have a look.' }],
    });
    expect(result.haltedBy).toBe('output_truncated');
  });

  it('stops reading content on a refusal rather than carrying on into the loop', async () => {
    // The point of checking `stop_reason` before the content: on a refusal
    // there is nothing to read, and a tool-use branch that runs anyway would
    // be acting on an empty message.
    const transport = new ScriptedTransport([
      { stopReason: 'refusal', text: '' },
      { text: 'This step must never be reached.' },
    ]);
    const result = await new ModelClient(transport, new CostMeter({ maxRunCostUsd: 5 })).run({
      stage: 'adversarial_practicality',
      promptId: 'adversarial-practicality',
      tools: [echoTool],
      messages: [{ role: 'user', content: 'Have a look.' }],
    });
    expect(result.haltedBy).toBe('refused');
    expect(transport.stepsConsumed, 'one call, then out').toBe(1);
  });
});
