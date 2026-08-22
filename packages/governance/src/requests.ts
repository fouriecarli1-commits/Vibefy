/**
 * Data-subject rights, as a state machine rather than an inbox.
 *
 * PART 8.2 asks for working in-product flows, not an email address. The
 * difference that makes in practice is a clock: a request submitted in product
 * has a due date the moment it exists, and a queue that can be shown to be
 * empty. A request sent to an address has neither.
 *
 * Thirty days is the GDPR baseline the brief asks us to write to. It is stated
 * here once and enforced by a database trigger, so a request cannot be created
 * without a deadline.
 */

export type RequestType = 'access' | 'correction' | 'deletion' | 'portability' | 'objection';
export type RequestStatus = 'received' | 'verifying' | 'in_progress' | 'completed' | 'refused';

export const RESPONSE_DAYS = 30;
export const APPEAL_RESPONSE_DAYS = 14;

export interface RequestKindCopy {
  readonly type: RequestType;
  readonly label: string;
  /** What the person actually gets, in the words we will be held to. */
  readonly promise: string;
}

export const REQUEST_KINDS: readonly RequestKindCopy[] = [
  {
    type: 'access',
    label: 'A copy of what you hold about me',
    promise:
      'Your account record, your workspace memberships, every consent you have given with the version and hash of what you agreed to, and the applications you submitted. Assessment results belong to the workspace, and are exported from the audit export instead.',
  },
  {
    type: 'correction',
    label: 'Correct something that is wrong',
    promise:
      'We correct the record and tell you what changed. Where the record is append-only — a consent, an authorisation, an assessment — we cannot edit history, so we add a correction alongside it and both remain visible.',
  },
  {
    type: 'deletion',
    label: 'Delete my personal data',
    promise:
      'Your account and profile are deleted. Records we are required to keep — invoices, consents, authorisation warranties, the audit log — are retained under the retention schedule with your identifiers removed where they are not the point of the record. We tell you exactly what was kept and why.',
  },
  {
    type: 'portability',
    label: 'Give me my data in a portable format',
    promise: 'The same content as an access request, as machine-readable JSON.',
  },
  {
    type: 'objection',
    label: 'Object to how you process my data',
    promise:
      'We stop the processing you object to unless we can show a lawful basis that overrides your objection, and we tell you which it is rather than asserting that one exists.',
  },
];

export function kindCopy(type: RequestType): RequestKindCopy {
  const copy = REQUEST_KINDS.find((entry) => entry.type === type);
  if (!copy) throw new Error(`Unknown request type "${type}".`);
  return copy;
}

export function dueDateFor(createdAt: Date, days = RESPONSE_DAYS): Date {
  const due = new Date(createdAt);
  due.setUTCDate(due.getUTCDate() + days);
  return due;
}

export function isOverdue(dueAt: Date, status: RequestStatus, now: Date = new Date()): boolean {
  if (status === 'completed' || status === 'refused') return false;
  return dueAt.getTime() < now.getTime();
}

export function daysRemaining(dueAt: Date, now: Date = new Date()): number {
  return Math.ceil((dueAt.getTime() - now.getTime()) / 86_400_000);
}

const TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  received: ['verifying', 'in_progress', 'refused'],
  verifying: ['in_progress', 'refused'],
  in_progress: ['completed', 'refused'],
  // Terminal. A completed request that can be reopened is a deadline that can be
  // restarted, which is the same as no deadline.
  completed: [],
  refused: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * A refusal must name its lawful basis.
 *
 * The database enforces this too, with a check constraint. Both, because
 * "request refused" with no stated ground is exactly the behaviour the right
 * exists to prevent.
 */
export function refusalIsAnswerable(basis: string | null | undefined): boolean {
  return typeof basis === 'string' && basis.trim().length >= 20;
}
