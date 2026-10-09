/**
 * The warranty says we will not modify or delete data. The click tool could.
 *
 * `legal/authorisation-to-test.md`, under "We will not", says in plain words:
 * **"Modify, delete or exfiltrate data"**. Every authorisation row carries
 * `allow_data_modification: false`, and
 * `authorisations_intensity_is_non_destructive` makes it impossible for that to
 * be anything else — the customer cannot even authorise more.
 *
 * Measured on 2026-10-09 by tracing all eight fields of the intensity ceiling
 * from the database into the engine. Four of them — `allowDataModification`,
 * `allowDataExport`, `allowAccountCreation`, `syntheticAccountsOnly` — were
 * read out of the row, typed, defaulted in five places, and consulted in
 * exactly zero conditions. Three describe capabilities the engine does not yet
 * have, so they were vacuously satisfied. The fourth was not: `click` clicks
 * whatever element the model names, by visible text or by selector, on the
 * customer's live application, and the only thing between the model and a
 * "Delete account" button was a sentence in a tool description.
 *
 * A rule that lives in a prompt is a rule the model can be talked out of. It is
 * the same argument the schema already makes about rules that live only in
 * `apps/web`: enforcement has to be where the act happens.
 *
 * Both directions are held here. A destructive control is refused and reported;
 * an ordinary one is still clicked, because a browser pass that cannot press
 * Submit explores nothing and would have been the more expensive mistake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BrowserSession } from '../packages/engine/src/runtime/browser.ts';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';
import { DEFAULT_CEILING, ScopeGuard } from '../packages/engine/src/runtime/scope.ts';
import { browserTools } from '../packages/engine/src/stages/tools.ts';
import {
  DESTRUCTIVE_CONTROL_PHRASES,
  destructivePhraseIn,
  normaliseLabel,
} from '../packages/engine/src/runtime/destructive-controls.ts';
import type { RefusedControl } from '../packages/engine/src/runtime/destructive-controls.ts';

let server: Server;
let base: string;
let session: BrowserSession;
let refused: RefusedControl[];

/** An account page with the controls a real one has, destructive and not. */
const account = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Account</title></head>
<body>
  <h1>Your account</h1>
  <form action="/search" method="get"><input name="q"><input type="submit" value="Search"></form>
  <button id="save">Save changes</button>
  <button id="dialog-cancel">Cancel</button>
  <button id="delete">Delete account</button>
  <button id="cancel-sub">Cancel subscription</button>
  <button id="pay">Pay now</button>
  <button id="icon" aria-label="Remove this item"></button>
  <input id="submit-delete" type="submit" value="Erase everything">
  <button id="unlabelled"></button>
