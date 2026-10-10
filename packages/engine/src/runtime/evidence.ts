/**
 * The evidence store.
 *
 * "No finding without evidence" is a rule the database enforces at publication
 * time; this is where the evidence is actually produced. Two properties matter:
 *
 *   · Every artefact is content-hashed, so a customer disputing a finding can be
 *     shown the exact bytes we relied on and can verify they were not edited.
 *   · Every artefact carries a retention deadline from the moment it is
 *     captured. Screenshots may incidentally contain personal data, so they
 *     expire soonest and nothing has to remember to set that.
 */
import { createHash, randomUUID } from 'node:crypto';

export type EvidenceKind =
  | 'screenshot'
  | 'playwright_trace'
  | 'http_exchange'
  | 'console_log'
  | 'dom_snapshot'
  | 'dependency_report'
  | 'header_scan'
  | 'lighthouse_report'
  | 'accessibility_scan';

/** Days, by kind. Screenshots are the highest incidental-data risk. */
export const RETENTION_DAYS: Readonly<Record<EvidenceKind, number>> = {
  screenshot: 30,
  playwright_trace: 30,
  dom_snapshot: 30,
  console_log: 60,
  http_exchange: 90,
  header_scan: 90,
  dependency_report: 90,
  lighthouse_report: 90,
  accessibility_scan: 90,
};

export interface EvidenceArtefact {
  readonly id: string;
  readonly assessmentId: string;
  readonly kind: EvidenceKind;
  readonly capturedAt: string;
  readonly retentionUntil: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly contentType: string;
  readonly storagePath: string;
  readonly summary: string;
  readonly body: Buffer;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface CaptureInput {
  readonly kind: EvidenceKind;
  readonly summary: string;
  readonly body: Buffer | string | Record<string, unknown>;
  readonly contentType?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Text that must never reach an evidence artefact. Redaction happens at capture,
 * not at publication: an artefact we have to remember to sanitise later is an
 * artefact that eventually gets published unsanitised.
 */
const REDACTION_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /sk-ant-[A-Za-z0-9_-]{16,}/g, label: 'ANTHROPIC_KEY' },
  { pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{12,}\b/g, label: 'STRIPE_KEY' },
  // ASIA as well as AKIA: a temporary key is valid until it expires.
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, label: 'AWS_KEY' },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: 'JWT' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, label: 'PRIVATE_KEY' },
  /*
   * The rest, brought level with the two other lists of credential shapes in
   * this repository.
   *
   * `tools/secret-scan.mjs` has thirteen and the engine's own scanner nine.
   * This had six, and every shape it was missing is one the scanner would raise
   * as a critical finding in a customer's repository — so a key we would fail
   * them for was a key we would store. The lists are kept separate on purpose
   * (the linter runs dependency-free, the scanner scores customers, this one
   * protects our own database) and held level by their tests.
   */
  {
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    label: 'GITHUB_TOKEN',
  },
  { pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g, label: 'OPENAI_KEY' },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: 'GOOGLE_KEY' },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, label: 'SLACK_TOKEN' },
  { pattern: /\bwhsec_[A-Za-z0-9]{16,}\b/g, label: 'STRIPE_WEBHOOK_SECRET' },
  {
    pattern: /postgres(?:ql)?:\/\/[^\s:@/]+:(?!password@|postgres@)[^\s:@/]{6,}@/g,
    label: 'DATABASE_URL',
  },
  // POSSIBLE_PAN last, because it is the loosest and would otherwise eat the
  // digits inside a more specific shape before that shape is tried.
  { pattern: /\b\d{13,19}\b(?=[^\d]|$)/g, label: 'POSSIBLE_PAN' },
];

/**
 * Headers whose value a finding is about, so the value has to survive capture.
 *
 * Every one of these is read by a check in `packages/engine/src/stages`, and a
 * reviewer confirming that finding reads the artefact. Tied to the checks by
 * `tests/the-header-a-finding-was-about.test.ts`, which reads the stage
 * sources: a check that starts reading a new header fails until it is named
 * here, and a name here that no check reads fails too.
 */
export const HEADERS_FINDINGS_READ: readonly string[] = [
  'access-control-allow-credentials',
  // Read by the exposed-path check, to tell a file from the application's own
  // page: none of those paths is ever legitimately HTML. Diagnostic, never a
  // credential, and the reason a reviewer can see which of the two it was.
  'content-type',
  'access-control-allow-origin',
  'content-security-policy',
  'referrer-policy',
  'server',
  'set-cookie',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'x-powered-by',
];

