/**
 * "Is 71 good?"
 *
 * The first question everybody asks about a score, and the one nothing in a
 * report answered. A number on a scale nobody has an instinct for yet is not
 * information, and the honest way to give it some is to say how many assessed
 * applications of the same kind scored lower.
 *
 * Two ways it goes wrong, and both are refusals here rather than warnings.
 *
 * A percentile from a small sample is a number that looks like knowledge and is
 * not. With nineteen peers, one of them being re-assessed moves the figure by
 * more than five points, and a figure that swings that far on a stranger should
 * not be printed beside a score somebody paid for.
 *
 * And it must never name another application. "Better than Kettle" is a claim
 * about Kettle, which Kettle did not agree to and is not ours to make. What
 * comes out of the database for this is a bare array of numbers, by
 * construction rather than by discipline.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  MIN_PEERS_FOR_A_PERCENTILE,
  compareToPeers,
  renderReport,
  type ReportSource,
} from '../packages/report/src/index.ts';
import { actingAs, connect } from './setup/client.ts';
import {
  makeReviewer,
  seedAccount,
  seedApp,
  seedAuthorisation,
  seedRubric,
  type SeededAccount,
} from './setup/seed.ts';

const enough = (count: number, score = 50) => Array.from({ length: count }, () => score);

describe('when it will not answer', () => {
  it('says nothing about an application with no category', () => {
    const answer = compareToPeers({ score: 71, category: null, peerScores: enough(100) });
    expect(answer.kind).toBe('no_category');
  });

  it('refuses a percentile from too small a sample', () => {
    const answer = compareToPeers({
      score: 71,
      category: 'Productivity',
      peerScores: enough(MIN_PEERS_FOR_A_PERCENTILE - 1),
    });
    expect(answer.kind).toBe('too_few');
    if (answer.kind !== 'too_few') return;
    expect(answer.have).toBe(MIN_PEERS_FOR_A_PERCENTILE - 1);
    expect(answer.explanation).toMatch(/more than five points/);
  });

  it('answers the moment there are enough', () => {
    const answer = compareToPeers({
      score: 71,
      category: 'Productivity',
      peerScores: enough(MIN_PEERS_FOR_A_PERCENTILE),
    });
    expect(answer.kind).toBe('percentile');
  });

  it('explains the refusal rather than leaving a gap', () => {
    // A section that silently disappears reads as a comparison we chose not to
    // print, which is the impression this whole thing cannot afford.
    for (const answer of [
      compareToPeers({ score: 71, category: null, peerScores: [] }),
      compareToPeers({ score: 71, category: 'Games', peerScores: enough(3) }),
    ]) {
      if (answer.kind === 'percentile') throw new Error('expected a refusal');
      expect(answer.explanation.length).toBeGreaterThan(60);
    }
  });
});

describe('the arithmetic', () => {
  const peers = Array.from({ length: 100 }, (_unused, index) => index); // 0…99

  it('counts the applications scoring lower', () => {
    const answer = compareToPeers({ score: 62.5, category: 'Games', peerScores: peers });
    expect(answer.kind === 'percentile' && answer.percentile).toBe(63);
  });

  it('rounds down, because this is a number about oneself', () => {
    // Twenty of thirty is 66.66, printed as 66 and never as 67. A report is a
    // document somebody shows to other people, and the direction to be wrong in
    // is the modest one.
    const answer = compareToPeers({
      score: 50,
      category: 'Games',
      peerScores: [...enough(20, 10), ...enough(10, 90)],
    });
    expect(answer.kind === 'percentile' && answer.percentile).toBe(66);
  });

  it('does not count a tie as being above it', () => {
    const answer = compareToPeers({
      score: 50,
      category: 'Games',
      peerScores: enough(MIN_PEERS_FOR_A_PERCENTILE, 50),
    });
    expect(answer.kind === 'percentile' && answer.percentile).toBe(0);
  });

  it('can say a hundred, and means it', () => {
    const answer = compareToPeers({
      score: 100,
      category: 'Games',
      peerScores: enough(MIN_PEERS_FOR_A_PERCENTILE, 1),
    });
    expect(answer.kind === 'percentile' && answer.percentile).toBe(100);
  });
});

describe('what it is allowed to say', () => {
  const answer = compareToPeers({
    score: 71,
    category: 'Productivity',
    peerScores: enough(40, 60),
  });

  it('names no other application', () => {
    // There is nowhere in the shape for one, which is the point: this cannot be
    // made to name anybody by a later change to the copy.
    expect(JSON.stringify(answer)).not.toMatch(/\bKettle\b/);
    expect(Object.keys(answer).sort()).toEqual(
      ['category', 'kind', 'limits', 'percentile', 'sampleSize', 'sentence'].sort(),
    );
  });

  it('says how many it is comparing against', () => {
    // A percentile without a sample size is a number asking to be believed.
    expect(answer.kind === 'percentile' && answer.sentence).toContain('40');
  });

  it('says what population it is describing', () => {
    expect(answer.kind === 'percentile' && answer.limits).toMatch(
      /applications VibefyCode has assessed/,
    );
    expect(answer.kind === 'percentile' && answer.limits).toMatch(
      /says nothing about applications nobody has asked us to look at/,
    );
  });
});

describe('in the report', () => {
  const base: ReportSource = {
    assessmentId: 'a1',
    appName: 'Kettle',
    appUrl: null,
    organisationName: 'Kettle Ltd',
    rubricVersion: '1.1.0',
    assessedOn: '2026-09-19',
    reviewedOn: null,
    overallScore: 71,
    band: 'Adequate',
    certificationEligible: true,
    certificationBlockers: [],
    dimensions: [],
    findings: [],
    narrative: null,
    stages: [],
    scopeStatement: 'Scope.',
    promptBundleSha256: 'a'.repeat(64),
    intendedForAppStore: false,
  };

  it('is shown at both tiers, like the score itself', () => {
    /*
     * The redaction rule in this codebase is that the score is never withheld —
     * hiding it would look, correctly, like hiding how the rubric works — and
     * what payment buys is detail. A percentile is the score in context rather
     * than detail, and every score it is computed from is already public in the
     * directory. Withholding a number the customer could work out from our own
     * public pages would be petty and would look like something worse.
     */
    const comparison = compareToPeers({
      score: 71,
      category: 'Productivity',
      peerScores: enough(40, 60),
    });
    for (const tier of ['free', 'paid'] as const) {
      const { html } = renderReport({ ...base, comparison }, tier);
      expect(html, tier).toContain('Where this stands');
      expect(html, tier).toContain('higher than 100%');
    }
  });

  it('prints the refusal too, rather than dropping the section', () => {
    const { html } = renderReport(
      { ...base, comparison: compareToPeers({ score: 71, category: 'Games', peerScores: [1, 2] }) },
      'paid',
    );
    expect(html).toContain('Where this stands');
    expect(html).toMatch(/at least 20/);
  });

  it('leaves the section out entirely when nothing was computed', () => {
    // Different from a refusal: there was no attempt, so there is nothing to
    // explain. A report assembled before this existed still renders.
    const { html } = renderReport(base, 'paid');
    expect(html).not.toContain('Where this stands');
  });
});

