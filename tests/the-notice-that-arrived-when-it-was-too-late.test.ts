/**
 * The deadline said before it is missed, and not only after.
 *
 * `sweepGovernanceDeadlines` opens with "Notices a deadline we published and
 * are about to miss", and what it noticed was a deadline already behind us:
 * every line it wrote was keyed off `due_at < now`. For the person this log is
 * written for — one founder, reading it when something else prompted them to —
 * that notice arrives at the only moment it cannot help.
 *
 * It matters most for the two things it watches. A data-subject request has a
 * statutory clock. An appeal exists because an AI-assisted finding can be
 * wrong, and it arrives in silence: `submitAppeal` writes the row and shows a
 * sentence on the screen of the person who filed it. Nothing is emailed, no
 * queue is paged, and the first line the log ever wrote about that appeal said
 * the fourteen days were up.
 *
 * So one line a day per kind for what is open, carrying the soonest deadline
 * still standing and how many days are left on it. No threshold: the count and
 * the date are the warning. The per-row overdue lines are unchanged, and the
 * counts in the result are still every pass, because a count is not a sentence
 * somebody has to re-read.
 *
 * Two things this does not fix, and they are recorded rather than quietly
 * implied: nothing acknowledges an appeal to the customer in writing, which
 * `legal/appeals-and-corrections.md` promises within two business days; and
 * nothing in the shipped tree can withdraw a finding, which is the outcome the
 * same policy is for. Both are in `docs/OPEN_ITEMS.md`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { resetDeadlineNotices, sweepGovernanceDeadlines } from '../apps/worker/src/governance.ts';
import { connect } from './setup/client.ts';
import { seedAccount, seedAssessment, type SeededAccount } from './setup/seed.ts';

const DAY = 24 * 60 * 60 * 1000;
/** Fixed at both ends: the fixture's deadline and the clock the sweep is given. */
const DUE_AT = '2026-10-20T00:00:00.000Z';
const BEFORE = new Date('2026-10-15T12:00:00.000Z');
const AFTER = new Date('2026-10-22T12:00:00.000Z');

interface Said {
  readonly message: string;
  readonly detail: Record<string, unknown>;
}

let db: Client;
let pool: Pool;
let account: SeededAccount;
let appealId: string;

const sweep = async (now: Date) => {
  const said: Said[] = [];
  const result = await sweepGovernanceDeadlines(
    pool,
    (message, detail) => said.push({ message, detail: detail ?? {} }),
    now,
  );
  return { said, result };
};

const waitingLine = (said: Said[]) =>
  said.find((entry) => /appeals waiting for a person/.test(entry.message));

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  account = await seedAccount(db, 'deadline-warning');
  const seeded = await seedAssessment(db, account);

  const { rows } = await db.query<{ id: string }>(
    `insert into public.appeals
       (assessment_id, organisation_id, submitted_by, grounds, due_at)
     values ($1, $2, $3, $4, timestamptz '${DUE_AT}')
     returning id`,
    [
      seeded.assessmentId,
      account.organisationId,
      account.userId,
      'SEC-02 was already remediated before the assessment ran, and the evidence shows the old header.',
    ],
  );
  appealId = rows[0]!.id;

  /*
   * And one that is already past its deadline, which is what makes the date in
   * the line meaningful.
   *
   * "The soonest deadline" has to mean the soonest one still standing. With a
   * missed deadline in the table, a plain minimum answers with a date in the
   * past — and a line that tells an operator they have minus six days is a line
   * about the thing the overdue lines already said, in place of the one piece
   * of information this addition exists to give.
   */
  await db.query(
    `insert into public.appeals
       (assessment_id, organisation_id, submitted_by, grounds, due_at)
     values ($1, $2, $3, $4, timestamptz '2026-09-01T00:00:00Z')`,
    [
      seeded.assessmentId,
      account.organisationId,
      account.userId,
      'The overall score was capped by a gate that does not apply to a desktop-only application.',
    ],
  );
});

afterAll(async () => {
  resetDeadlineNotices();
  await pool?.end();
  await db?.end();
});

describe('an appeal still inside its fourteen days', () => {
  it('is said, with how long is left', async () => {
    resetDeadlineNotices();
    const { said, result } = await sweep(BEFORE);

    const line = waitingLine(said);
    expect(line, 'an open appeal is what this sweep exists to surface').toBeDefined();
    expect(Number(line!.detail.open)).toBeGreaterThanOrEqual(1);
    expect(line!.detail.nextDueAt).toBeDefined();
    expect(Number(line!.detail.daysLeft)).toBeGreaterThanOrEqual(0);

    // The soonest deadline still standing, which is this one or an earlier one
    // another fixture left behind — never a date that has already passed.
    expect(result.nextAppealDueAt).not.toBeNull();
    expect(result.nextAppealDueAt!.getTime()).toBeGreaterThanOrEqual(BEFORE.getTime());
    expect(result.openAppeals).toBeGreaterThanOrEqual(2);
  });

  it('is not called overdue, because it is not', async () => {
    resetDeadlineNotices();
    const { said } = await sweep(BEFORE);
    expect(said.filter((entry) => entry.detail.appealId === appealId)).toEqual([]);
  });

  it('is said once a day, not on every pass', async () => {
    // The control that this line is not unconditional: the same defect the
    // overdue lines were fixed for, one line further down the same function.
    resetDeadlineNotices();
    await sweep(BEFORE);
    const again = await sweep(new Date(BEFORE.getTime() + 5 * 60_000));
    expect(waitingLine(again.said)).toBeUndefined();

    const tomorrow = await sweep(new Date(BEFORE.getTime() + DAY));
    expect(waitingLine(tomorrow.said)).toBeDefined();
  });
});

describe('the same appeal once the fourteen days are up', () => {
  it('is named by its own id, as it always was', async () => {
    resetDeadlineNotices();
    const { said, result } = await sweep(AFTER);

    expect(said.find((entry) => entry.detail.appealId === appealId)).toBeDefined();
    expect(result.overdueAppeals).toBeGreaterThanOrEqual(1);
  });

  it('is counted as overdue in the line about the queue', async () => {
    resetDeadlineNotices();
    const { said } = await sweep(AFTER);
    const line = waitingLine(said);
    expect(line).toBeDefined();
    expect(Number(line!.detail.overdue)).toBeGreaterThanOrEqual(1);
  });
});
