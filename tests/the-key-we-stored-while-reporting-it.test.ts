/**
 * The finding said a key had leaked. The artefact beside it held the key.
 *
 * `redactHeaders` has taken a token out of a stored request header since the
 * day evidence was built, under a careful rule with a paragraph explaining why
 * a name-based rule is not enough. The response **body** stored next to it was
 * kept raw — the first four thousand characters of it — and so was every
 * console entry the browser collected.
 *
 * That is the wrong way round for this product's own customers. Its copy says
 * the commonest serious defect in an application built with an assistant is a
 * key that reaches the browser, and a key that reaches the browser is *in the
 * body*. An assistant debugging someone's checkout writes
 * `console.log(supabaseKey)` and nobody takes it out. So the one finding this
 * engine exists to raise was filed beside an artefact holding the credential it
 * was about — in our storage, under a retention clock, readable by every
 * reviewer.
 *
 * Anré, 2026-10-21: "Vibefycode moet baie secure wees, ons werk met sensitiewe
 * inligting as hackers die repositories van maatskappye kry is ons in groot
 * moeilikheid." The repositories themselves are the safer half: only public
 * ones are cloned, and they are read and deleted. This was the other half.
 *
 * The locations survive, because that is what a reviewer confirms a finding by.
 * The values do not.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commentsBlanked } from './setup/source.ts';
import {
  credentialsOnLine,
  redactCredentials,
} from '../packages/engine/src/runtime/credentials.ts';

const STRIPE = `sk_live_${'a1B2c3D4e5F6g7H8i9J0k1L2'}`;
const ANTHROPIC = `sk-ant-${'api03-aaaaaaaaaaaaaaaaaaaaaa'}`;

/** A service-role JWT, built rather than pasted: the payload is what is read. */
function supabaseToken(role: string): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ role, iss: 'supabase' })}.${'s'.repeat(43)}`;
}

describe('what a stored body may carry', () => {
  it('replaces a credential with its name', () => {
    const { text, redacted } = redactCredentials(`<script>const k="${STRIPE}";</script>`);
    expect(text, 'the value is still in the artefact').not.toContain(STRIPE);
    expect(text).toContain('[redacted: a Stripe live secret key]');
    expect(redacted).toEqual(['a Stripe live secret key']);
  });

  it('keeps everything around it, so the artefact is still evidence', () => {
    // A reviewer confirms a finding by reading this. Taking out the page is
    // not redaction, it is deletion, and the finding becomes unconfirmable.
    const { text } = redactCredentials(
      `window.config = { url: "https://x.example", key: "${STRIPE}" }`,
    );
    expect(text).toContain('https://x.example');
    expect(text).toContain('window.config');
  });

  it('takes out every copy, not the first one', () => {
    /*
     * `credentialsOnLine` answers "is there one on this line" and stops at the
     * first match per shape, which is right for a scan that reports a location.
     * A body with eight copies of one key must lose all eight, and a redactor
     * that inherited that behaviour would have left seven.
     */
    const body = `${STRIPE} ... ${STRIPE} ... ${STRIPE}`;
    const { text, redacted } = redactCredentials(body);
    expect(text).not.toContain(STRIPE);
    expect(redacted).toHaveLength(3);
  });

  it('takes out more than one kind in one body', () => {
    const { text } = redactCredentials(`${STRIPE}\nconst a = "${ANTHROPIC}";`);
    expect(text).not.toContain(STRIPE);
    expect(text).not.toContain(ANTHROPIC);
  });

  it('leaves a value that is meant to be public', () => {
    /*
     * The same judgement the scan makes, for the same reason: a Supabase
     * project publishes its anon key in the browser in the same shape as its
     * service-role key, and redacting the anon key would strip the one value
     * that belongs on the page from every artefact of every correct Supabase
     * application.
     */
    const anon = supabaseToken('anon');
    const service = supabaseToken('service_role');
    expect(redactCredentials(`key: "${anon}"`).text).toContain(anon);
    expect(redactCredentials(`key: "${service}"`).text).not.toContain(service);
  });

  it('changes nothing in a body that carries no credential', () => {
    const body = '<!doctype html><html><body><h1>Kettles</h1></body></html>';
    expect(redactCredentials(body)).toEqual({ text: body, redacted: [] });
  });

  it('is the same list the scan reports from', () => {
    // One rule, two readers. The detector and the redactor disagreeing is a
    // credential reported as a finding and kept in the artefact beside it.
    expect(credentialsOnLine(`k = "${STRIPE}"`)).toHaveLength(1);
    expect(redactCredentials(`k = "${STRIPE}"`).redacted).toHaveLength(1);
  });
});

describe('the capture paths that store text', () => {
  const read = (path: string) => commentsBlanked(readFileSync(path, 'utf8'));

  it('redacts the response body it keeps', () => {
    const http = read('packages/engine/src/runtime/http.ts');
    expect(http).toMatch(/redactCredentials\(body\.slice\(0, 4000\)\)/);
    expect(http, 'the raw slice must not reach the artefact').not.toMatch(
      /bodyPreview: keepBody \? body\.slice/,
    );
    // And says what it took out, so an emptied preview is never read as a page
    // that returned nothing.
    expect(http).toMatch(/redactedCredentials/);
  });

  it('redacts what the browser collected', () => {
    const browser = read('packages/engine/src/runtime/browser.ts');
    const captured = browser.slice(browser.indexOf('captureConsole'));
    expect(captured).toMatch(/redactCredentials\(entry\.text\)/);
    expect(captured).toMatch(/redactCredentials\(error\)/);
    expect(captured).toMatch(/redactCredentials\(request\.url\)/);
  });

  it('is one list, in the runtime, where both halves can reach it', () => {
    // It lived in the stage that reports a credential, which is why the
    // capture paths could not use it.
    const stage = read('packages/engine/src/stages/static-intake.ts');
    expect(stage).toMatch(/from '\.\.\/runtime\/credentials\.ts'/);
    expect(stage, 'a second copy of the patterns is a second answer').not.toMatch(
      /const CREDENTIAL_PATTERNS/,
    );
  });
});
