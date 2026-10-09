/**
 * A password nobody gave us.
 *
 * `fill`'s description says: "Use only the synthetic test credentials you were
 * given; never invent credentials and never try ones you were not given." That
 * is the brief's rule — PART 6.2, "Never ask for, accept, or store a customer's
 * real user credentials" — written as a sentence in a prompt.
 *
 * A rule that lives in a prompt is a rule the model can be talked out of, and
 * the act it governs here is unauthorised credential testing against somebody's
 * live application. Typing `admin` into a password field and pressing enter is
 * the thing penetration-testing authorisations are written to bound; we hold a
 * signed authorisation that says we will not do it, and nothing in the tool
 * stopped it.
 *
 * So: the tool refuses. A secret field may receive exactly the password the
 * owner provisioned for this run, and nothing else. When no account was
 * provided there is nothing it may receive at all.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BrowserSession } from '../packages/engine/src/runtime/browser.ts';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';
import { DEFAULT_CEILING, ScopeGuard } from '../packages/engine/src/runtime/scope.ts';
import { browserTools } from '../packages/engine/src/stages/tools.ts';
import type { RefusedCredential } from '../packages/engine/src/runtime/credential-fields.ts';

let server: Server;
let base: string;
let session: BrowserSession;

/**
 * The account an owner provisions for an assessment, as a fixture.
 *
 * Named rather than inlined so the one place it is written is the one place the
 * scanner has to be told about, and so a test asserting "the refusal does not
 * echo this" cannot drift from the value the tool was handed.
 */
const PROVISIONED = {
  email: 'assessment+vibefy@example.test',
  password: 'Synthetic-9f3a-provisioned', // secret-scan-allow: fixture for a password this code refuses to invent
} as const;

/**
 * A sign-in form of the ordinary kind, plus the two other ways a secret field
 * announces itself: a one-time code input of type `text` that carries
 * `autocomplete="one-time-code"`, and a new-password field on a change form.
 */
const signIn = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign in</title></head>
<body>
<h1>Sign in</h1>
<form>
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username">
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password">
  <label for="code">Code</label>
  <input id="code" name="code" type="text" autocomplete="one-time-code">
  <label for="fresh">New password</label>
  <input id="fresh" name="new_password" type="text">
  <label for="bare">Secret</label>
  <input class="bare" type="password">
  <label for="note">Note</label>
  <textarea id="note" name="note"></textarea>
  <button type="submit">Sign in</button>
