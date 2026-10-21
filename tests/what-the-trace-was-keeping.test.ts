/**
 * The artefact that evidenced a sign-in held the password it typed.
 *
 * The published rubric names `playwright_trace` as the evidence for ten
 * criteria, so the trace has to be kept. What it was keeping was measured
 * rather than reasoned about: a real browser, driven through a sign-in against
 * a fixture that answers with a token in its headers, and the archive opened
 * afterwards.
 *
 * It held:
 *
 *   · the value typed into the password field, twice — in the `fill` call's
 *     parameters, and again in the log line Playwright writes beside it;
 *   · every `authorization`, `cookie`, `set-cookie` and `x-api-key` the run
 *     saw, which on a signed-in flow is a live session token for the
 *     application being assessed.
 *
 * `redactHeaders` has guarded the stored HTTP exchange beside it since the day
 * evidence was built. This was the hole next to it, and it is the one Anré
 * asked about: "ons werk met sensitiewe inligting".
 *
 * The container is kept rather than swapped for an extract, because a trace
 * that no longer opens in Playwright's viewer is one a reviewer cannot read.
 * The tests below build their own archives, so none of this needs a browser.
 */
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  entriesOf,
  redactTrace,
  redactTraceLine,
  zipOf,
} from '../packages/engine/src/runtime/trace.ts';

const PASSWORD = 'Sup3rSecretTestPassw0rd!';
const TOKEN = `sk_live_${'a1B2c3D4e5F6g7H8i9J0k1L2'}`;

/** The shapes a real trace carries, taken from one this engine produced. */
const EVENTS = [
  { type: 'context-options', browserName: 'chromium' },
  {
    type: 'before',
    callId: 'call@14',
    class: 'Frame',
    method: 'fill',
    params: { selector: '#password', strict: true, value: PASSWORD, timeout: 30_000 },
  },
  { type: 'log', callId: 'call@14', message: `  fill("${PASSWORD}")` },
  {
    type: 'before',
    callId: 'call@18',
    class: 'Route',
    method: 'fulfill',
    params: {
      status: 200,
      headers: [
        { name: 'content-type', value: 'application/json' },
        { name: 'set-cookie', value: `session=${TOKEN}; Path=/` },
        { name: 'x-api-key', value: TOKEN },
      ],
    },
  },
  {
    type: 'before',
    callId: 'call@20',
    class: 'Frame',
    method: 'click',
    params: { selector: '#submit' },
  },
];

const traceZip = (events: readonly unknown[] = EVENTS) =>
  zipOf([
    { name: 'trace.trace', body: Buffer.from(events.map((e) => JSON.stringify(e)).join('\n')) },
    { name: 'trace.network', body: Buffer.from('') },
    { name: 'trace.stacks', body: Buffer.from('{"files":[]}') },
  ]);