</body></html>`;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(account);
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
    new EvidenceStore('must-not-press'),
  );
  await session.open();
}, 120_000);

afterAll(async () => {
  await session?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

/** The tools as a stage gets them, with the ceiling every authorisation has. */
function tools() {
  refused = [];
  return browserTools({
    session,
    ceiling: DEFAULT_CEILING,
    onRefusedControl: (entry) => refused.push(entry),
  });
}

const clickBySelector = async (selector: string) => {
  const set = tools();
  await set.find((entry) => entry.name === 'navigate')!.run({ url: base });
  return set.find((entry) => entry.name === 'click')!.run({ selector });
};

describe('a control that would destroy data or spend money', () => {
  it.each([
    ['#delete', 'Delete account', 'delete'],
    ['#cancel-sub', 'Cancel subscription', 'cancel subscription'],
    ['#pay', 'Pay now', 'pay now'],
  ])('refuses %s and says why', async (selector, label, phrase) => {
    const result = await clickBySelector(selector);
    expect(result, `clicking ${label} was not refused`).toMatch(/^Refused:/);
    expect(result).toContain(label);
    expect(result).toContain(phrase);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.label).toBe(label);
  });

  it('reads an icon button’s accessible name, which has no text at all', async () => {
    // The only label an icon button has. Reading `innerText` alone would let
    // every icon-only destructive control through, and an icon-only bin is the
    // commonest delete button on the web.
    const result = await clickBySelector('#icon');
    expect(result).toMatch(/^Refused:/);
    expect(refused[0]?.label).toBe('Remove this item');
  });

  it('reads a submit input’s value, which is where its label lives', async () => {
    const result = await clickBySelector('#submit-delete');
    expect(result).toMatch(/^Refused:/);
    expect(refused[0]?.label).toBe('Erase everything');
  });

  it('tells the model the refusal is the boundary working, not a tool fault', async () => {
    // The wording matters: a model told "that failed" tries another route to
    // the same button. Told "that is the authorisation", it reports what it saw.
    const result = await clickBySelector('#delete');
    expect(result).toMatch(/does not permit/i);
    expect(result).toMatch(/report it from the page rather than by pressing it/i);
  });
});

describe('what must still be clickable', () => {
  it('still presses an ordinary control', async () => {
    // The expensive mistake in the other direction: a pass that cannot press
    // Submit explores nothing and reports that it explored.
    const result = await clickBySelector('#save');
    expect(result, 'an ordinary button was refused').toMatch(/^Clicked\./);
    expect(refused).toHaveLength(0);
  });

  it('still presses Cancel on its own, which is the universal dismiss', async () => {
    // `cancel` alone is how every dialog is closed. Refusing it would make
    // every modal a dead end while protecting nothing — `cancel subscription`
    // is a different act and is refused above.
    const result = await clickBySelector('#dialog-cancel');
    expect(result, 'a dialog could not be dismissed').toMatch(/^Clicked\./);
    expect(refused).toHaveLength(0);
  });

  it('still presses a control it cannot read a label for', async () => {
    // Refusing every unlabelled control would stop the pass on most
    // applications, and an unreadable button is not evidence of destruction.
    // This is a stated limit of the check, not an oversight.
    const result = await clickBySelector('#unlabelled');
    expect(result).toMatch(/^Clicked\./);
    expect(refused).toHaveLength(0);
  });
});

describe('the matcher, on its own', () => {
  it('is case- and whitespace-insensitive, because a label is markup', async () => {
    expect(normaliseLabel('  DELETE\n  Account ')).toBe('delete account');
    expect(destructivePhraseIn('  DELETE\n  Account ')).toBe('delete');
  });

  it('says nothing about an empty label rather than guessing', () => {
    expect(destructivePhraseIn('')).toBeNull();
    expect(destructivePhraseIn('   \n ')).toBeNull();
  });

  it.each([
    'Submit',
    'Send',
    'Save',
    'Save changes',
    'Continue',
    'Next',
    'OK',
    'Cancel',
    'Search',
    'Log in',
    'Sign up',
  ])('leaves %s alone, which a pass needs', (label) => {
    expect(destructivePhraseIn(label), `${label} would be refused`).toBeNull();
  });

  it.each([
    'Delete account',
    'Remove card',
    'Erase everything',
    'Deactivate',
    'Close my account',
    'Terminate agreement',
    'Cancel subscription',
    'Unsubscribe',
    'Revoke access',
    'Pay now',
    'Place order',
    'Complete purchase',
    'Checkout',
    'Buy now',
    'Withdraw funds',
    'Transfer balance',
    'Reset to defaults',
    'Permanently delete',
  ])('refuses %s', (label) => {
    expect(destructivePhraseIn(label), `${label} would be clicked`).not.toBeNull();
  });

  it('keeps every phrase lower-case, or it can never match', () => {
    // The matcher lower-cases the label and not the list. A capital letter in
    // the list is a phrase that is never matched and a control that is always
    // pressed — silent, and exactly the shape of the defect this closes.
    const wrong = DESTRUCTIVE_CONTROL_PHRASES.filter((phrase) => phrase !== phrase.toLowerCase());
    expect(wrong, `not lower-case:\n  ${wrong.join('\n  ')}`).toEqual([]);
    expect(DESTRUCTIVE_CONTROL_PHRASES.length).toBeGreaterThan(20);
  });
});

describe('the three ceilings that are satisfied by absence', () => {
  /**
   * Which ceiling governs each thing the model can do to a live application.
   *
   * `allowDataExport`, `allowAccountCreation` and `syntheticAccountsOnly` are
   * consulted nowhere, and that is currently correct: the engine has no
   * capability they would govern. Nothing captures bulk data, nothing creates
   * an account, nothing signs in — `syntheticCredentials` is an optional field
   * on the job that no caller sets.
   *
   * "Currently correct" is the problem. The moment a tool arrives that signs
   * in or exports, those ceilings become live rules that nothing reads, and no
   * test would notice. A new tool is how such a capability arrives, so the
   * tool surface is where the invariant belongs.
   *
   * Adding a tool therefore fails this test, which is the point: the failure
   * asks which ceiling governs it before it ships, rather than after.
   */
  const GOVERNED_BY: Readonly<Record<string, string>> = {
    navigate: 'the scope guard: host allowlist, exclusions, and the three numeric ceilings',
    read_page: 'nothing — it reads what is already loaded',
    click: 'allowDataModification, enforced above',
    fill: 'nothing yet; typing changes nothing until something is pressed, and click is guarded',
    screenshot: 'nothing — evidence of what was on screen',
    go_back: 'the scope guard, through the navigation it causes',
    reload: 'the scope guard, through the request it causes',
  };

  it('has exactly the tools whose governing rule has been decided', () => {
    const names = browserTools({ session, ceiling: DEFAULT_CEILING })
      .map((entry) => entry.name)
      .sort();
    const expected = Object.keys(GOVERNED_BY).sort();
    expect(
      names,
      'the model’s tool surface changed. For each new tool, decide which intensity ceiling governs ' +
        'it and add it to GOVERNED_BY — a tool that signs in makes `allowAccountCreation` and ' +
        '`syntheticAccountsOnly` live rules, and a tool that downloads makes `allowDataExport` one. ' +
        'All three are read from the authorisation and consulted nowhere today, which is only safe ' +
        'while no tool can do those things.',
    ).toEqual(expected);
  });

  it('still has no tool that signs in, creates an account or downloads', () => {
    // The same rule read from the other side, in the words a reader would use.
    // A tool called `login`, `sign_up` or `download` arriving without the
    // ceiling being consulted is the failure this is for.
    const names = Object.keys(GOVERNED_BY);
    for (const forbidden of ['login', 'log_in', 'sign_in', 'sign_up', 'register', 'download']) {
      expect(names, `a ${forbidden} tool exists and no ceiling governs it`).not.toContain(
        forbidden,
      );
    }
  });
});
