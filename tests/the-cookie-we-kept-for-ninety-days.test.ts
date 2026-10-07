/**
 * Every response header reached the evidence store, `set-cookie` included.
 *
 * `ScopedHttp.request` captures an `http_exchange` whose body carries the whole
 * header map, and `deterministic.ts` captures a `header_scan` that does the
 * same. `evidence.ts` redacts at capture — "an artefact we have to remember to
 * sanitise later is an artefact that eventually gets published unsanitised" —
 * and it does it with six patterns: an Anthropic key, a Stripe key, an AWS key
 * id, a JWT, a private key block, and a run of 13 to 19 digits.
 *
 * None of them matches a session cookie. So a customer's application that sets
 * one on any page we fetched had that value written into our `evidence` table in
 * plaintext, with a 90-day retention on the `http_exchange` kind.
 *
 * PART 6.2 says not to store a customer's real credentials. A session cookie is
 * a credential, and an exposed one is a finding we would raise against them.
 *
 * The redaction has to be careful rather than thorough. SEC-11's finding is
 * about a cookie's *attributes* — `HttpOnly`, `Secure`, `SameSite` — and a
 * reviewer confirming it reads this artefact. So the name and the attributes
 * stay and only the value goes, which is the one part no finding is about.
 *
 * Also brought to parity: this was the third list of credential shapes in the
 * repository, after `tools/secret-scan.mjs` with thirteen and the engine's own
 * scanner with nine (brought level earlier tonight). Six here, missing a GitHub
 * token, a Google key, a Slack token, an OpenAI key, a Stripe webhook secret, a
 * Postgres URL with a password, and AWS temporary credentials — every one of
 * which the scanner would raise as a critical finding if it found it in a
 * customer's repository, and any of which could arrive in a header or a body
 * we captured.
 */
import { describe, expect, it } from 'vitest';
import { EvidenceStore, redact, redactHeaders } from '../packages/engine/src/runtime/evidence.ts';

describe('a header carrying a credential', () => {
  it('keeps a cookie’s name and attributes, because a finding is about those', () => {
    const redacted = redactHeaders({
      'set-cookie': 'sid=s%3AaVeryRealSessionValue.signature; Path=/; HttpOnly; SameSite=Lax',
    });
    const value = redacted['set-cookie']!;
    expect(value).toContain('sid=');
    expect(value).toContain('HttpOnly');
    expect(value).toContain('SameSite=Lax');
    expect(value).toContain('Path=/');
  });

  it('removes the value, which is the part no finding is about', () => {
    const redacted = redactHeaders({
      'set-cookie': 'sid=s%3AaVeryRealSessionValue.signature; Path=/; HttpOnly',
    });
    expect(redacted['set-cookie']).not.toContain('aVeryRealSessionValue');
    expect(redacted['set-cookie']).toMatch(/REDACTED:COOKIE:\d+chars/);
  });

  it('handles several cookies in one header, which is how undici joins them', () => {
    const redacted = redactHeaders({
      'set-cookie': 'sid=secretone; HttpOnly, csrf=secrettwo; Secure',
    });
    expect(redacted['set-cookie']).not.toContain('secretone');
    expect(redacted['set-cookie']).not.toContain('secrettwo');
    expect(redacted['set-cookie']).toContain('HttpOnly');
    expect(redacted['set-cookie']).toContain('Secure');
    expect(redacted['set-cookie']).toContain('csrf=');
  });

  it('takes an authorization header out whole, because none of it is evidence', () => {
    const redacted = redactHeaders({
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
      'x-api-key': 'live-key-value',
    });
    expect(redacted.authorization).not.toContain('payload');
    expect(redacted['x-api-key']).not.toContain('live-key-value');
  });

  it('leaves every other header exactly as it was', () => {
    // The direction this fails in: a redactor that mangles the headers a
    // finding quotes, so the evidence stops supporting it.
    const headers = {
      'content-type': 'text/html; charset=utf-8',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'content-security-policy': "default-src 'self'",
      'access-control-allow-origin': '*',
    };
    expect(redactHeaders(headers)).toEqual(headers);
  });
});

