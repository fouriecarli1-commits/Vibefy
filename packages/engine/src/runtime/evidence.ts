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
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS_KEY' },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: 'JWT' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, label: 'PRIVATE_KEY' },
  { pattern: /\b\d{13,19}\b(?=[^\d]|$)/g, label: 'POSSIBLE_PAN' },
];

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
    const metadata: Record<string, unknown> = { ...input.metadata };

    if (Buffer.isBuffer(input.body)) {
      body = input.body;
      contentType = input.contentType ?? 'image/png';
    } else {
      const raw = typeof input.body === 'string' ? input.body : JSON.stringify(input.body, null, 2);
      const { text, redactions } = redact(raw);
      if (redactions.length > 0) metadata.redactions = redactions;
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
      summary: input.summary,
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
