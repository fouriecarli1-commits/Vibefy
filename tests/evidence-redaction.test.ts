/**
 * What must never reach an evidence artefact.
 *
 * The brief is blunt about this one: we cannot be the service that leaks
 * credentials. Evidence is the part of an assessment most likely to carry
 * somebody else's secret by accident — a response body, a console line, the
 * URL of the page a screenshot was taken of — and it is kept for up to ninety
 * days and shown in a report.
 *
 * Redaction happens at capture rather than at publication, because an artefact
 * we have to remember to sanitise later is an artefact that eventually gets
 * published unsanitised. Nothing tested that it happens at all, which is how
 * two of the three fields on an artefact came to be exempt from it: the body
 * was redacted while the `summary` and `metadata` beside it — both carrying the
 * same URL — went in untouched, and the summary is the field a report shows.
 *
 * No literal credential appears in this file. The shapes are assembled at run
 * time, because our own secret scanner and GitHub's push protection both read
 * this repository and both would be right to object.
 */
import { describe, expect, it } from 'vitest';
import { EvidenceStore, RETENTION_DAYS, redact } from '../packages/engine/src/index.ts';

/** Credential shapes, built rather than written, so no real-looking key is committed. */
const SHAPES = {
  anthropic: ['sk', 'ant', `api03${'x'.repeat(40)}`].join('-'),
  stripe: ['sk', 'live', `51H${'x'.repeat(24)}A`].join('_'),
  aws: `AKIA${'Q'.repeat(16)}`,
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'x'.repeat(43)].join('.'),
  card: '4111111111111111',
};

describe('the patterns themselves', () => {
  it.each(Object.entries(SHAPES))('takes out a %s', (_label, secret) => {
    const { text, redactions } = redact(`before ${secret} after`);
    expect(text).not.toContain(secret);
    expect(text).toMatch(/\[REDACTED:/);
    expect(redactions.length).toBeGreaterThan(0);
  });

  it('leaves ordinary text alone', () => {
    const { text, redactions } = redact('An ordinary sentence with a price of 49.99 in it.');
    expect(text).toBe('An ordinary sentence with a price of 49.99 in it.');
    expect(redactions).toEqual([]);
  });
});

describe('an artefact, in all three of its fields', () => {
  /** The real shape of the leak: a credential in a query string. */
  const url = `https://kettle.example/reset?token=${SHAPES.anthropic}`;

  it('takes it out of the body, as it always did', () => {
    const store = new EvidenceStore('assessment-1');
    const artefact = store.capture({
      kind: 'http_exchange',
      summary: 'Initial page load',
      body: { request: { url } },
    });
    expect(artefact.body.toString('utf8')).not.toContain(SHAPES.anthropic);
  });

  it('takes it out of the summary, which is the field a report shows', () => {
    const store = new EvidenceStore('assessment-1');
    const artefact = store.capture({
      kind: 'http_exchange',
      summary: `GET ${url} → 200`,
      body: { nothing: 'here' },
    });
    expect(artefact.summary).not.toContain(SHAPES.anthropic);
    expect(artefact.summary).toMatch(/\[REDACTED:ANTHROPIC_KEY:/);
    expect(artefact.metadata.redactions).toContain('ANTHROPIC_KEY');
  });

  it('takes it out of metadata, where a screenshot records the page it was of', () => {
    const store = new EvidenceStore('assessment-1');
    const artefact = store.capture({
      kind: 'screenshot',
      summary: 'Landing page, desktop viewport',
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      metadata: { url, viewport: { width: 1280, height: 800 } },
    });
    expect(JSON.stringify(artefact.metadata)).not.toContain(SHAPES.anthropic);
    expect(String(artefact.metadata.url)).toMatch(/\[REDACTED:ANTHROPIC_KEY:/);
  });

  it('reaches a secret nested inside metadata', () => {
    const store = new EvidenceStore('assessment-1');
    const artefact = store.capture({
      kind: 'console_log',
      summary: 'Console output',
      body: 'nothing',
      metadata: { entries: [{ text: `Bearer ${SHAPES.jwt}` }] },
    });
    expect(JSON.stringify(artefact.metadata)).not.toContain(SHAPES.jwt);
  });

  it('does not mangle a number that merely looks like a card', () => {
    // `POSSIBLE_PAN` matches any run of 13 to 19 digits, which is a millisecond
    // timestamp as readily as a card number. Metadata redaction touches strings
    // only, so a number that stays a number cannot be caught by it — and there
    // is no credential that arrives as a JavaScript number.
    const store = new EvidenceStore('assessment-1');
    const at = 1_771_200_000_000;
    const artefact = store.capture({
      kind: 'header_scan',
      summary: 'Headers',
      body: 'nothing',
      metadata: { capturedAtMs: at, durationMs: 1234 },
    });
    expect(artefact.metadata.capturedAtMs).toBe(at);
    expect(artefact.metadata.durationMs).toBe(1234);
  });

  it('leaves a binary body exactly as captured', () => {
    // You cannot regex a PNG, and trying would corrupt the evidence. What
    // protects a screenshot is the retention deadline below, not redaction.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const store = new EvidenceStore('assessment-1');
    const artefact = store.capture({
      kind: 'screenshot',
      summary: 'Landing page',
      body: png,
    });
    expect(artefact.body.equals(png)).toBe(true);
    expect(artefact.contentType).toBe('image/png');
  });
});

describe('how long an artefact lives', () => {
  it('expires a screenshot soonest, because it is the highest incidental-data risk', () => {
    expect(RETENTION_DAYS.screenshot).toBeLessThan(RETENTION_DAYS.http_exchange);
    expect(RETENTION_DAYS.screenshot).toBeLessThanOrEqual(RETENTION_DAYS.console_log);
  });

  it('sets the deadline at capture, so nothing has to remember to', () => {
    const at = new Date('2026-09-21T00:00:00Z');
    const store = new EvidenceStore('assessment-1', () => at);
    const artefact = store.capture({ kind: 'screenshot', summary: 'Landing page', body: 'x' });
    const expected = new Date(at);
    expected.setUTCDate(expected.getUTCDate() + RETENTION_DAYS.screenshot);
    expect(artefact.retentionUntil).toBe(expected.toISOString());
  });
});
