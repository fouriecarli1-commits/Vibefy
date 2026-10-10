/**
 * The three lines `docs/DOEN.md` tells him to check for.
 *
 * Section 3 ends with a "Klaar as" — the one sentence in each section that
 * says when he can stop:
 *
 *     **Klaar as:** Logs wys **geen** van hierdie drie reëls nie:
 *
 * followed by the three startup warnings quoted verbatim. He reads the Render
 * log, searches for those lines, and finds nothing, and that is his signal
 * that the worker has everything it needs.
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
import { readFileSync } from 'node:fs';
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
  const intro = DOEN.indexOf('Logs wys **geen** van hierdie drie reëls nie');
  if (intro < 0) throw new Error('docs/DOEN.md no longer introduces the three lines');
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

  it('is described as three lines, because that is how many there are', () => {
    // "hierdie drie reëls" — a fourth warning makes the sentence wrong as well
    // as the list incomplete, and he would see a line he was not told about.
    expect(messages).toHaveLength(3);
    expect(DOEN).toContain('hierdie drie reëls');
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
