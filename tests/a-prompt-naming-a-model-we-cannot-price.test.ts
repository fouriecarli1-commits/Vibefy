/**
 * A prompt may name any model. `priceFor` throws for one it has no price for.
 *
 * The two facts are in different files with nothing joining them. Each prompt
 * bundle in `prompts/` declares its model in front matter, which `loadPrompt`
 * requires — "every prompt declares its id, version and model" — and
 * `MODEL_PRICING` in the cost meter lists three. `priceFor` refuses an unpriced
 * one in as many words: "an unpriced model is an unmetered bill."
 *
 * That refusal is right and it arrives at the worst possible moment. It is
 * thrown from inside a stage, mid-assessment, on a run a customer has paid for,
 * and only for the prompts that happen to use the model somebody forgot — so a
 * change to one prompt's front matter breaks one stage of every paid run and
 * nothing before deployment says so. Measured on 2026-10-07: six prompts, two
 * distinct models, both priced. The point is the seventh.
 *
 * It also holds the other half, which is the one that costs money rather than
 * failing loudly: a model priced but named by nothing is a row nobody is
 * metering against, and a model named but unpriced is a bill. Both show up here
 * as a list rather than as a surprise in a stage.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_PRICING, priceFor } from '../packages/engine/src/runtime/cost.ts';

const PROMPTS = join(import.meta.dirname, '..', 'prompts');

/** Every prompt bundle and the model its front matter declares. */
function declaredModels(): { file: string; model: string }[] {
  return readdirSync(PROMPTS)
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const text = readFileSync(join(PROMPTS, file), 'utf8');
      const model = /^model:\s*(\S+)\s*$/m.exec(text)?.[1];
      return { file, model: model ?? '' };
    });
}

describe('every prompt that ships', () => {
  const prompts = declaredModels();

  it('is found, so this file is testing something', () => {
    expect(prompts.length).toBeGreaterThan(3);
    expect(prompts.map((p) => p.file)).toContain('synthesis.md');
  });

  it('declares a model at all', () => {
    // `loadPrompt` refuses a bundle with no front matter, and this is the same
    // rule read before a run rather than during one.
    expect(prompts.filter((p) => p.model === '').map((p) => p.file)).toEqual([]);
  });

  it('names a model the cost meter can price', () => {
    const unpriced = prompts
      .filter((p) => MODEL_PRICING[p.model] === undefined)
      .map((p) => `${p.file} → ${p.model}`);
    // Anything listed here breaks one stage of every paid run, from inside the
    // stage, after the customer has paid. Add the price before the prompt.
    expect(unpriced).toEqual([]);
  });

  it('can be priced through the function the engine actually calls', () => {
    for (const { model } of prompts) {
      expect(() => priceFor(model)).not.toThrow();
    }
  });
});

describe('the price list', () => {
  it('prices nothing no prompt asks for, so a row is not an unmetered guess', () => {
    // The other direction. A model priced and named by nothing is a row nobody
    // is measuring against, and the next person to add a prompt may pick it
    // believing the price was checked against something.
    const asked = new Set(declaredModels().map((p) => p.model));
    const spare = Object.keys(MODEL_PRICING).filter((model) => !asked.has(model));
    // `claude-sonnet-5` is here on purpose: the free tier's ceiling is set
    // against it and a stage may be pointed at it by request rather than by
    // front matter. Listed rather than asserted away, so it stays a decision.
    expect(spare).toEqual(['claude-sonnet-5']);
  });

  it('gives every priced model an output rate above its input rate', () => {
    // Not arithmetic for its own sake: a transposed pair understates every run
    // in the direction that matters, and the ceiling is checked against the
    // estimate before the call.
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.output, model).toBeGreaterThan(pricing.input);
      expect(pricing.input, model).toBeGreaterThan(0);
    }
  });
});