/**
 * Headers whose value is a credential and nothing else.
 *
 * Taken out whole: unlike a cookie, no finding is about any part of these.
 *
 * Five literal names before, which is a list of what to strip — so a custom
 * header carrying an opaque token was stored unless somebody had thought of
 * its name. `REDACTION_PATTERNS` covers a value shaped like a known
 * credential, and an opaque random string is shaped like nothing.
 *
 * The rule is the other way round now: a header whose *name* says it carries a
 * credential has its value taken out, unless a finding is about that value.
 *
 * The keep-list is what makes that safe to do, and it is not hypothetical:
 * `access-control-allow-credentials` contains the word, and its value is
 * exactly what the CORS check reports on. The check itself reads the live
 * response rather than the artefact, as `redactHeaders` explains below, so a
 * name rule alone would not have changed any verdict — it would have removed
 * the line a reviewer confirms that verdict by, from the artefact whose whole
 * purpose is to carry it. A finding nobody can check is one we may not
 * publish.
 */
const SENSITIVE_NAME = /auth|token|secret|credential|session|password|\bkey\b|api[-_]?key/i;

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'api-key',
]);

export function isSensitiveHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  if (HEADERS_FINDINGS_READ.includes(lower)) return false;
  return SENSITIVE_HEADERS.has(lower) || SENSITIVE_NAME.test(lower);
}

/**
 * A cookie header with the values out and the names and attributes left in.
 *
 * SEC-11's finding is about a cookie's *attributes*, which are named in the
 * cookie specification and are not claims about anything:
 * vibefycode-copy-lint-allow: the cookie attribute names below are a
 * specification's vocabulary, not a statement about an application
 * `HttpOnly`, `Secure`, `SameSite`. A reviewer confirming that finding reads
 * the artefact, so this is
 * deliberately not a blanket removal: the name and every attribute stay, and
 * only the value goes, which is the one part no finding is about and the only
 * part that is a live credential.
 *
 * undici joins several `set-cookie` headers with `, `, so the split looks for a
 * comma followed by something that looks like the start of a new cookie rather
 * than for every comma — a cookie's `Expires` attribute contains one.
 */
function redactCookieHeader(value: string): string {
  return value
    .split(/,\s*(?=[A-Za-z0-9!#$%&'*+\-.^_`|~]+=)/)
    .map((cookie) => {
      const equals = cookie.indexOf('=');
      if (equals < 0) return cookie;
      const semicolon = cookie.indexOf(';');
      const name = cookie.slice(0, equals);
      const secret = semicolon < 0 ? cookie.slice(equals + 1) : cookie.slice(equals + 1, semicolon);
      const attributes = semicolon < 0 ? '' : cookie.slice(semicolon);
      return `${name}=[REDACTED:COOKIE:${secret.length}chars]${attributes}`;
    })
    .join(', ');
}

/**
 * A header map with nothing in it we have no right to keep.
 *
 * Every response header used to reach the evidence store as it arrived,
 * `set-cookie` included, and none of the patterns above matches a session
 * cookie. So a customer's application that set one on any page we fetched had
 * that value written into our `evidence` table in plaintext, with ninety days
 * on the `http_exchange` kind. PART 6.2 says not to store a customer's real
 * credentials, and an exposed session cookie is a finding we would raise
 * against them.
 *
 * The raw map is still what the header checks read — they take it from the
 * `ScopedResponse`, not from the artefact — so this is applied at the capture
 * call and changes nothing a finding is drawn from.
 */
export function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const storable: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (key === 'set-cookie' || key === 'cookie') storable[name] = redactCookieHeader(value);
    else if (isSensitiveHeaderName(key)) {
      storable[name] = `[REDACTED:${key.toUpperCase().replace(/-/g, '_')}:${value.length}chars]`;
    } else storable[name] = value;
  }
  return storable;
}

/**
 * The same, through every string in a value, leaving everything else alone.
 *
 * For `summary` and `metadata`, which used to go into the artefact untouched
 * while the body beside them was redacted — so a token in a query string was
 * taken out of one field of a row and left in plain sight in the other two.
 * The summary is the field the report actually shows a reader.
 *
 * Strings only, deliberately. `POSSIBLE_PAN` matches any run of 13 to 19
 * digits, which is a millisecond timestamp as readily as a card number; a
 * number that stays a number cannot be mangled by it, and there is no
 * credential that arrives as a JavaScript number.
 */
function redactDeep(value: unknown, into: string[]): unknown {
  if (typeof value === 'string') {
    const { text, redactions } = redact(value);
    into.push(...redactions);
    return text;
  }
  if (Array.isArray(value)) return value.map((entry) => redactDeep(entry, into));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        redactDeep(entry, into),
      ]),
    );
  }
  return value;
}

export function redact(text: string): { text: string; redactions: string[] } {
  const redactions: string[] = [];
  let output = text;
  for (const { pattern, label } of REDACTION_PATTERNS) {
    output = output.replace(pattern, (match) => {
      redactions.push(label);
      return `[REDACTED:${label}:${match.length}chars]`;
    });
  }
  return { text: output, redactions };
}

