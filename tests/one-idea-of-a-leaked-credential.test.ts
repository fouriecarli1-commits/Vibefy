/**
 * Two readers of one rule: what a leaked credential looks like.
 *
 * `tools/secret-scan.mjs` refuses to let us commit one. `CREDENTIAL_PATTERNS`
 * in the engine's static-intake stage tells a customer they have committed one,
 * which is SEC-04 and the fastest path to real harm in an AI-built
 * application. The same idea, written twice, in two languages, for two
 * audiences.
 *
 * They had already drifted, and the comment above the engine's list records how
 * it was found: it claimed to be "the same list the scanner over our own
 * repository uses" and it was not — nine patterns against thirteen, missing a
 * JSON Web Token (which is the shape of a Supabase service-role key, the worst
 * single credential in the stack our customers build on), an OpenAI key, a
 * Stripe webhook signing secret, and AWS temporary credentials whose id begins
 * ASIA rather than AKIA.
 *
 * It was fixed by hand and nothing held it. The next pattern added to our own
 * scanner would simply not reach the customer-facing scan, silently, and the
 * comment claiming the lists match would be wrong again.
 *
 * ## Why this compares what they detect rather than how they are written
 *
 * The regexes differ on purpose and always will: our own repository can afford
 * `sk-ant-` at twenty characters while a customer's report wants sixteen, and
 * one pattern is deliberately not carried across at all. Comparing sources
 * would fail on the lengths and tell us nothing. So each list is given the same
 * corpus of credential-shaped strings and asked what it can see.
 *
 * Every string below is assembled at runtime from parts. A file of fake keys is
 * a file our own scanner has to be told to ignore, and the gate tripping over
 * the test written to check the gate is the single most common accident in this
 * suite — five of seven screens on 2026-10-10 hit it.
 */
import { describe, expect, it } from 'vitest';
import { SECRET_PATTERNS, scanText } from '../tools/secret-scan.mjs';
import { credentialsOnLine } from '../packages/engine/src/stages/static-intake.ts';

/** Long runs of plausible characters, built rather than written. */
const run = (
  length: number,
  alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
) => Array.from({ length }, (_, index) => alphabet[(index * 7 + 3) % alphabet.length]).join('');

const upper = (length: number) => run(length, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');

/** A JWT whose payload decodes to a service role, which is the one that matters. */
const serviceRoleJwt = (() => {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    part({ alg: 'HS256', typ: 'JWT' }),
    part({ role: ['service', 'role'].join('_'), iss: 'supabase' }),
    run(43),
  ].join('.');
})();

/**
 * One line per credential kind, each a shape both lists claim to know.
 *
 * `kind` is only a label for a failure message. What is asserted is that a line
 * seen by one scan is seen by the other.
 */
const CORPUS: readonly { kind: string; line: string }[] = [
  { kind: 'Anthropic key', line: `const k = "${['sk', 'ant', run(32)].join('-')}"` },
  { kind: 'OpenAI key', line: `const k = "${'sk-' + run(40)}"` },
  { kind: 'Stripe live secret', line: `const k = "${['sk', 'live', run(24)].join('_')}"` },
  { kind: 'Stripe test secret', line: `const k = "${['sk', 'test', run(24)].join('_')}"` },
  { kind: 'Stripe webhook secret', line: `const k = "${['whsec', run(32)].join('_')}"` },
  { kind: 'AWS long-term key id', line: `const k = "${'AKIA' + upper(16)}"` },
  { kind: 'AWS temporary key id', line: `const k = "${'ASIA' + upper(16)}"` },
  { kind: 'GitHub token', line: `const k = "${['ghp', run(36)].join('_')}"` },
  { kind: 'Google API key', line: `const k = "${'AIza' + run(35)}"` },
  { kind: 'Slack token', line: `const k = "${['xoxb', run(12), run(24)].join('-')}"` },
  { kind: 'Supabase service-role JWT', line: `const k = "${serviceRoleJwt}"` },
  {
    kind: 'private key block',
    line: `-----BEGIN ${'RSA'} PRIVATE KEY-----`,
  },
  {
    /*
     * Assembled so that no line of this file is itself a connection string.
     *
     * Written out, the template literal reads as one to `tools/secret-scan.mjs`
     * — the `${…}` is just characters to a regex — and the gate refused the
     * file. Sixth time tonight a checker tripped over the text written to check
     * it, which the runbook says to expect and to answer this way rather than
     * with a suppression comment.
     */
    kind: 'Postgres connection string with a password',
    line: ['DATABASE_URL=postgres', '//app', run(12)].join(':') + '@db.internal:5432/kettle',
  },
];

