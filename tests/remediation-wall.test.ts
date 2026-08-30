/**
 * The wall around the remediation service.
 *
 * VibefyCode rates applications and, at the founder's decision, may also be paid
 * to help fix them. That carries the objection every sceptic will raise, and
 * they will be right to raise it: **a rating service that sells repairs has a
 * financial interest in finding faults.** Not an accusation — arithmetic.
 *
 * The objection cannot be answered by promising restraint, because the incentive
 * exists whether or not anybody acts on it. It is answered by making the
 * influence impossible rather than forbidden, and this file is what turns that
 * sentence into a fact:
 *
 *   1. The scoring code cannot reach this package. There is no import path.
 *   2. Whoever did the work cannot review the result. The database refuses it.
 *   3. The price never depends on what was found. The type has nowhere to put it.
 *   4. It is disclosed wherever the score is shown.
 *
 * None of this makes the conflict disappear. It makes it visible and inert,
 * which is the most any rater who also sells services can honestly claim.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { PRICING_BASIS, REMEDIATION_OFFER, mayReview } from '../packages/remediation/src/index.ts';
import { REMEDIATION_CLIENT_DISCLOSURE } from '../packages/shared/src/legal.ts';
import { connect } from './setup/client.ts';
import { makeReviewer, seedAccount, seedAssessment, type SeededAccount } from './setup/seed.ts';

let db: Client;
let customer: SeededAccount;
let worker: SeededAccount;
let independent: SeededAccount;

beforeAll(async () => {
  db = await connect();
  customer = await seedAccount(db, 'remediation-customer');
  worker = await seedAccount(db, 'remediation-worker');
  independent = await seedAccount(db, 'remediation-independent');
  await makeReviewer(db, worker.userId);
  await makeReviewer(db, independent.userId);
});

afterAll(async () => {
  await db.end();
});

function sourceFilesUnder(directory: string): string[] {
  const root = join(process.cwd(), directory);
  const walk = (at: string): string[] =>
    readdirSync(at).flatMap((entry) => {
      const path = join(at, entry);
      return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
    });
  return walk(root);
}

describe('the score cannot see the money', () => {
  it('is not imported by the scoring code, at all', () => {
    // The strongest form of this guarantee: not "does not use it" but "cannot".
    for (const file of sourceFilesUnder('packages/rubric/src')) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} imports the remediation package`).not.toContain(
        '@vibefycode/remediation',
      );
      expect(source, `${file} reaches the remediation package by path`).not.toMatch(
        /packages\/remediation/,
      );
    }
  });

  it('is not imported by the assessment engine either', () => {
    // The engine decides what is found. If it could see that an engagement
    // exists, it could — even accidentally, even by a well-meant heuristic —
    // find differently for a customer who is paying us to fix things.
    for (const file of sourceFilesUnder('packages/engine/src')) {
      expect(readFileSync(file, 'utf8'), `${file} imports remediation`).not.toContain(
        '@vibefycode/remediation',
      );
    }
  });

  it('is not declared as a dependency of either', () => {
    // An import can be added in a minute. A dependency is the door it would come
    // through, so the door stays shut as well.
    for (const pkg of ['packages/rubric', 'packages/engine']) {
      const manifest = readFileSync(join(process.cwd(), pkg, 'package.json'), 'utf8');
      expect(manifest, `${pkg} depends on remediation`).not.toContain('@vibefycode/remediation');
    }
  });
});

describe('the price cannot depend on what was found', () => {
  it('offers no per-finding basis', () => {
    // "Per finding resolved" is the obvious way to price this and the one that
    // must never exist: it pays us for every fault we report. A closed union
    // means a rate card cannot drift into it — there is nowhere to put it.
    expect([...PRICING_BASIS].sort()).toEqual(['fixed_fee', 'hourly']);
    // Named rather than pattern-matched. A first attempt banned anything
    // containing "fix", which rejects `fixed_fee` — the safe option — and would
    // have been satisfied by renaming the dangerous one. The property is that
    // the price is not a function of the findings, so the check is that no basis
    // counts anything.
    for (const basis of PRICING_BASIS) {
      expect(basis).not.toMatch(/per[_ ]|finding|issue|defect|resolved|remedied/);
    }
  });

  it('is enforced by the database as well as the type', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260826160000_remediation_engagements.sql'),
      'utf8',
    );
    expect(migration).toContain(
      "create type public.engagement_pricing as enum ('fixed_fee', 'hourly')",
    );
  });
});

describe('whoever did the work cannot review the result', () => {
  const engage = async (appId: string, workerId: string, status = 'accepted') => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.remediation_engagements
         (app_id, organisation_id, status, pricing_basis, summary)
       values ($1, $2, $3::public.engagement_status, 'fixed_fee', 'test engagement')
       returning id`,
      [appId, customer.organisationId, status],
    );
    await db.query(
      'insert into public.remediation_workers (engagement_id, user_id) values ($1, $2)',
      [rows[0]!.id, workerId],
    );
    return rows[0]!.id;
  };

  const review = (assessmentId: string, reviewerId: string) =>
    db.query(
      `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
       values ($1, $2, $3, 'approved', 'test')`,
      [assessmentId, customer.organisationId, reviewerId],
    );

  it('refuses the review in the database, not on a form', async () => {
    const seeded = await seedAssessment(db, customer);
    await engage(seeded.appId, worker.userId);

    await expect(review(seeded.assessmentId, worker.userId)).rejects.toThrow(
      /was paid to work on this application/,
    );
  });

  it('lets an independent reviewer through', async () => {
    // A wall that stops everybody is not a wall, it is a broken product.
    const seeded = await seedAssessment(db, customer);
    await engage(seeded.appId, worker.userId);

    await expect(review(seeded.assessmentId, independent.userId)).resolves.toBeDefined();
  });

  it('does not treat a declined proposal as a relationship', async () => {
    // Offering and being turned down is not being paid. Treating it as a
    // conflict would mean a customer could disqualify a reviewer by declining.
    const seeded = await seedAssessment(db, customer);
    await engage(seeded.appId, worker.userId, 'declined');

    await expect(review(seeded.assessmentId, worker.userId)).resolves.toBeDefined();
  });

  it('says the same thing in TypeScript, so the console can explain it first', () => {
    // The database is the enforcement. This is so the button is greyed out with
    // a reason rather than pressed into a constraint violation.
    const engagements = [{ appId: 'app-1', workedOnBy: ['reviewer-a'] }];
    expect(mayReview('reviewer-a', engagements, 'app-1')).toBe(false);
    expect(mayReview('reviewer-b', engagements, 'app-1')).toBe(true);
    expect(mayReview('reviewer-a', engagements, 'app-2')).toBe(true);
  });
});

describe('what the offer may and may not say', () => {
  it('promises no outcome', () => {
    // Whether a score rises is decided by the next assessment. Anyone promising
    // a number is selling one, and that is the sentence this whole wall exists
    // to keep us from writing.
    //
    // Checked against the selling half only. The word "guarantee" appears in
    // `notIncluded`, where it is being denied — a first attempt searched the
    // whole object and failed on the very sentence that makes the promise
    // impossible, which is the wrong way round.
    const selling = [
      REMEDIATION_OFFER.headline,
      REMEDIATION_OFFER.plainly,
      ...REMEDIATION_OFFER.included,
    ]
      .join(' ')
      .toLowerCase();
    for (const promise of [
      'guarantee',
      'will raise',
      'improve your score',
      'ensures',
      'certified',
    ]) {
      expect(selling, `the offer promises: ${promise}`).not.toContain(promise);
    }
  });

  it('states plainly that it buys no influence', () => {
    const notIncluded = REMEDIATION_OFFER.notIncluded.join(' ').toLowerCase();
    expect(notIncluded).toContain('cannot review your assessment');
    expect(notIncluded).toContain('the scoring code cannot see');
    expect(notIncluded).toContain('anyone promising you a number is selling you one');
  });

  it('states how to stop, in one step', () => {
    expect(REMEDIATION_OFFER.howToStop).toMatch(/stops when you stop it/);
    expect(REMEDIATION_OFFER.howToStop).toMatch(/changes nothing about your assessment/);
  });
});

describe('the relationship is disclosed', () => {
  it('has a sentence to say it with, in one place', () => {
    expect(REMEDIATION_CLIENT_DISCLOSURE).toContain('VibefyCode was paid to help fix');
    expect(REMEDIATION_CLIENT_DISCLOSURE).toContain(
      'no one who worked on the application may review it',
    );
  });

  it('can be asked of any application, by anybody rendering a score', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260826160000_remediation_engagements.sql'),
      'utf8',
    );
    expect(migration).toContain('create or replace function public.app_has_remediation');
  });
});
