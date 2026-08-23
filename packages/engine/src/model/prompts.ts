/**
 * The prompt registry.
 *
 * PART 5: "All prompts versioned in /prompts and referenced by hash in every
 * report for reproducibility and defensibility." If a customer disputes a
 * finding two years from now, we must be able to say exactly which instructions
 * produced it — so a report records the hash of the whole bundle, and every
 * stage records the hash of the prompt it used.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const promptsDir = join(packageRoot, '..', '..', 'prompts');

export interface Prompt {
  readonly id: string;
  readonly version: string;
  readonly model: string;
  readonly purpose: string;
  readonly body: string;
  readonly sha256: string;
}

const cache = new Map<string, Prompt>();

function parse(file: string): Prompt {
  const raw = readFileSync(join(promptsDir, file), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new Error(
      `${file} has no front matter. Every prompt declares its id, version and model.`,
    );
  }
  const [, frontMatter, body] = match as unknown as [string, string, string];
  const fields = Object.fromEntries(
    frontMatter
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(':');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );

  for (const required of ['id', 'version', 'model', 'purpose']) {
    if (!fields[required]) throw new Error(`${file} is missing "${required}" in its front matter`);
  }

  return {
    id: fields.id!,
    version: fields.version!,
    model: fields.model!,
    purpose: fields.purpose!,
    body: body.trim(),
    // Hashes the whole file, front matter included: a version bump with no text
    // change and a text change with no version bump are both detectable.
    sha256: createHash('sha256').update(raw).digest('hex'),
  };
}

export function listPrompts(): readonly Prompt[] {
  return readdirSync(promptsDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => parse(file))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getPrompt(id: string): Prompt {
  const cached = cache.get(id);
  if (cached) return cached;
  const found = listPrompts().find((prompt) => prompt.id === id);
  if (!found) {
    throw new Error(
      `No prompt "${id}" in /prompts. Prompts are versioned data; a stage cannot invent its own instructions.`,
    );
  }
  cache.set(id, found);
  return found;
}

/**
 * One hash covering every prompt, recorded on the assessment. Reproducing a
 * report means checking out the commit whose bundle hash matches.
 */
export function promptBundleSha256(): string {
  const hash = createHash('sha256');
  for (const prompt of listPrompts())
    hash.update(`${prompt.id}@${prompt.version}:${prompt.sha256}\n`);
  return hash.digest('hex');
}
