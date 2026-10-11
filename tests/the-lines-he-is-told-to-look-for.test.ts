/**
 * The four lines `docs/DOEN.md` tells him to check for.
 *
 * Section 3 ends with a "Klaar as" — the one sentence in each section that
 * says when he can stop:
 *
 *     **Klaar as:** Logs wys **geen** van hierdie vier reëls nie:
 *
 * followed by the startup warnings quoted verbatim. He reads the Render log,
 * searches for those lines, and finds nothing, and that is his signal that the
 * worker has everything it needs.
 *
 * It was three until 2026-10-11, and this test is why it is four. The document
 * had nothing in it about the badge signing key, so a worker that can issue no
 * badge at all passed his whole checklist; the line added to the block here
 * failed this test within the hour, because the worker's own startup check did
 * not raise it either. Quoting a line that does not exist and omitting a
 * condition that does are the same defect from opposite sides, which is what
 * both directions below are for.
 *
 * Nothing tied the quotes to the worker. Change a message's wording and the
 * document sends him looking for a line that can no longer appear — and the
 * absence of a line he was told to look for reads exactly like success. The
 * one check whose whole purpose is to tell him he is finished would then tell
 * him he is finished whatever the worker is missing.
 *
 * Twice tonight an instruction in that document turned out to be wrong in a
 * way only running it would show: the catch-up command that rewrote all
 * sixty-four migrations, and two numbers describing the output of a command
 * nobody had run. This is the same question asked of a quotation instead of a
 * command.
 *
 * Both directions matter. A message missing from the document is a condition
 * he is not told to look for. A line in the document the worker cannot produce
 * is a search that can only succeed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startupWarnings } from '../apps/worker/src/main.ts';

const DOEN = readFileSync('docs/DOEN.md', 'utf8');

/** Every warning the worker raises when it has been given nothing. */
const messages = startupWarnings({}).map((warning) => warning.message);

/**
 * The fenced block immediately after the "Klaar as" that introduces it.
 *
 * Found by its own sentence rather than by position, so adding a section above
 * it does not quietly point this at a different block.
 */
const quoted = (() => {
  const intro = DOEN.indexOf('Logs wys **geen** van hierdie vier reëls nie');
  if (intro < 0) throw new Error('docs/DOEN.md no longer introduces the four lines');
  const open = DOEN.indexOf('```', intro);
  const close = DOEN.indexOf('```', open + 3);
  return DOEN.slice(open + 3, close)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
})();

describe('what the worker says it cannot do', () => {
  it('raises something when it is given nothing, or the rest of this proves nothing', () => {
    expect(messages.length).toBeGreaterThan(2);
  });

  it('found the block in the document, and it is not empty', () => {
    expect(quoted.length).toBeGreaterThan(2);
  });

  it('is quoted in docs/DOEN.md word for word', () => {
    // Sorted, because the order he reads them in does not matter and the order
    // the worker pushes them in is an implementation detail.
    expect([...quoted].sort()).toEqual([...messages].sort());
  });

  it('is described as four lines, because that is how many there are', () => {
    // "hierdie vier reëls" — a fifth warning makes the sentence wrong as well
    // as the list incomplete, and he would see a line he was not told about.
    expect(messages).toHaveLength(4);
    expect(DOEN).toContain('hierdie vier reëls');
  });

  it('includes the one without which there is no product', () => {
    // Named rather than left to the count above: this is the warning whose
    // absence let a worker that cannot issue a single badge look finished.
    expect(messages.some((message) => message.startsWith('no badge signing key'))).toBe(true);
  });

  it('is quoted in one place, because a second copy is a copy that drifts', () => {
    /*
     * There were three.
     *
     * `docs/DNS.md` and `docs/RUNBOOK.md` each wrote the block out again, and
     * this test finds its block by the sentence in `docs/DOEN.md` alone — so
     * when the worker gained a fourth warning, both copies were a line short
     * and nothing objected. That is the same failure this file exists for,
     * arriving through the door it was not looking at: a condition he is not
     * told to look for, whose absence reads as success.
     *
     * `docs/DECISIONS.md` is excluded because it is an append-only record of
     * what was decided, quoting messages as they were at the time. Rewriting
     * history to match the present is the one thing that file must not do.
     */
    const docs = readdirSync('docs', { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .filter((name) => name !== 'DECISIONS.md');

    expect(docs.length).toBeGreaterThan(5);
    expect(docs).toContain('DOEN.md');

    for (const name of docs) {
      const text = readFileSync(join('docs', name), 'utf8');
      const carries = messages.filter((message) => text.includes(message));
      if (name === 'DOEN.md') expect(carries).toEqual(messages);
      else expect(carries, `${name} quotes a line docs/DOEN.md is meant to own`).toEqual([]);
    }
  });

  it('says in the document what each missing thing costs him', () => {
    // Each message carries its own consequence, which is the reason they are
    // worth quoting rather than summarising: "badges will be issued and never
    // announced" is the sentence that tells him why to care.
    for (const message of messages) {
      expect(message, message).toMatch(/—/);
      expect(message.split('—')[1]!.trim().length, message).toBeGreaterThan(20);
    }
  });
});
