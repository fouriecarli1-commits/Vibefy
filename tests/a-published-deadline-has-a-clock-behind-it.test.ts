/**
 * The two deadlines this product publishes, and the clocks behind them.
 *
 * The Privacy Policy says we "respond within 30 days" to a data-subject
 * request. The appeals policy says a decision comes "within 14 days", and the
 * console repeats it in its own words: "A reviewer who did not work on this
 * assessment answers it within fourteen days, in writing, whether it succeeds
 * or not."
 *
 * Both numbers are set by a trigger, and the migration that added them says
 * why: "Both tables already carry `due_at`. Nothing was setting it, so a
 * published deadline was a published deadline with no clock behind it." It was
 * found once and then nothing was written to keep it.
 *
 * Measured rather than assumed, and the measurement corrected the premise. The
 * `triggers` mutation class disables every trigger whose function can *raise*,
 * and these two do not raise — they write — so no class covered them. Disabling
 * both left the whole suite green. Disabling both *and* running these tests
 * also leaves them green, because the work is not being done by the triggers at
 * all: `appeals.due_at` and `data_requests.due_at` have carried
 * `default (now() + interval '14 days')` and `'30 days'` since the migration
 * that created them, and a column default is applied before a `before insert`
 * trigger ever sees the row.
 *
 * So the later migration's "Nothing was setting it, so a published deadline was
 * a published deadline with no clock behind it" was mistaken when it was
 * written. The triggers are a second belt that fires only where a caller passes
 * an explicit null, and nothing does.
 *
 * These tests therefore hold the promise rather than the mechanism. That is the
 * right level: what is published is thirty days and fourteen days, and the
 * product owes those whichever layer provides them.
 *
 * It is not a cosmetic column. `deadlineNotices` in the worker reads `due_at`
 * to say an obligation is overdue, which is the only surface an operator has
 * for a statutory clock. A null there is silence, every day, for ever.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { seedAccount, seedAssessment, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'deadline-clock');
});

afterAll(async () => {
  await db.end();
});

const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / 86_400_000);

describe('a data-subject request', () => {
  it('is given the thirty days the Privacy Policy promises', async () => {
    const { rows } = await db.query<{ created_at: Date; due_at: Date }>(
      `insert into public.data_requests (user_id, organisation_id, request_type)
       values ($1, $2, 'access') returning created_at, due_at`,
      [owner.userId, owner.organisationId],
    );
    expect(rows[0]!.due_at).not.toBeNull();
    expect(daysBetween(rows[0]!.created_at, rows[0]!.due_at)).toBe(30);
  });

  it('says thirty days where a person reads it', () => {
    // The test is worth nothing if the published number moves and this does
    // not, so the number is read from the document rather than written twice.
    expect(readFileSync('legal/privacy-policy.md', 'utf8')).toMatch(/respond within 30 days/i);
  });

  it('keeps a deadline somebody set deliberately', async () => {
    // The trigger fills a gap; it does not overrule an operator who has agreed
    // a different date with the person waiting.
    const agreed = '2027-01-31T00:00:00Z';
    const { rows } = await db.query<{ due_at: Date }>(
      `insert into public.data_requests (user_id, organisation_id, request_type, due_at)
       values ($1, $2, 'deletion', $3) returning due_at`,
      [owner.userId, owner.organisationId, agreed],
    );
    expect(rows[0]!.due_at.toISOString()).toBe(new Date(agreed).toISOString());
  });
});

describe('whichever layer sets it', () => {
  it('leaves no way to file one of these without a deadline', async () => {
    // An explicit null defeats a column default. The trigger catches that, and
    // it is the only thing the trigger is still doing.
    const { rows } = await db.query<{ due_at: Date | null }>(
      `insert into public.data_requests (user_id, organisation_id, request_type, due_at)
       values ($1, $2, 'access', null) returning due_at`,
      [owner.userId, owner.organisationId],
    );
    expect(rows[0]!.due_at).not.toBeNull();
  });
});

describe('an appeal', () => {
  it('is given the fourteen days the appeals policy promises', async () => {
    const { assessmentId } = await seedAssessment(db, owner);
    const { rows } = await db.query<{ created_at: Date; due_at: Date }>(
      `insert into public.appeals (assessment_id, organisation_id, submitted_by, grounds)
       values ($1, $2, $3, $4) returning created_at, due_at`,
      [
        assessmentId,
        owner.organisationId,
        owner.userId,
        'The finding describes a flow this application does not have, and the evidence shows a different page.',
      ],
    );
    expect(rows[0]!.due_at).not.toBeNull();
    expect(daysBetween(rows[0]!.created_at, rows[0]!.due_at)).toBe(14);
  });

  it('says fourteen days where a person reads it', () => {
    expect(readFileSync('legal/appeals-and-corrections.md', 'utf8')).toMatch(
      /Decision within 14 days/i,
    );
  });
});
