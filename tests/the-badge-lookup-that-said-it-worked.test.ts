/**
 * What is said when neither route can answer.
 *
 * `lookUpBadgeVerification` reads one published row by the direct connection
 * and, failing that, by Supabase's own API with the public key. The fallback is
 * why a wrong `SUPABASE_DB_URL` no longer turns every badge grey, and it was
 * built with the right instinct: say so, loudly, every time, because a badge
 * that works over a fault nobody is told about is worse than one that does not.
 *
 * The saying was in the wrong place. Three states, and only one of them was
 * reported honestly:
 *
 *   · the fallback answered — a line, correctly;
 *   · the fallback failed too — the same line, written *before* the call, and
 *     it ends "The badge works; the connection string still needs fixing." So
 *     at the moment every badge went grey, the only record said the badge
 *     worked, which sends whoever reads it to the wrong fault;
 *   · there is no fallback configured, because the public URL or key is
 *     missing — `throw error` with nothing written anywhere. The one deployment
 *     the spare route cannot save is the one that was told nothing. This
 *     product spent a week grey, and the week was spent because nothing said so.
 *
 * `/verify` had the matching hole: `catch { return { kind: 'unavailable' } }`
 * under a comment saying what went wrong is "ours to read in the logs". Nothing
 * wrote it.
 *
 * No Supabase is reached here. The direct route is failed with a connection
 * string `whatIsWrongWithTheConnectionString` rejects before a socket is
 * opened, and the API route with an address nothing is listening on — which
 * also covers the second defect in that path, that a *thrown* transport failure
 * used to leave the function with the API's error in place of the direct one.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lookUpBadgeVerification } from '../apps/web/lib/badge-verification.ts';
import { forgetWhatWasSaid } from '../apps/web/lib/said-recently.ts';
import { withoutComments } from './setup/source.ts';

const BADGE_ID = 'vbf-not-a-real-badge';

/**
 * A connection string the reader refuses before a socket is opened.
 *
 * `http://` rather than a Postgres URI with a placeholder password in it: the
 * placeholder is what `whatIsWrongWithTheConnectionString` was written for and
 * would read more plainly, but it is also the shape the secret scanner stops,
 * and a test fixture is not worth an exception to that.
 */
const UNUSABLE_DSN = 'http://this-is-not-a-database-address/postgres';

const kept = {
  db: process.env.SUPABASE_DB_URL,
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

let said: { message: string; detail: Record<string, unknown> }[];

beforeEach(() => {
  forgetWhatWasSaid();
  said = [];
  vi.spyOn(console, 'error').mockImplementation((message: unknown, detail?: unknown) => {
    said.push({
      message: String(message),
      detail: (detail ?? {}) as Record<string, unknown>,
    });
  });
  process.env.SUPABASE_DB_URL = UNUSABLE_DSN;
});

afterEach(() => {
  vi.restoreAllMocks();
  forgetWhatWasSaid();
  for (const [name, value] of [
    ['SUPABASE_DB_URL', kept.db],
    ['NEXT_PUBLIC_SUPABASE_URL', kept.url],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', kept.key],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('a badge lookup with no spare route', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it('throws, and says that there was no second route to try', async () => {
    await expect(lookUpBadgeVerification(BADGE_ID)).rejects.toThrow();
    const line = said.find((entry) => /no spare route/i.test(entry.message));
    expect(
      line,
      `nothing was said; the log held: ${said.map((s) => s.message).join(' / ')}`,
    ).toBeDefined();
    // The id, so the line can be tied to a report of a grey badge, and the
    // sentence that says which of the two things to fix.
    expect(line!.detail.publicId).toBe(BADGE_ID);
    expect(String(line!.detail.means)).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(String(line!.detail.means)).toMatch(/SUPABASE_DB_URL/);
  });

  it('does not claim the badge works', async () => {
    await expect(lookUpBadgeVerification(BADGE_ID)).rejects.toThrow();
    expect(said.map((entry) => entry.message).join('\n')).not.toMatch(/fell back/i);
    expect(JSON.stringify(said)).not.toMatch(/The badge works/);
  });
});

describe('a badge lookup where neither route answers', () => {
  beforeEach(() => {
    // Configured, and nothing listening. The transport failure is the harder of
    // the two API cases: Postgrest returns a refusal from the server as
    // `error`, but a refused socket rejects — and a rejection used to leave the
    // lookup with the API's error in place of the direct one, which is the
    // failure this code says it prefers to report.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'not-a-real-anon-key';
  });

  it('says both routes failed, and keeps the direct failure as the one to fix', async () => {
    await expect(lookUpBadgeVerification(BADGE_ID)).rejects.toThrow(/not a database address/);
    const line = said.find((entry) => /either route/i.test(entry.message));
    expect(
      line,
      `nothing was said; the log held: ${said.map((entry) => entry.message).join(' / ')}`,
    ).toBeDefined();
    expect(String(line!.detail.direct)).toMatch(/not a database address/);
    expect(line!.detail.api, 'the second failure was not recorded at all').toBeTruthy();
    expect(JSON.stringify(said)).not.toMatch(/The badge works/);
  }, 30_000);
});

describe('a badge lookup whose fallback cannot even be built', () => {
  beforeEach(() => {
    // The same door from the other side, and instantly: the client refuses the
    // address before any request is made. One real transport failure above is
    // enough fidelity for seven seconds of suite; these cases are about what
    // gets written, and they are the ones that repeat.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'nonsense';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'not-a-real-anon-key';
  });

  it('never writes the line that says the badge works', async () => {
    await expect(lookUpBadgeVerification(BADGE_ID)).rejects.toThrow(/not a database address/);
    expect(said.some((entry) => /either route/i.test(entry.message))).toBe(true);
    expect(
      JSON.stringify(said),
      'the log says the badge works at the moment every badge went grey',
    ).not.toMatch(/The badge works/);
  });

  it('says it once a minute, not once per impression', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(lookUpBadgeVerification(BADGE_ID)).rejects.toThrow();
    }
    const lines = said.filter((entry) => /either route/i.test(entry.message));
    expect(lines, 'every badge impression on every embed would write this line').toHaveLength(1);
  });
});

describe('the verification page', () => {
  it('writes the line its own comment promises', () => {
    /*
     * Read as source rather than rendered: the page is a server component that
     * reads the published signing keys and the row in the same call, and what is
     * being held here is one line inside its catch. The behaviour of the lookup
     * it calls is covered above.
     */
    const page = withoutComments(readFileSync('apps/web/app/verify/page.tsx', 'utf8'));
    const lookup = page.slice(page.indexOf('async function lookUpBadge'));
    expect(lookup, 'the catch swallows the failure again').toMatch(/catch \(error\)/);
    expect(lookup).toMatch(/console\.error\(/);
    expect(lookup, 'a public page logging per request is its own fault').toMatch(/sayItAgain\(/);
  });
});

describe('where the fallback line is written', () => {
  it('comes after the row has arrived, not before the attempt', () => {
    // The whole defect, in one ordering. Said before the call, it is a claim
    // about something that has not happened yet — and it is the claim "the
    // badge works".
    const source = withoutComments(readFileSync('apps/web/lib/badge-verification.ts', 'utf8'));
    const apiCall = source.indexOf('.maybeSingle()');
    const fellBack = source.indexOf('fell back to the Supabase API');
    expect(apiCall).toBeGreaterThan(-1);
    expect(fellBack, 'the fallback is announced before it is attempted').toBeGreaterThan(apiCall);
  });
});
