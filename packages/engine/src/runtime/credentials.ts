/**
 * What a leaked credential looks like, and how to store a line that has one.
 *
 * These patterns lived in `stages/static-intake.ts`, beside the scan that
 * reports them, and the runtime had no access to them — which is how an
 * artefact came to hold the thing a finding is about. `redactHeaders` takes a
 * token out of a stored request header with a careful rule and a paragraph
 * explaining it; the response *body* beside it was stored raw, and in an
 * application built by an assistant the body is where a key usually is. The
 * console log is the same: an application that prints its own token prints it
 * into our evidence store.
 *
 * So the detector moves to the runtime, where both the stage that reports a
 * credential and the capture that would otherwise keep one can reach it.
 */
import type { RawFinding } from '../stages/types.ts';

export type CredentialSeverity = RawFinding['severity'];

/**
 * Whether a JSON Web Token's payload claims the `service_role`.
 *
 * Supabase publishes two keys in this shape from the same project. The anon key
 * is designed to sit in the browser and is protected by row-level security; the
 * service-role key bypasses it entirely. Only the `role` claim tells them
 * apart, and a JWT payload is base64url rather than encrypted, so reading it
 * needs no secret and proves nothing about the signature.
 *
 * Returns false for anything that will not decode. A token we cannot read is
 * not a token we can accuse somebody over.
 */
function isServiceRoleToken(token: string): boolean {
  const payload = token.split('.')[1];
  if (payload === undefined) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: unknown;
    };
    return claims.role === 'service_role';
  } catch {
    return false;
  }
}

/**
 * Credential shapes specific enough that a match is a live key rather than a
 * false alarm.
 *
 * The comment here used to claim this was "the same list the scanner over our
 * own repository uses". It was not: `tools/secret-scan.mjs` had thirteen
 * patterns and this had nine, and the four it was missing were a JSON Web
 * Token, an OpenAI key, a Stripe webhook signing secret, and AWS temporary
 * credentials, whose key id begins ASIA rather than AKIA.
 *
 * The first mattered most, because of who the customers are: a vibe-coded
 * application is very often Next.js on Supabase, and a Supabase service-role
 * key bypasses every row-level policy the database has. It is the worst single
 * credential in that stack and this scan could not see it.
 *
 * `confirm` is why it can see it now without wrecking every honest Supabase
 * application. A project publishes two keys in the same JWT shape, and the anon
 * one belongs in the browser — flagging the shape alone would have capped every
 * correct Supabase app at 39 through GATE-EXPOSED-SECRET. A JWT payload is
 * base64url rather than encrypted, so the `role` claim reads without any
 * secret, and only `service_role` is reported. A token that will not decode is
 * left alone: a guess here costs a stranger their badge.
 *
 * One pattern is deliberately not carried across. "A long opaque value assigned
 * to a secret-looking name" earns its place in our own repository, where it
 * runs beside a placeholder filter and a reviewed `secret-scan-allow`
 * suppression. A customer's repository has neither, and without them any
 * 24-character constant becomes a capped score.
 */
const CREDENTIAL_PATTERNS: readonly {
  pattern: RegExp;
  label: string;
  severity: CredentialSeverity;
  /** A second question asked of the matched text, where the shape is not enough. */
  confirm?: (match: string) => boolean;
}[] = [
  { pattern: /sk-ant-[A-Za-z0-9_-]{16,}/, label: 'an Anthropic API key', severity: 'critical' },
  {
    pattern: /\b[rs]k_live_[A-Za-z0-9]{12,}\b/,
    label: 'a Stripe live secret key',
    severity: 'critical',
  },
  {
    pattern: /\b[rs]k_test_[A-Za-z0-9]{12,}\b/,
    label: 'a Stripe test secret key',
    severity: 'medium',
  },
  {
    // ASIA is a temporary key id. Short-lived is not the same as harmless: it
    // is valid until it expires, and our own scanner has looked for it all along.
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    label: 'an AWS access key id',
    severity: 'critical',
  },
  {
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/,
    label: 'an OpenAI API key',
    severity: 'critical',
  },
  {
    pattern: /\bwhsec_[A-Za-z0-9]{16,}\b/,
    label: 'a Stripe webhook signing secret',
    severity: 'high',
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    label: 'a Supabase service-role key, which bypasses every row-level policy',
    severity: 'critical',
    confirm: isServiceRoleToken,
  },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, label: 'a Google API key', severity: 'high' },
  {
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/,
    label: 'a GitHub token',
    severity: 'critical',
  },
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/,
    label: 'a private key',
    severity: 'critical',
  },
  {
    pattern: /postgres(?:ql)?:\/\/[^\s:@/]+:(?!password@|postgres@)[^\s:@/]{6,}@/,
    label: 'a database connection string with a password',
    severity: 'critical',
  },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, label: 'a Slack token', severity: 'high' },
];

/**
 * Every credential shape on one line, as the stage reports them.
 *
 * Exported so a test can ask what this scan can see without driving a whole
 * assessment over a fixture repository. The reason that matters is in the note
 * on `CREDENTIAL_PATTERNS` above: this list and `tools/secret-scan.mjs` are two
 * readers of one rule — what a leaked credential looks like — and they had
 * already drifted once, nine patterns against thirteen, with a comment claiming
 * they were the same list. `tests/one-idea-of-a-leaked-credential.test.ts` now
 * holds them equal by what each can detect rather than by how each is written,
 * because the regexes differ in their lengths on purpose and always will.
 *
 * The shape is the first question and `confirm` is the second, for a shape
 * shared by a credential and a value meant to be public: a Supabase project
 * publishes its anon key in the same JWT shape as its service-role key, and
 * flagging the shape alone would cap every correct Supabase application at 39.
 */
export function credentialsOnLine(line: string): { label: string; severity: CredentialSeverity }[] {
  const found: { label: string; severity: CredentialSeverity }[] = [];
  for (const { pattern, label, severity, confirm } of CREDENTIAL_PATTERNS) {
    const match = pattern.exec(line);
    if (match !== null && (confirm === undefined || confirm(match[0]))) {
      found.push({ label, severity });
    }
  }
  return found;
}

/**
 * The same text with every credential-shaped string replaced by its name.
 *
 * Length is not preserved and position is. A reviewer confirming a finding
 * needs to see that a key was on that line and what kind it was — which is what
 * the label says — and needs nothing of the value itself. The replacement is
 * visible on purpose: a silently shortened body reads as a page that did not
 * contain one.
 *
 * Every pattern is applied globally, which the detector above deliberately does
 * not do: it answers "is there one on this line" and stops at the first match
 * per shape, and a body with eight copies of the same key must lose all eight.
 */
export function redactCredentials(text: string): {
  readonly text: string;
  readonly redacted: readonly string[];
} {
  const redacted: string[] = [];
  let out = text;
  for (const { pattern, label, confirm } of CREDENTIAL_PATTERNS) {
    const everywhere = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
    );
    out = out.replace(everywhere, (match) => {
      if (confirm !== undefined && !confirm(match)) return match;
      redacted.push(label);
      return `[redacted: ${label}]`;
    });
  }
  return { text: out, redacted };
}