</form>
</body></html>`;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(signIn);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  session = new BrowserSession(
    new ScopeGuard({
      allowedHosts: ['127.0.0.1'],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 400 },
      allowPrivateNetworkForTesting: true,
    }),
    new EvidenceStore('fill'),
  );
  await session.open();
}, 120_000);

afterAll(async () => {
  await session?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

/** The tools as a run with no test account gets them. */
function withNoAccount() {
  const refusals: RefusedCredential[] = [];
  const tools = browserTools({
    session,
    ceiling: DEFAULT_CEILING,
    credentials: undefined,
    onRefusedCredential: (refused) => refusals.push(refused),
  });
  return { fill: tools.find((entry) => entry.name === 'fill')!, refusals };
}

/** The tools as a run with the owner's synthetic account gets them. */
function withAccount() {
  const refusals: RefusedCredential[] = [];
  const tools = browserTools({
    session,
    ceiling: DEFAULT_CEILING,
    credentials: PROVISIONED,
    onRefusedCredential: (refused) => refusals.push(refused),
  });
  return { fill: tools.find((entry) => entry.name === 'fill')!, refusals };
}

const valueOf = (selector: string) => session.page.locator(selector).first().inputValue();

describe('a run that was given no test account', () => {
  // Reloaded before each, so "the field is still empty" is a measurement of
  // this call and not a leftover from the one before it.
  beforeEach(async () => {
    await session.goto(`${base}/`, 'domcontentloaded');
  });

  it('cannot type a guessed password into a password field', async () => {
    const { fill, refusals } = withNoAccount();
    const result = await fill.run({ selector: '#password', value: 'admin' });

    expect(result).toMatch(/^Refused/);
    // The measurement that matters: not what the tool said, what the field holds.
    expect(await valueOf('#password')).toBe('');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.selector).toBe('#password');
  });

  it('cannot type one into a one-time-code field either', async () => {
    // `type="text"`, so nothing but `autocomplete` says this is a secret.
    const { fill } = withNoAccount();
    expect(await fill.run({ selector: '#code', value: '123456' })).toMatch(/^Refused/);
    expect(await valueOf('#code')).toBe('');
  });

  it('cannot type one into a field whose only marker is its type', async () => {
    // No name, no id, no autocomplete: `type="password"` on its own.
    const { fill } = withNoAccount();
    expect(await fill.run({ selector: '.bare', value: 'letmein' })).toMatch(/^Refused/);
    expect(await valueOf('.bare')).toBe('');
  });

  it('cannot type one into a field named for a password', async () => {
    const { fill } = withNoAccount();
    expect(await fill.run({ selector: '#fresh', value: 'Hunter2!' })).toMatch(/^Refused/);
    expect(await valueOf('#fresh')).toBe('');
  });

  it('says why, and says the refusal is the authorisation working', async () => {
    const { fill } = withNoAccount();
    const result = await fill.run({ selector: '#password', value: 'admin' });
    expect(result).toMatch(/no test account/i);
    expect(result).toMatch(/behind sign-in/i);
    // Not "try something else": the point is that there is nothing to try.
    expect(result).not.toMatch(/another/i);
  });

  it('still types into every field that is not a secret', async () => {
    // The half that makes the other half mean something. A tool that refused
    // every field would stop the pass on any application with a form, and the
    // stage would report an application it never exercised.
    const { fill, refusals } = withNoAccount();
    expect(await fill.run({ selector: '#email', value: 'someone@example.test' })).toMatch(
      /^Filled/,
    );
    expect(await valueOf('#email')).toBe('someone@example.test');
    expect(await fill.run({ selector: '#note', value: 'A note.' })).toMatch(/^Filled/);
    expect(await valueOf('#note')).toBe('A note.');
    expect(refusals).toHaveLength(0);
  });
});

describe('a run that was given one', () => {
  // Reloaded before each, so "the field is still empty" is a measurement of
  // this call and not a leftover from the one before it.
  beforeEach(async () => {
    await session.goto(`${base}/`, 'domcontentloaded');
  });

  it('types the password the owner provisioned', async () => {
    const { fill, refusals } = withAccount();
    expect(await fill.run({ selector: '#password', value: PROVISIONED.password })).toMatch(
      /^Filled/,
    );
    expect(await valueOf('#password')).toBe(PROVISIONED.password);
    expect(refusals).toHaveLength(0);
  });

  it('refuses any other password, which is the whole of "never try ones you were not given"', async () => {
    const { fill, refusals } = withAccount();
    const result = await fill.run({
      selector: '#password',
      value: PROVISIONED.password.slice(0, -1),
    });
    expect(result).toMatch(/^Refused/);
    expect(result).toMatch(/not the one the owner provisioned/i);
    expect(await valueOf('#password')).toBe('');
    expect(refusals).toHaveLength(1);
  });

  it('never quotes the value it refused', async () => {
    // A refusal that echoes the attempted password writes it into the model
    // transcript, and the transcript is stored. Whatever the model typed, it
    // does not come back out of this function.
    const { fill, refusals } = withAccount();
    const secret = 'Pa55word-do-not-echo';
    const result = await fill.run({ selector: '#password', value: secret });
    expect(result).not.toContain(secret);
    expect(JSON.stringify(refusals)).not.toContain(secret);
    // Nor the real one, which the tool has in hand.
    expect(result).not.toContain(PROVISIONED.password);
  });
});