const ours = (line: string) => scanText(line, 'fixture').length > 0;
const theirs = (line: string) => credentialsOnLine(line).length > 0;

describe('the corpus itself', () => {
  it('is credential-shaped, or everything below passes for nothing', () => {
    // The positive control. A corpus our own scanner cannot see would make
    // every comparison below vacuously true.
    const unseen = CORPUS.filter((entry) => !ours(entry.line)).map((entry) => entry.kind);
    expect(unseen).toEqual([]);
  });

  it('covers every pattern our own scanner carries, bar the one that cannot be fixtured', () => {
    /*
     * The thirteenth pattern is "assignment of a long opaque value to a
     * secret-looking name", which every line above matches by construction —
     * they are all `const k = "…"`. It is checked on its own below.
     */
    expect(SECRET_PATTERNS).toHaveLength(13);
    // Thirteen kinds in the corpus against thirteen patterns, because AWS gets
    // two lines — AKIA and ASIA — for the one pattern, and the opaque-value
    // pattern gets none of its own.
    expect(CORPUS).toHaveLength(13);
  });
});

describe('a credential shape we refuse to commit', () => {
  it('is one we would also tell a customer about', () => {
    const missed = CORPUS.filter((entry) => !theirs(entry.line)).map((entry) => entry.kind);
    // The drift that happened: four of these were invisible to the customer
    // scan while our own gate refused them. A failure here means the engine's
    // CREDENTIAL_PATTERNS is behind tools/secret-scan.mjs again.
    expect(missed).toEqual([]);
  });
});

describe('a credential shape we would report', () => {
  it('is one we also refuse to commit', () => {
    // The other direction, which is the worse one to get wrong: a shape we tell
    // a stranger is dangerous, and will happily commit ourselves.
    const missed = CORPUS.filter((entry) => theirs(entry.line) && !ours(entry.line)).map(
      (entry) => entry.kind,
    );
    expect(missed).toEqual([]);
  });
});

describe('the one pattern deliberately not carried across', () => {
  const opaque = `const apiKey = "${run(32)}"`;

  it('is refused in our own repository', () => {
    expect(ours(opaque)).toBe(true);
  });

  it('is not reported in a customer report, and the reason is written down', () => {
    // A long opaque value assigned to a secret-looking name earns its place in
    // our repository, where every such value is a mistake. In somebody else's
    // application it is as often a public key, a build id or a hash — and a
    // guess there costs a stranger their badge through GATE-EXPOSED-SECRET.
    expect(theirs(opaque)).toBe(false);
    const source = credentialsOnLine.toString();
    expect(source.length).toBeGreaterThan(50);
  });
});

describe('the shape shared by a public value and a secret', () => {
  it('reports a service-role token and leaves an anon one alone', () => {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const anon = [
      part({ alg: 'HS256', typ: 'JWT' }),
      part({ role: 'anon', iss: 'supabase' }),
      run(43),
    ].join('.');

    expect(credentialsOnLine(`const k = "${serviceRoleJwt}"`)).toHaveLength(1);
    // The anon key belongs in the browser. Flagging the shape alone would cap
    // every correct Supabase application at 39.
    expect(credentialsOnLine(`const k = "${anon}"`)).toEqual([]);
  });

  it('leaves a token that will not decode alone, because a guess costs a badge', () => {
    expect(credentialsOnLine(`const k = "eyJ${run(20)}.${run(20)}.${run(20)}"`)).toEqual([]);
  });
});
