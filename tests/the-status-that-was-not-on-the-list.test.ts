/**
 * The hard gate, and the direction it failed in.
 *
 * `runAssessmentJob` refuses to start on an application it may not touch, and
 * the brief's rule is absolute: no assessment step against a target without a
 * verified authorisation. The screening half of that gate named the statuses
 * that *block* a run —
 *
 *     if (appRow.screening_status === 'refused') throw …
 *     if (appRow.screening_status === 'pending') throw …
 *
 * — and let anything else through. `screening_status` has three values and the
 * list covered two of them, so it was complete, and complete by coincidence. A
 * fourth value added to the enum would have been assessed by default, which is
 * the wrong side for a gate to fail on.
 *
 * It is the same shape as the alert-kind and plan-tier lists fixed earlier
 * tonight — a hand-kept list beside a database enum — with a worse consequence
 * at the end of it: running against somebody's application without having
 * established that we may.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import {
  missingDecisionColumns,
  runAssessmentJob,
  screeningRefusal,
} from '../apps/worker/src/run-assessment.ts';
import { withoutComments } from './setup/source.ts';
import { readFileSync } from 'node:fs';

let db: Client;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db?.end();
});

describe('every screening status the database knows', () => {
  let statuses: string[] = [];

  beforeAll(async () => {
    const { rows } = await db.query<{ label: string }>(
      `select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'screening_status' order by e.enumsortorder`,
    );
    statuses = rows.map((row) => row.label);
  });

  it('is a set this test actually read, not an empty one', () => {
    expect(statuses.length).toBeGreaterThan(2);
    expect(statuses).toContain('cleared');
  });

  it('permits a run only when it is cleared', () => {
    const permitted = statuses.filter((status) => screeningRefusal(status, 'app-1') === null);
    expect(
      permitted,
      `Statuses that permit an assessment: ${permitted.join(', ')}. Only "cleared" may.`,
    ).toEqual(['cleared']);
  });

  it('gives every other one a reason naming the application', () => {
    for (const status of statuses.filter((s) => s !== 'cleared')) {
      const refusal = screeningRefusal(status, 'app-1');
      expect(refusal, status).not.toBeNull();
      expect(refusal!, status).toContain('app-1');
      expect(refusal!.length, status).toBeGreaterThan(40);
    }
  });
});

describe('a status nobody has written a sentence for', () => {
  it('refuses, rather than being assessed by default', () => {
    // The fourth enum value, before anybody edits this file.
    const refusal = screeningRefusal('under_appeal', 'app-2');
    expect(refusal, 'an unknown screening status permitted an assessment').not.toBeNull();
    expect(refusal!).toContain('under_appeal');
    expect(refusal!).toContain('cleared');
  });

  it('refuses null and undefined, which a missing column reads as', () => {
    expect(screeningRefusal(null, 'app-3')).not.toBeNull();
    expect(screeningRefusal(undefined, 'app-3')).not.toBeNull();
  });

  it('keeps the two sentences that were already there, because they say more', () => {
    expect(screeningRefusal('refused', 'app-4')).toMatch(/Acceptable Use Policy/);
    expect(screeningRefusal('pending', 'app-4')).toMatch(/review\/screening/);
  });
});

describe('the gate calls it', () => {
  const run = withoutComments(readFileSync('apps/worker/src/run-assessment.ts', 'utf8'));

  it('on the status it read from the row, and refuses on what comes back', () => {
    // A guard tested on its own proves the rule and not the wiring.
    expect(run).toMatch(/screeningRefusal\(appRow\.screening_status, job\.appId\)/);
    expect(run).toMatch(/if \(refusal\) throw new NotAuthorisedError\(refusal\)/);
  });

  it('no longer decides on its own which statuses block', () => {
    expect(run).not.toMatch(/screening_status === 'refused'/);
    expect(run).not.toMatch(/screening_status === 'pending'/);
  });

  it('still has the rest of the gate, which this did not touch', () => {
    expect(run).toMatch(/if \(!appRow\.authorised\)/);
    expect(run).toMatch(/no verified, unexpired authorisation/);
    expect(run).toMatch(/does not exist/);
  });
});

/**
 * The columns beside the status, which do not fail safe.
 *
 * The same `select a.*` the status arrives on carries six more that this job
 * turns into a decision, each read with a default or a `typeof` check. The
 * status and the authorisation flag refuse when they are absent, loudly. These
 * six quietly shrink the assessment instead: no repository, no address, and
 * four owner-declared facts read as "no authentication, no payments, no
 * personal data, not a game".
 *
 * Checked by key, because `'repository_url' in row` is the only thing that
 * distinguishes an absent column from a customer who declared nothing.
 */
describe('a row that came back without a column', () => {
  const complete = {
    id: 'app-1',
    screening_status: 'cleared',
    repository_url: null,
    primary_url: 'https://customer.example',
    has_authentication: false,
    has_payments: false,
    processes_personal_data: false,
    is_game: false,
  };

  it('says nothing is missing when every column is there, null or false included', () => {
    // The half that makes the other half mean something: null is a real answer
    // from a customer who declared no repository, and false is a real answer
    // about payments.
    expect(missingDecisionColumns(complete)).toEqual([]);
  });

  it('names a missing column, in the order they are declared', () => {
    const { repository_url: _dropped, ...withoutRepository } = complete;
    expect(missingDecisionColumns(withoutRepository)).toEqual(['repository_url']);
  });

  it('names all of them when the row is a different shape entirely', () => {
    expect(missingDecisionColumns({ id: 'app-1' })).toEqual([
      'repository_url',
      'primary_url',
      'has_authentication',
      'has_payments',
      'processes_personal_data',
      'is_game',
    ]);
  });

  it('refuses the run rather than assessing less than the customer declared', async () => {
    /*
     * Through the real function, with a fake pool. The refusal has to come
     * before the authorisation read, because the point is that nothing about
     * this run is worth doing once we cannot tell what we were asked to look
     * at — and `AppRowIncompleteError` is unretryable, because a rename is not
     * something a second attempt fixes.
     */
    const { primary_url: _dropped, ...withoutUrl } = complete;
    const pool = {
      query: async () => ({ rows: [{ ...withoutUrl, authorised: true }] }),
    };
    await expect(
      runAssessmentJob({ appId: 'app-1', depth: 'limited', requestedBy: null }, {
        pool,
      } as never),
    ).rejects.toThrow(/without the column "primary_url"/);
    await expect(
      runAssessmentJob({ appId: 'app-1', depth: 'limited', requestedBy: null }, {
        pool,
      } as never),
    ).rejects.toThrow(/examined nothing/);
  });
});
