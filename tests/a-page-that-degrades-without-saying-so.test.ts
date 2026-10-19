/**
 * Every public page here degrades rather than breaks, and that is only honest
 * while somebody is told.
 *
 * The decisions are all written down beside the code that makes them: three
 * answers instead of two on `/verify`, so a read that failed is not an
 * accusation of fraud; three on `/a/[slug]`, so a database blip does not
 * quietly remove the plain-language answers and leave the score standing alone;
 * a grey frame rather than a broken picture on a customer's website.
 *
 * Each of those was reasoned about one page at a time, so the logging was too,
 * and the result was four catches where three wrote nothing — two of them under
 * a comment saying the failure is "ours to read in the logs". A page that
 * degrades silently is, from outside, a page that is working. That is how this
 * product spent a week with every badge grey.
 *
 * So the rule is swept rather than remembered: a handler in the web app that
 * swallows a failure and carries on says so through `couldNot`, which rate
 * limits itself and requires the one thing the log reader actually wants —
 * `shown`, what the visitor got instead. The excused cases are listed here with
 * their reason, because an unexplained exception is how a rule stops meaning
 * anything.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { commentsBlanked } from './setup/source.ts';
import { couldNot } from '../apps/web/lib/what-we-could-not-do.ts';
import { forgetWhatWasSaid } from '../apps/web/lib/said-recently.ts';

/** Every file the gate below reads, from git rather than a hand-kept list. */
function webSources(): string[] {
  return execFileSync('git', ['ls-files', 'apps/web/app', 'apps/web/components', 'apps/web/lib'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((path) => /\.tsx?$/.test(path));
}

/**
 * The handlers that may stay quiet, and why.
 *
 * Keyed by the text of the call, so an excuse covers one shape rather than a
 * file. Anything else that swallows a failure has to say so.
 */
const EXCUSED: Readonly<Record<string, string>> = {
  'request.json().catch(() => ({}))':
    'a request with no body is a request, not a failure, and the handler validates what it got',
  "client.query('rollback').catch(() => undefined)":
    'the rollback of a transaction that is already failing; the original error is the one being thrown',
};

describe('a handler that swallows a failure', () => {
  it('says so, everywhere in the web app', () => {
    const quiet: string[] = [];
    for (const path of webSources()) {
      const lines = commentsBlanked(readFileSync(path, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (!line.includes('.catch(')) return;
        const call = line.trim();
        if (Object.keys(EXCUSED).some((excuse) => call.includes(excuse))) return;
        // The handler, or as much of it as the next few lines hold. A comment
        // inside it counts for nothing; the call has to be there.
        const handler = lines.slice(index, index + 14).join('\n');
        const says = /couldNot\(|console\.error\(/.test(handler);
        if (!says) quiet.push(`${path}:${index + 1}  ${call}`);
      });
    }
    expect(quiet, `these carry on after a failure and write nothing:\n${quiet.join('\n')}`).toEqual(
      [],
    );
  });

  it('is measuring something — there are handlers to find', () => {
    // The gate above passes trivially if the pattern stops matching, which a
    // rename of `.catch` or a move of these files would do.
    const found = webSources().filter((path) => readFileSync(path, 'utf8').includes('.catch('));
    expect(found.length).toBeGreaterThan(3);
  });
});

describe('the line itself', () => {
  let said: { message: string; detail: Record<string, unknown> }[];

  beforeEach(() => {
    forgetWhatWasSaid();
    said = [];
    vi.spyOn(console, 'error').mockImplementation((message: unknown, detail?: unknown) => {
      said.push({ message: String(message), detail: (detail ?? {}) as Record<string, unknown> });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    forgetWhatWasSaid();
  });

  it('names what could not be done, what the visitor got, and the failure', () => {
    couldNot(
      'read the assurance answers behind a badge',
      { slug: 'kettle-shop', shown: 'the page without its plain-language answers' },
      new Error('statement timeout'),
    );
    expect(said).toHaveLength(1);
    expect(said[0]!.message).toBe('could not read the assurance answers behind a badge');
    expect(said[0]!.detail.slug).toBe('kettle-shop');
    expect(said[0]!.detail.shown).toMatch(/without its plain-language answers/);
    expect(said[0]!.detail.error).toBe('statement timeout');
  });

  it('explains a message that misleads, beside it rather than instead of it', () => {
    // A tripped pooler breaker reads character for character like our own bad
    // password, and sends somebody to reset one that was never wrong.
    couldNot(
      'look up a badge',
      { badgeId: 'vbf-1', shown: 'the page establishing nothing' },
      new Error('Max client connections reached: circuit breaker open'),
    );
    expect(said[0]!.detail.error).toMatch(/circuit breaker/);
    expect(String(said[0]!.detail.means ?? '')).not.toBe('');
  });

  it('says it once a minute, not once per pageview', () => {
    for (let impression = 0; impression < 5; impression += 1) {
      couldNot('read the sponsorship for a placement', { shown: 'no sponsorship' }, new Error('x'));
    }
    expect(said, 'a line per impression buries the one line that matters').toHaveLength(1);
  });

  it('keeps a different failure audible', () => {
    // Keyed on the message as well as the subject: the second fault is not the
    // first one repeating, and holding it back is how one outage hides another.
    couldNot('read a badge', { shown: 'nothing' }, new Error('statement timeout'));
    couldNot('read a badge', { shown: 'nothing' }, new Error('getaddrinfo ENOTFOUND'));
    expect(said).toHaveLength(2);
  });
});