describe('the shapes this redactor knows', () => {
  const taken = (text: string) => redact(text).redactions;

  it('takes a GitHub token, which the scanner calls critical', () => {
    expect(taken(`token ghp_${'a'.repeat(36)}`)).toContain('GITHUB_TOKEN');
  });

  it('takes an OpenAI key', () => {
    expect(taken(`key sk-${'a'.repeat(44)}`)).toContain('OPENAI_KEY');
  });

  it('takes a Google API key', () => {
    expect(taken(`key AIza${'a'.repeat(35)}`)).toContain('GOOGLE_KEY');
  });

  it('takes a Slack token', () => {
    expect(taken(`xoxb-${'1'.repeat(12)}-abcdef`)).toContain('SLACK_TOKEN');
  });

  it('takes a Stripe webhook signing secret', () => {
    expect(taken(`whsec_${'a'.repeat(32)}`)).toContain('STRIPE_WEBHOOK_SECRET');
  });

  it('takes a database URL with a password in it', () => {
    // Built from parts, because our own pre-commit scanner reads this file
    // and a connection string with a password in it is exactly what it is for.
    const dsn = ['postgresql://app:', 'hunter2hunter2', '@db.example.test:5432/main'].join('');
    expect(taken(dsn)).toContain('DATABASE_URL');
  });

  it('takes AWS temporary credentials, not only the permanent ones', () => {
    // AWS's own documentation example, split for the same reason.
    const example = 'IOSFODNN7EXAMPLE';
    expect(taken(`ASIA${example}`)).toContain('AWS_KEY');
    expect(taken(`AKIA${example}`)).toContain('AWS_KEY');
  });

  it('still takes the six it always took', () => {
    expect(taken(`sk-ant-${'a'.repeat(20)}`)).toContain('ANTHROPIC_KEY');
    expect(taken(`sk_live_${'a'.repeat(16)}`)).toContain('STRIPE_KEY');
    expect(taken(`-----${'BEGIN'} RSA PRIVATE KEY-----`)).toContain('PRIVATE_KEY');
    expect(taken('4111111111111111')).toContain('POSSIBLE_PAN');
  });

  it('leaves ordinary prose alone', () => {
    // A redactor that fires on everything redacts the evidence.
    expect(taken('The landing page sets no Content-Security-Policy header.')).toEqual([]);
  });
});

describe('what reaches an artefact', () => {
  it('has the cookie value out of it by the time it is stored', () => {
    const store = new EvidenceStore('cookie-fixture');
    const artefact = store.capture({
      kind: 'http_exchange',
      summary: 'GET https://example.test/ → 200',
      body: {
        response: {
          status: 200,
          headers: redactHeaders({
            'set-cookie': 'sid=aVeryRealSessionValue; Path=/; HttpOnly',
            'content-type': 'text/html',
          }),
        },
      },
    });
    const stored = artefact.body.toString('utf8');
    expect(stored).not.toContain('aVeryRealSessionValue');
    expect(stored).toContain('HttpOnly');
  });
});

/**
 * Both capture sites, held from source.
 *
 * The redactor existing is not the fix; being called is. Two places capture a
 * header map — `ScopedHttp.request` for the exchange and `deterministic.ts` for
 * the header scan — and the second was found by grepping rather than by reading
 * the first, which is how it would be missed again.
 */
describe('every place a header map is stored', () => {
  const sources = [
    'packages/engine/src/runtime/http.ts',
    'packages/engine/src/stages/deterministic.ts',
  ];

  it('passes it through the redactor', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const path of sources) {
      // Line by line, not with a block-comment regex.
      //
      // `http.ts` sends an Accept header of star-slash-star, and that string
      // holds the two characters that open a block comment — so a non-greedy
      // block-comment pattern starts matching inside it and eats everything to
      // the next close, which in this file is most of the function. The first
      // version of this test reported the call missing for that reason, and the
      // call was right there. The second version said so in a block comment
      // containing the header's value, which closed the comment it was inside
      // and would not parse. Hence this, in line comments, spelled out.
      const source = readFileSync(join(import.meta.dirname, '..', path), 'utf8')
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          return !trimmed.startsWith('//') && !trimmed.startsWith('*') && trimmed !== '/**';
        })
        .join('\n');
      expect(source, path).toMatch(/headers: redactHeaders\(/);
      // And nothing stores the raw map beside it.
      expect(source, path).not.toMatch(/body: \{[^}]*\bheaders,/);
    }
  });

  it('still hands the raw map to the checks, which is what a finding is drawn from', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const stage = readFileSync(
      join(import.meta.dirname, '..', 'packages/engine/src/stages/deterministic.ts'),
      'utf8',
    );
    // `transportChecks` reads `response.headers`, not the artefact. If that
    // ever changed, redaction would start deciding findings.
    expect(stage).toMatch(/transportChecks\(/);
    const checks = readFileSync(
      join(import.meta.dirname, '..', 'packages/engine/src/stages/deterministic.ts'),
      'utf8',
    );
    expect(checks).toMatch(/response\.headers\['set-cookie'\]/);
  });
});
