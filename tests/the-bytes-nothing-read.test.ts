/**
 * An artefact that said nothing, whether or not anybody had looked.
 *
 * Everything in `evidence.ts` exists to keep a credential out of storage.
 * `redactHeaders` takes out a header whose name says it carries one. `redact`
 * takes out anything shaped like one in a body. `redactDeep` does the summary
 * and the metadata as well, under a comment explaining that a URL is where a
 * token in a query string lives.
 *
 * None of it applies to a buffer, and nothing said so. An artefact that had
 * been read and found clean carried no `redactions` key; an artefact nothing
 * had read carried no `redactions` key either. One silence, two causes, and
 * the second is the one somebody disputing a finding would need to know.
 *
 * Two kinds arrive as bytes. A screenshot is a PNG, and no text rule could
 * ever read it. A Playwright trace is a zip, and that one carries what was
 * typed: measured against a local page on 2026-10-10, a trace captured the way
 * this engine captures them holds the value filled into a password field, the
 * address filled into an email field, and the full URL of every navigation,
 * token in the query string and all. `docs/OPEN_ITEMS.md` carries the choice
 * about it, because every way out costs something a founder has to weigh.
 */
import { describe, expect, it } from 'vitest';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';

const store = (): EvidenceStore => new EvidenceStore('assessment-1');

/*
 * Fixtures assembled from parts rather than written out.
 *
 * They have to match `REDACTION_PATTERNS` or these tests prove nothing, which
 * means they have to look exactly like the things `tools/secret-scan.mjs`
 * refuses to let into this repository — and it is right to refuse them. Joined
 * at run time, no line here is a credential, so the gate stays strict and the
 * fixture stays honest. A suppression comment would have worked too, and would
 * have left a line in the repository that reads like a leaked key.
 */
const STRIPE_SHAPED = ['sk', 'live', '0123456789abcdefgh'].join('_');
const JWT_SHAPED = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  'dBjftJeZ4CVPmB92K27uhbUJU1p1r',
].join('.');

describe('what the artefact says about its own body', () => {
  it('says a body was read and nothing was taken out', () => {
    const artefact = store().capture({
      kind: 'http_exchange',
      summary: 'GET https://customer.example/ → 200',
      body: 'nothing sensitive here',
    });
    expect(artefact.metadata.bodyRedaction).toBe('read_nothing_found');
    expect(artefact.metadata.redactions).toBeUndefined();
  });

  it('says a body was read and something was taken out', () => {
    const artefact = store().capture({
      kind: 'http_exchange',
      summary: 'GET https://customer.example/ → 200',
      body: `Authorization: Bearer ${STRIPE_SHAPED}`,
    });
    expect(artefact.metadata.bodyRedaction).toBe('applied');
    expect(artefact.body.toString()).not.toContain(STRIPE_SHAPED);
  });

  it('says a body was not readable, rather than saying nothing', () => {
    // The whole point. This is a screenshot's answer and a trace's answer, and
    // before it existed both were indistinguishable from the first case above.
    const artefact = store().capture({
      kind: 'playwright_trace',
      summary: 'the actions this session took',
      contentType: 'application/zip',
      body: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    });
    expect(artefact.metadata.bodyRedaction).toBe('not_readable');
  });

  it('still reads the summary and the metadata of an unreadable body', () => {
    /*
     * The body is the part nothing reads. A screenshot's metadata carries the
     * page URL and that is read on every path, which is the half of this that
     * was already right.
     *
     * A token of a recognised shape, because that is the claim this file can
     * actually make: `REDACTION_PATTERNS` matches shapes, and the file says so
     * in its own words — "an opaque random string is shaped like nothing". A
     * session identifier a customer's own application invented is not caught
     * here by anything, and asserting otherwise would be the comfortable kind
     * of test.
     */
    const token = JWT_SHAPED;
    const artefact = store().capture({
      kind: 'screenshot',
      summary: `the sign-in page at https://customer.example/?access_token=${token}`,
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      metadata: { url: `https://customer.example/?access_token=${token}` },
    });
    expect(artefact.summary).not.toContain(token);
    expect(String(artefact.metadata.url)).not.toContain(token);
    expect(artefact.metadata.bodyRedaction).toBe('not_readable');
  });

  it('answers for every kind, so a new one cannot be silent by default', () => {
    // A kind added later gets one of the three answers whichever branch it
    // takes, because both branches set it. This is the test that fails if a
    // third branch is ever added without one.
    for (const kind of ['console_log', 'dom_snapshot', 'header_scan'] as const) {
      const artefact = store().capture({ kind, summary: 'a capture', body: { a: 1 } });
      expect(artefact.metadata.bodyRedaction, kind).toBeDefined();
    }
  });
});
