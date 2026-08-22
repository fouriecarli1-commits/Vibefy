/**
 * The deletion the deadline was always for.
 *
 * Every evidence artefact has carried a `retention_until` since M1, and until
 * now nothing acted on one. A retention policy that stamps a date and never
 * deletes is worse than no policy: it is a written promise, made to every
 * customer who read the privacy notice, that we were not keeping something we
 * were in fact keeping.
 *
 * The schedule is data, per data class, and short where the data is riskiest.
 * Screenshots are the sharpest case — PART 8.2 names them, because a screenshot
 * of a working application can incidentally capture a real person.
 */

export type DataClass = 'evidence' | 'assessment_run_log' | 'alert' | 'cost_record';

export interface RetentionRule {
  readonly dataClass: DataClass;
  readonly days: number;
  /** Written for the privacy notice, not for us. */
  readonly rationale: string;
}

export const RETENTION_SCHEDULE: readonly RetentionRule[] = [
  {
    dataClass: 'evidence',
    days: 90,
    rationale:
      'Evidence supports a finding for as long as the finding is contestable. Screenshots are held for 30 days rather than 90, because one can incidentally capture a real person.',
  },
  {
    dataClass: 'assessment_run_log',
    days: 180,
    rationale:
      'Stage logs explain how an assessment reached its result, which an appeal may need. They contain no personal data.',
  },
  {
    dataClass: 'alert',
    days: 365,
    rationale:
      'An alert is a record of what we told a customer and when. Kept a year so a dispute about notice can be settled.',
  },
  {
    dataClass: 'cost_record',
    days: 2555,
    rationale:
      'Cost records are financial records with a statutory retention period. They identify an assessment, never a person.',
  },
];

export function ruleFor(dataClass: DataClass): RetentionRule {
  const rule = RETENTION_SCHEDULE.find((entry) => entry.dataClass === dataClass);
  if (!rule) throw new Error(`No retention rule for data class "${dataClass}".`);
  return rule;
}

export interface RetainedRecord {
  readonly id: string;
  readonly dataClass: DataClass;
  readonly retentionUntil: Date;
  readonly sha256?: string | null;
  readonly organisationId?: string | null;
}

/**
 * What is past its deadline.
 *
 * Strictly past, not on: deleting at the instant of expiry would make the
 * boundary depend on clock skew between two machines.
 */
export function dueForDeletion(
  records: readonly RetainedRecord[],
  now: Date = new Date(),
): RetainedRecord[] {
  return records.filter((record) => record.retentionUntil.getTime() < now.getTime());
}

/**
 * A deletion that leaves a record of itself.
 *
 * The hash is kept and the artefact is not. That is enough to show an artefact
 * existed and was removed on schedule, without keeping the thing the schedule
 * existed to remove.
 */
export interface DeletionRecord {
  readonly dataClass: DataClass;
  readonly entityId: string;
  readonly organisationId: string | null;
  readonly sha256: string | null;
  readonly retentionUntil: Date;
}

export function deletionRecordFor(record: RetainedRecord): DeletionRecord {
  return {
    dataClass: record.dataClass,
    entityId: record.id,
    organisationId: record.organisationId ?? null,
    sha256: record.sha256 ?? null,
    retentionUntil: record.retentionUntil,
  };
}