describe('what the database hands over', () => {
  let db: Client;
  let owner: SeededAccount;
  let stranger: SeededAccount;
  let reviewer: SeededAccount;

  beforeAll(async () => {
    db = await connect();
    owner = await seedAccount(db, 'peers-owner');
    stranger = await seedAccount(db, 'peers-stranger');
    reviewer = await seedAccount(db, 'peers-reviewer');
    await makeReviewer(db, reviewer.userId);
    await seedRubric(db);
  });

  /** An assessment with a score, in whatever state the caller asks for. */
  async function seedScoredAssessment(
    appId: string,
    account: SeededAccount,
    score: number,
    status = 'approved',
  ): Promise<string> {
    const authorisationId = await seedAuthorisation(db, account, appId);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.assessments
         (app_id, organisation_id, authorisation_id, rubric_version, depth, status,
          overall_score, completed_at)
       values ($1, $2, $3, '1.0.0', 'limited', $4::public.assessment_status, $5, now())
       returning id`,
      [appId, account.organisationId, authorisationId, status, score],
    );
    return rows[0]!.id;
  }

  /** The function, called as a particular person. */
  async function peerScores(userId: string, assessmentId: string): Promise<string[]> {
    return actingAs(db, { userId }, async (client) => {
      const { rows } = await client.query<{ scores: string[] | null }>(
        'select public.category_peer_scores($1) as scores',
        [assessmentId],
      );
      return rows[0]?.scores ?? [];
    });
  }

  afterAll(async () => {
    await db?.end();
  });

  it('is numbers and nothing else', () => {
    // Read from the migration rather than from a query, because the property
    // that matters is the return type: there is no column here to leak a name
    // through, however the function is later edited.
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260919090000_category_peers.sql'),
      'utf8',
    );
    expect(migration).toContain('returns numeric[]');
    expect(migration).not.toMatch(/select[\s\S]{0,200}app\.name/i);
  });

  it('gives an entitled caller the other applications in the category', async () => {
    const category = `Peers ${Math.random().toString(36).slice(2, 8)}`;
    const mine = await seedApp(db, owner, 'Mine');
    const theirs = await seedApp(db, stranger, 'Theirs');
    await db.query(`update public.apps set category = $2 where id = any($1)`, [
      [mine, theirs],
      category,
    ]);
    const myAssessment = await seedScoredAssessment(mine, owner, 71);
    await seedScoredAssessment(theirs, stranger, 44);

    const scores = await peerScores(owner.userId, myAssessment);
    expect(scores.map(Number)).toEqual([44]);
  });

  it('gives a stranger nothing, even about an assessment that exists', async () => {
    // The entitlement check is the same one the assessment itself is behind. A
    // definer function that answers to anybody is a hole shaped like a helper,
    // and this one could otherwise be used to enumerate a category.
    const category = `Peers ${Math.random().toString(36).slice(2, 8)}`;
    const mine = await seedApp(db, owner, 'Mine');
    const theirs = await seedApp(db, stranger, 'Theirs');
    await db.query(`update public.apps set category = $2 where id = any($1)`, [
      [mine, theirs],
      category,
    ]);
    const myAssessment = await seedScoredAssessment(mine, owner, 71);
    await seedScoredAssessment(theirs, stranger, 44);

    expect(await peerScores(stranger.userId, myAssessment)).toEqual([]);
  });

  it('counts an application once, however often it has been assessed', async () => {
    const category = `Peers ${Math.random().toString(36).slice(2, 8)}`;
    const mine = await seedApp(db, owner, 'Mine');
    const theirs = await seedApp(db, stranger, 'Theirs');
    await db.query(`update public.apps set category = $2 where id = any($1)`, [
      [mine, theirs],
      category,
    ]);
    const myAssessment = await seedScoredAssessment(mine, owner, 71);
    await seedScoredAssessment(theirs, stranger, 40);
    await seedScoredAssessment(theirs, stranger, 80);

    const scores = (await peerScores(owner.userId, myAssessment)).map(Number);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toBe(80);
  });

  it('does not count an assessment nobody has approved', async () => {
    // A score that has not been through a reviewer is not a score we stand
    // behind, and standing behind it is the whole basis of comparing to it.
    const category = `Peers ${Math.random().toString(36).slice(2, 8)}`;
    const mine = await seedApp(db, owner, 'Mine');
    const theirs = await seedApp(db, stranger, 'Theirs');
    await db.query(`update public.apps set category = $2 where id = any($1)`, [
      [mine, theirs],
      category,
    ]);
    const myAssessment = await seedScoredAssessment(mine, owner, 71);
    await seedScoredAssessment(theirs, stranger, 55, 'awaiting_review');

    expect(await peerScores(owner.userId, myAssessment)).toEqual([]);
  });
});

describe('the sentence most reports will carry for a while', () => {
  it('explains an empty category rather than printing a nought', () => {
    // "There are 0 other assessed applications" is arithmetic where a reader
    // wants a reason, and it is what almost every report says today.
    const answer = compareToPeers({ score: 71, category: 'Games', peerScores: [] });
    expect(answer.kind).toBe('too_few');
    if (answer.kind !== 'too_few') return;
    expect(answer.explanation).toMatch(/Nothing else in this category has been assessed yet/);
    expect(answer.explanation).not.toMatch(/\b0 other\b/);
  });

  it('counts one correctly, because "1 others" is how software sounds', () => {
    const answer = compareToPeers({ score: 71, category: 'Games', peerScores: [50] });
    if (answer.kind !== 'too_few') throw new Error('expected a refusal');
    expect(answer.explanation).toMatch(/is 1 other assessed application\b/);
  });
});