const eventsIn = (zip: Buffer) =>
  entriesOf(zip)
    .find((entry) => entry.name === 'trace.trace')!
    .body.toString('utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('what comes out of a trace', () => {
  it('does not carry the typed password', () => {
    const { zip } = redactTrace(traceZip());
    expect(zip.toString('latin1'), 'the password is still in the artefact').not.toContain(PASSWORD);
  });

  it('does not carry it in the log line beside the call either', () => {
    // Two places, and redacting one of them is the version of this fix that
    // looks done and is not.
    const { line } = redactTraceLine(JSON.stringify(EVENTS[2]));
    expect(line).not.toContain(PASSWORD);
    expect(line).toContain('[redacted]');
  });

  it('does not carry a session token from a header', () => {
    const { zip } = redactTrace(traceZip());
    expect(zip.toString('latin1')).not.toContain(TOKEN);
  });

  it('takes out a session cookie that looks like nothing in particular', () => {
    /*
     * The case the credential scan cannot see, and the one that actually turns
     * up: a session cookie is an opaque string with no issuer prefix to match
     * on. Removing a Stripe key from a header proves the scan works, not the
     * header rule — and with the header rule disabled, the first draft of this
     * file still passed, because `sk_live_` was caught by the scan on its way
     * past.
     */
    const opaque = 'a9f2b1c8d7e6f5a4b3c2d1e0f9a8b7c6';
    const { zip, redacted } = redactTrace(
      traceZip([
        {
          type: 'before',
          class: 'Route',
          method: 'fulfill',
          params: {
            status: 200,
            headers: [
              { name: 'set-cookie', value: `session=${opaque}; HttpOnly` },
              { name: 'cache-control', value: 'no-store' },
            ],
          },
        },
      ]),
    );
    expect(zip.toString('latin1'), 'a live session is still in the artefact').not.toContain(opaque);
    expect(redacted).toContain('the set-cookie header');
    // And the header beside it, which says something and gives away nothing.
    expect(zip.toString('latin1')).toContain('no-store');
  });

  it('says what it took out, so the artefact is not quietly thinner', () => {
    const { redacted } = redactTrace(traceZip());
    expect(redacted).toContain('a typed value');
    expect(redacted).toContain('the set-cookie header');
    expect(redacted).toContain('the x-api-key header');
  });

  it('leaves everything a reviewer reads it for', () => {
    /*
     * The sequence of actions and what each one did is the thing being
     * evidenced. A redaction that takes the selector, the method or the order
     * is not a redaction; it is deletion, and the ten criteria that cite this
     * artefact become unevidenced.
     */
    const events = eventsIn(redactTrace(traceZip()).zip);
    expect(events).toHaveLength(EVENTS.length);
    expect(events[1]).toMatchObject({
      class: 'Frame',
      method: 'fill',
      params: { selector: '#password', timeout: 30_000 },
    });
    expect(events[4]).toMatchObject({ method: 'click', params: { selector: '#submit' } });
    // A header that says nothing about anybody is left where it was.
    const fulfil = events[3] as { params: { headers: { name: string; value: string }[] } };
    expect(fulfil.params.headers[0]).toEqual({
      name: 'content-type',
      value: 'application/json',
    });
  });

  it('is still a zip, with the entries it had', () => {
    // A trace that will not open in Playwright's viewer is one a reviewer
    // cannot read, which is the reason the container is kept.
    const entries = entriesOf(redactTrace(traceZip()).zip).map((entry) => entry.name);
    expect(entries).toEqual(['trace.trace', 'trace.network', 'trace.stacks']);
  });

  it('reads a deflated entry, which is what Playwright writes', () => {
    /*
     * Playwright deflates; this writes back uncompressed, which removes a
     * compressor from the path that handles somebody's credentials and costs
     * bytes a retention sweep removes anyway. The reader has to handle both or
     * it cannot open a real trace at all — and the first draft of this test
     * asserted a malformed archive threw, which proved nothing about inflating.
     */
    const body = Buffer.from(EVENTS.map((event) => JSON.stringify(event)).join('\n'));
    const deflatedZip = zipWithDeflatedEntry('trace.trace', body);
    const read = entriesOf(deflatedZip);
    expect(read).toHaveLength(1);
    expect(read[0]!.body.toString('utf8')).toBe(body.toString('utf8'));

    // And the whole path works over it: in deflated, out redacted.
    const { zip, redacted } = redactTrace(deflatedZip);
    expect(zip.toString('latin1')).not.toContain(PASSWORD);
    expect(redacted).toContain('a typed value');
  });

  it('leaves a line that is not an event alone rather than dropping it', () => {
    const { line } = redactTraceLine('not json at all');
    expect(line).toBe('not json at all');
  });

  it('refuses an archive it cannot read instead of writing a wrong one', () => {
    expect(() => entriesOf(Buffer.from('not a zip'))).toThrow(/not a zip/i);
  });
});

/**
 * A zip with one deflated entry, which is the shape Playwright writes.
 *
 * Built here rather than committed as a fixture: a trace fixture would carry a
 * credential-shaped string into this repository, and the scanner that stops
 * that is one of the gates this change is about.
 */
function zipWithDeflatedEntry(name: string, body: Buffer): Buffer {
  const nameBytes = Buffer.from(name, 'utf8');
  const compressed = deflateRawSync(body);
  const sum = crc32(body);

  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(sum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);

  const directory = Buffer.alloc(46 + nameBytes.length);
  directory.writeUInt32LE(0x02014b50, 0);
  directory.writeUInt16LE(20, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(8, 10);
  directory.writeUInt32LE(sum, 16);
  directory.writeUInt32LE(compressed.length, 20);
  directory.writeUInt32LE(body.length, 24);
  directory.writeUInt16LE(nameBytes.length, 28);
  directory.writeUInt32LE(0, 42);
  nameBytes.copy(directory, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(local.length + compressed.length, 16);

  return Buffer.concat([local, compressed, directory, end]);
}