export class EvidenceStore {
  private readonly artefacts: EvidenceArtefact[] = [];

  constructor(
    private readonly assessmentId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get all(): readonly EvidenceArtefact[] {
    return this.artefacts;
  }

  get totalBytes(): number {
    return this.artefacts.reduce((total, artefact) => total + artefact.byteSize, 0);
  }

  byId(id: string): EvidenceArtefact | undefined {
    return this.artefacts.find((artefact) => artefact.id === id);
  }

  capture(input: CaptureInput): EvidenceArtefact {
    const capturedAt = this.now();
    const retention = new Date(capturedAt);
    retention.setUTCDate(retention.getUTCDate() + RETENTION_DAYS[input.kind]);

    let body: Buffer;
    let contentType = input.contentType ?? 'application/octet-stream';

    // Before the body, because these two used to be the way round the rule.
    // A screenshot's metadata carries the page URL and an HTTP artefact's
    // summary carries the request URL, and a URL is where a reset token or an
    // API key in a query string lives.
    const summaryRedaction = redact(input.summary);
    const summary = summaryRedaction.text;
    const summaryRedactions = [...summaryRedaction.redactions];
    const metadata = redactDeep({ ...input.metadata }, summaryRedactions) as Record<
      string,
      unknown
    >;
    if (summaryRedactions.length > 0) metadata.redactions = summaryRedactions;

    if (Buffer.isBuffer(input.body)) {
      /*
       * Bytes we cannot read, and the artefact now says so.
       *
       * Everything in this file exists to keep a credential out of storage:
       * `redactHeaders` takes out a header whose name says it carries one,
       * `redact` takes out anything shaped like one in a body, and
       * `redactDeep` does the summary and the metadata because a URL is where
       * a token in a query string lives. None of it applies to a buffer, and
       * until 2026-10-10 that was simply not mentioned — the artefact carried
       * no `redactions` key, exactly as an artefact we had read and found
       * nothing in. One field, two causes: nothing to take out, and nothing
       * attempted. The summary and the metadata are read on every path,
       * including this one; it is the body that nothing reads.
       *
       * Two kinds arrive this way. A screenshot is a PNG and no text rule
       * could read it. A Playwright trace is a zip, and it is the one that
       * matters: measured on 2026-10-10 against a local page, a trace
       * captured with `screenshots: false, snapshots: false` contains every
       * action's parameters verbatim — the value typed into a password field,
       * the address typed into an email field, and the full URL of every
       * navigation, including a token in its query string. It does not
       * contain response bodies or headers.
       *
       * So the provisioned synthetic password is in storage for thirty days,
       * in a file nothing can clean, in the same repository whose
       * `tests/the-password-we-were-never-given.test.ts` holds that a refusal
       * must never quote the value it refused. `docs/OPEN_ITEMS.md` carries
       * the choice: stop capturing traces and change what the rubric names as
       * evidence for ten criteria, rewrite the zip before storing it, or keep
       * it and shorten its reach.
       */
      body = input.body;
      contentType = input.contentType ?? 'image/png';
      metadata.bodyRedaction = 'not_readable';
    } else {
      const raw = typeof input.body === 'string' ? input.body : JSON.stringify(input.body, null, 2);
      const { text, redactions } = redact(raw);
      if (redactions.length > 0) {
        metadata.redactions = [...summaryRedactions, ...redactions];
      }
      // Said either way. "We read this and took nothing out" and "we never
      // read it" were the same silence, and the second one is the sentence
      // somebody disputing a finding needs.
      metadata.bodyRedaction = redactions.length > 0 ? 'applied' : 'read_nothing_found';
      body = Buffer.from(text, 'utf8');
      contentType =
        input.contentType ?? (typeof input.body === 'string' ? 'text/plain' : 'application/json');
    }

    const id = randomUUID();
    const artefact: EvidenceArtefact = {
      id,
      assessmentId: this.assessmentId,
      kind: input.kind,
      capturedAt: capturedAt.toISOString(),
      retentionUntil: retention.toISOString(),
      sha256: createHash('sha256').update(body).digest('hex'),
      byteSize: body.byteLength,
      contentType,
      storagePath: `assessments/${this.assessmentId}/evidence/${id}`,
      summary,
      body,
      metadata,
    };
    this.artefacts.push(artefact);
    return artefact;
  }

  /** Rows for the `evidence` table. Bodies go to object storage separately. */
  toRows(): readonly Omit<EvidenceArtefact, 'body'>[] {
    return this.artefacts.map(({ body: _body, ...rest }) => rest);
  }
}
