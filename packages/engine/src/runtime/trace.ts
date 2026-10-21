import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { redactCredentials } from './credentials.ts';

/**
 * A Playwright trace with the secrets taken out of it.
 *
 * The trace is named by the published rubric as the evidence for ten criteria,
 * so it has to be kept. What it holds was measured rather than assumed, on
 * 2026-10-21, by driving a real browser through a sign-in and reading the zip:
 *
 *   · the value typed into the password field, twice — once in the `fill`
 *     call's parameters and again in the log line beside it;
 *   · every request and response header the run saw, including
 *     `authorization`, `cookie`, `set-cookie` and `x-api-key`.
 *
 * So the artefact that evidences a sign-in held the test account's password and
 * the live session token of the application being assessed, in our storage,
 * under a retention clock. `redactHeaders` has guarded the stored HTTP exchange
 * beside it since the day evidence was built; this was the hole next to it.
 *
 * The container is kept rather than replaced with an extract, because a trace
 * that no longer opens in Playwright's own viewer is a trace a reviewer cannot
 * read. Entries go back in uncompressed, which costs bytes and removes a
 * compressor from the path that handles a customer's credentials.
 */

/** The one entry that carries anything: `trace.network` is empty with snapshots off. */
const EVENTS = 'trace.trace';

/** Header values worth nothing to a reviewer and everything to whoever steals them. */
const SENSITIVE_HEADER =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|api-key)$/i;

export interface RedactedTrace {
  readonly zip: Buffer;
  /** What was taken out, by name, for the artefact's own summary. */
  readonly redacted: readonly string[];
}

interface Entry {
  readonly name: string;
  readonly body: Buffer;
}

/**
 * The entries of a zip, inflated.
 *
 * Written here rather than taken from a library because it reads three files
 * out of an archive this process made a moment ago, and a dependency that can
 * read somebody else's zip is a dependency with an attack surface. It handles
 * the two methods Playwright writes — stored and deflate — and refuses the
 * rest rather than guessing.
 */
export function entriesOf(zip: Buffer): Entry[] {
  const end = findEndOfCentralDirectory(zip);
  if (end === -1) throw new Error('This is not a zip: no end-of-central-directory record.');
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);

  const entries: Entry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt central directory.');
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);

    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = zip.subarray(start, start + compressedSize);

    if (method !== 0 && method !== 8) {
      throw new Error(`Entry ${name} uses compression method ${method}, which this does not read.`);
    }
    entries.push({ name, body: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(zip: Buffer): number {
  // It is at the end, after a comment of up to 64 KiB. Scanned backwards for
  // the signature, which is what every reader does.
  for (let at = zip.length - 22; at >= 0; at -= 1) {
    if (zip.readUInt32LE(at) === 0x06054b50) return at;
  }
  return -1;
}

/** A zip of these entries, stored rather than compressed. */
export function zipOf(entries: readonly Entry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const sum = crc32(entry.body);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(entry.body.length, 18);
    local.writeUInt32LE(entry.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, entry.body);

    const directory = Buffer.alloc(46 + name.length);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0, 10); // stored
    directory.writeUInt32LE(sum, 16);
    directory.writeUInt32LE(entry.body.length, 20);
    directory.writeUInt32LE(entry.body.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    name.copy(directory, 46);
    central.push(directory);

    offset += local.length + entry.body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * One line of the trace, with what a reviewer does not need taken out.
 *
 * Three things go, and the rest is left exactly as it was: a trace with its
 * structure altered is one the viewer will not open.
 */
export function redactTraceLine(line: string): { line: string; redacted: string[] } {
  const redacted: string[] = [];
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    // Not an event. The file is newline-delimited JSON and a line that is not
    // one is left alone rather than dropped.
    const scanned = redactCredentials(line);
    return { line: scanned.text, redacted: [...scanned.redacted] };
  }

  const params = event.params as Record<string, unknown> | undefined;
  const method = typeof event.method === 'string' ? event.method : '';

  // The value typed into a field. `fill` and `type` carry it in `value`, and
  // the password of the synthetic account is the one that matters.
  if (params && typeof params.value === 'string' && /^(fill|type|press)$/i.test(method)) {
    redacted.push('a typed value');
    params.value = '[redacted: a typed value]';
  }

  // Headers, wherever they are: a request's, a response's, and the ones a
  // route fulfilment writes.
  const scrubHeaders = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    for (const header of value) {
      const entry = header as { name?: unknown; value?: unknown };
      if (typeof entry.name === 'string' && SENSITIVE_HEADER.test(entry.name)) {
        redacted.push(`the ${entry.name.toLowerCase()} header`);
        entry.value = `[redacted: ${entry.name.toLowerCase()}]`;
      }
    }
  };
  if (params) {
    scrubHeaders(params.headers);
    const response = params.response as { headers?: unknown } | undefined;
    if (response) scrubHeaders(response.headers);
  }
  scrubHeaders((event as { headers?: unknown }).headers);

  // And the log line Playwright writes beside a call, which repeats the value.
  const rewritten = JSON.stringify(event);
  const scanned = redactCredentials(rewritten);
  if (typeof event.message === 'string' && /fill\(|type\(/.test(event.message)) {
    const quieter = JSON.parse(scanned.text) as Record<string, unknown>;
    quieter.message = String(quieter.message).replace(/\((["']).*\1\)/s, '([redacted])');
    return { line: JSON.stringify(quieter), redacted: [...redacted, 'a typed value'] };
  }
  return { line: scanned.text, redacted: [...redacted, ...scanned.redacted] };
}

/** The whole trace, read, redacted and written back as a zip. */
export function redactTrace(zip: Buffer): RedactedTrace {
  const entries = entriesOf(zip);
  const redacted: string[] = [];

  const rewritten = entries.map((entry) => {
    if (entry.name !== EVENTS) return entry;
    const lines = entry.body.toString('utf8').split('\n');
    const kept = lines.map((line) => {
      if (line.trim() === '') return line;
      const answer = redactTraceLine(line);
      redacted.push(...answer.redacted);
      return answer.line;
    });
    return { name: entry.name, body: Buffer.from(kept.join('\n'), 'utf8') };
  });

  return { zip: zipOf(rewritten), redacted: [...new Set(redacted)] };
}
