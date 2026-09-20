/**
 * A run that stopped is not a run that failed.
 *
 * Three things stop a run on purpose: reaching the spending limit for its
 * depth, using up the intensity the customer's own authorisation permits, and
 * being turned back at the scope boundary. Every one of them is the system
 * working, and every one of them was written into the database as `failed` —
 * the same word as a stage that crashed.
 *
 * That word did real damage in three directions. It told the customer their
 * application had broken something. It sent whoever was on support looking for
 * a fault that was not there. And it filed the single event most worth seeing —
 * a run turned back at the edge of what somebody authorised — under the same
 * heading as a timeout.
 *
 * Nothing tested this path at all, which is how it survived. So this file
 * follows one stop from the exception that causes it to the sentence a customer
 * reads about it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type Client } from 'pg';
import {
  CostCeilingExceededError,
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ModelClient,
  ScopeGuard,
  ScriptedTransport,
  CeilingExceededError,
  ScopeViolationError,
  classifyStop,
  runPipeline,
  type Stage,
  type StageContext,
  type StageId,
  type StopReason,
} from '../packages/engine/src/index.ts';
import { STOP_EXPLANATION, STOP_HEADLINE, STOP_LABEL, STOP_REASONS } from '@vibefycode/shared';
import { persistOutcome } from '../apps/worker/src/index.ts';
import { connect } from './setup/client.ts';
import {
  seedAccount,
  seedApp,
  seedAuthorisation,
  seedRubric,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let pool: Pool;
let owner: SeededAccount;

function poolConfig() {
  const dsn = process.env.VIBEFYCODE_TEST_DSN!;
  const url = new URL(dsn);
  return { host: url.searchParams.get('host')!, database: url.pathname.slice(1), user: 'postgres' };
}

/** The three errors, each with the reason it is meant to become. */
const STOPS: readonly { readonly reason: StopReason; readonly error: Error }[] = [
  {
    reason: 'cost_ceiling',
    error: new CostCeilingExceededError('Run cost $4.21 of a $4.00 ceiling.', {
      ceiling: 'run',
      limitUsd: 4,
      observedUsd: 4.21,
    }),
  },
  {
    reason: 'intensity_ceiling',
    error: new CeilingExceededError('The run made 500 requests of 500 permitted.', {
      ceiling: 'maxTotalRequests',
      limit: 500,
      observed: 500,
    }),
  },
  {
    reason: 'scope_violation',
    error: new ScopeViolationError('analytics.example is not in the authorised scope.', {
      host: 'analytics.example',
      reason: 'host_not_allowed',
    }),
  },
];

/** A stage that does one thing: throw the error it was given. */
function throwingStage(error: Error): Stage {
  return {
    id: 'deterministic_checks',
    appliesTo: () => true,
    run: async () => {
      throw error;
    },
  };
}

/** A stage the pipeline will not run, which is the ordinary case, not a rarity. */
function skippingStage(id: StageId): Stage {
  return {
    id,
    appliesTo: () => false,
    skipReason: () => 'this stage does not apply to the fixture',
    run: async () => {
      throw new Error('A skipped stage must never be run.');
    },
  };
}

/** A stage that finds nothing and says so, which is a perfectly good outcome. */
function quietStage(id: StageId): Stage {
  return {
    id,
    appliesTo: () => true,
    run: async () => ({ stage: id, status: 'succeeded', findings: [], notes: ['Nothing found.'] }),
  };
}

function context(): StageContext {
  const meter = new CostMeter({ maxRunCostUsd: 1 });
  return {
    assessmentId: crypto.randomUUID(),
    depth: 'limited',
    guard: new ScopeGuard({
      allowedHosts: ['kettle.example.test'],
      exclusions: [],
      ceiling: DEFAULT_CEILING,
    }),
    meter,
    evidence: new EvidenceStore(crypto.randomUUID()),
    model: new ModelClient(new ScriptedTransport([]), meter),
    log: () => undefined,
    target: {
      appId: 'app',
      organisationId: 'org',
      appName: 'Kettle',
      appType: 'web_url',
      primaryUrl: 'https://kettle.example.test',
      repositoryPath: null,
      intendedForAppStore: false,
      isGame: false,
      hasAuthentication: false,
      hasPayments: false,
      processesPersonalData: false,
      description: 'A shop that sells kettles.',
    },
  };
}

beforeAll(async () => {
  db = await connect();
  pool = new Pool(poolConfig());
  owner = await seedAccount(db, 'stopped-owner');
  await seedRubric(db);
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

describe('the pipeline says which limit it was', () => {
  it.each(STOPS)('$reason', async ({ reason, error }) => {
    const outcome = await runPipeline({
      context: context(),
      stages: [throwingStage(error)],
      maxAttemptsPerStage: 2,
    });
    expect(outcome.status).toBe('aborted');
    expect(outcome.stopReason).toBe(reason);
  });

  it('does not call a scope stop a ceiling', async () => {
    // It read "The run stopped at a ceiling" for all three, which is wrong about
    // two of them and misleading about the one it is not: a scope violation is
    // not a limit that can be raised.
    const outcome = await runPipeline({
      context: context(),
      stages: [throwingStage(STOPS[2]!.error)],
    });
    const notes = outcome.stageResults.flatMap((result) => result.notes).join(' ');
    expect(notes).toContain('turned back at the scope boundary');
    expect(notes).not.toMatch(/ceiling/i);
  });

  it('does not let a skipped stage turn a total failure into a completed run', async () => {
    // The old rule was "every stage failed", and one skipped stage defeats it.
    // There is essentially always a skipped stage — the game pass does not apply
    // to a web application, several others are skipped by depth — so `failed`
    // was close to unreachable and this run came out as `completed`.
    const outcome = await runPipeline({
      context: context(),
      stages: [
        skippingStage('game_experience'),
        throwingStage(new Error('Chromium exited before the page loaded.')),
      ],
    });
    expect(outcome.status).toBe('failed');
  });

  it('never hands a reviewer a perfect score for an application nothing could reach', async () => {
    // Why the status has to carry this. The scoring is honest on its own terms —
    // no findings means no penalty, which means full marks and no certification
    // blockers — so a run that reached nothing produces the best possible
    // result. `completed` would have sent that to the review queue looking like
    // a flawless application; `failed` never reaches a reviewer at all.
    const outcome = await runPipeline({
      context: context(),
      stages: [skippingStage('game_experience'), throwingStage(new Error('connect ETIMEDOUT'))],
    });
    expect(outcome.findings).toEqual([]);
    expect(outcome.score.overallScore).toBeGreaterThan(90);
    expect(outcome.score.certificationEligible).toBe(true);
    expect(outcome.status, 'the only thing standing between this and a badge').toBe('failed');
  });

  it('says which stages did not complete, so the silence is not mistaken for a clean sheet', async () => {
    const outcome = await runPipeline({
      context: context(),
      stages: [quietStage('static_intake'), throwingStage(new Error('Chromium exited.'))],
    });
    expect(outcome.status).toBe('completed');
    const notes = outcome.notes.join(' ');
    expect(notes).toContain('deterministic_checks');
    expect(notes).toMatch(/did not complete/i);
    expect(notes).toMatch(/not evidence that there was nothing to find/i);
  });

  it('is a completed run when something did work, even if something else did not', async () => {
    const outcome = await runPipeline({
      context: context(),
      stages: [quietStage('static_intake'), throwingStage(new Error('Chromium exited.'))],
    });
    expect(outcome.status).toBe('completed');
  });

  it('keeps calling a genuine fault a failure', async () => {
    // The other half of the change, and the easier one to break: widening what
    // counts as a stop would hide real faults behind a reassuring sentence.
    const outcome = await runPipeline({
      context: context(),
      stages: [throwingStage(new Error('Chromium exited before the page loaded.'))],
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.stopReason).toBeNull();
  });

  it('classifies nothing else as a stop', () => {
    for (const error of [new Error('boom'), new TypeError('x'), null, undefined, 'a string']) {
      expect(classifyStop(error)).toBeNull();
    }
  });

  it('retries a fault and does not retry a stop', async () => {
    // Retrying a ceiling would spend money to break the same rule twice.
    let attempts = 0;
    const counting = (error: Error): Stage => ({
      id: 'deterministic_checks',
      appliesTo: () => true,
      run: async () => {
        attempts += 1;
        throw error;
      },
    });

    attempts = 0;
    await runPipeline({
      context: context(),
      stages: [counting(STOPS[0]!.error)],
      maxAttemptsPerStage: 3,
    });
    expect(attempts).toBe(1);

    attempts = 0;
    await runPipeline({
      context: context(),
      stages: [counting(new Error('transient'))],
      maxAttemptsPerStage: 3,
    });
    expect(attempts).toBe(3);
  });
});

describe('what the database is told', () => {
  async function persistStopped(reason: StopReason, error: Error) {
    const appId = await seedApp(db, owner, 'Stopped App');
    const authorisationId = await seedAuthorisation(db, owner, appId);
    const outcome = await runPipeline({
      context: context(),
      stages: [throwingStage(error)],
    });
    expect(outcome.stopReason).toBe(reason);
    const client = await pool.connect();
    try {
      return await persistOutcome(client, {
        outcome,
        appId,
        organisationId: owner.organisationId,
        authorisationId,
        depth: 'limited',
        requestedBy: owner.userId,
        engineVersion: 'test',
      });
    } finally {
      client.release();
    }
  }

  it.each(STOPS)('records $reason as a stop, not as a failure', async ({ reason, error }) => {
    const assessmentId = await persistStopped(reason, error);
    const { rows } = await db.query<{ status: string; stop_reason: string }>(
      'select status, stop_reason from public.assessments where id = $1',
      [assessmentId],
    );
    expect(rows[0]?.status).toBe('aborted');
    expect(rows[0]?.stop_reason).toBe(reason);
  });

  it('does not file a stopped run under assessment.completed', async () => {
    // An audit line that has to be read together with its summary to be
    // believed is not an audit line.
    const assessmentId = await persistStopped('scope_violation', STOPS[2]!.error);
    const { rows } = await db.query<{ action: string; summary: string }>(
      `select action, summary from public.audit_log
        where entity_id = $1 and action like 'assessment.%'`,
      [assessmentId],
    );
    expect(rows[0]?.action).toBe('assessment.aborted');
    expect(rows[0]?.summary).toContain('scope boundary');
    expect(rows[0]?.summary).toContain('What ran first stands');
  });

  it('does not send a stopped run to a reviewer', async () => {
    // `awaiting_review` is a promise to a human that there is something to
    // review. A run that stopped a third of the way through is not that.
    const assessmentId = await persistStopped('cost_ceiling', STOPS[0]!.error);
    const { rows } = await db.query<{ status: string }>(
      'select status from public.assessments where id = $1',
      [assessmentId],
    );
    expect(rows[0]?.status).not.toBe('awaiting_review');
  });
});

describe('the database refuses a stop with no reason', () => {
  async function anAssessment(): Promise<string> {
    const appId = await seedApp(db, owner, 'Constraint App');
    const authorisationId = await seedAuthorisation(db, owner, appId);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.assessments (app_id, organisation_id, authorisation_id, rubric_version, depth, status)
       values ($1, $2, $3, '1.0.0', 'limited', 'running') returning id`,
      [appId, owner.organisationId, authorisationId],
    );
    return rows[0]!.id;
  }

  it('refuses aborted with no reason', async () => {
    // The state this whole change exists to abolish: a run recorded as stopped
    // that cannot say what stopped it, which is the old `failed` by another name.
    const id = await anAssessment();
    await expect(
      db.query(`update public.assessments set status = 'aborted' where id = $1`, [id]),
    ).rejects.toThrow(/assessments_stop_reason_matches_status/);
  });

  it('refuses a reason on a run that did not stop', async () => {
    const id = await anAssessment();
    await expect(
      db.query(`update public.assessments set stop_reason = 'cost_ceiling' where id = $1`, [id]),
    ).rejects.toThrow(/assessments_stop_reason_matches_status/);
  });

  it('refuses to relabel a stopped run as ready for review', async () => {
    // The move that would undo the whole change: a run that stopped a third of
    // the way through, quietly put in front of a reviewer as if it had finished.
    const id = await anAssessment();
    await db.query(
      `update public.assessments set status = 'aborted', stop_reason = 'scope_violation' where id = $1`,
      [id],
    );
    await expect(
      db.query(`update public.assessments set status = 'awaiting_review' where id = $1`, [id]),
    ).rejects.toThrow(/assessments_stop_reason_matches_status/);
  });

  it('refuses to approve a stopped run, by an older guard than this one', async () => {
    // Worth asserting even though the constraint is not what refuses it: the
    // transition trigger already insists on awaiting_review first, and that is
    // the sentence somebody will see. Recorded here so a change to either guard
    // cannot quietly leave a stopped run approvable.
    const id = await anAssessment();
    await db.query(
      `update public.assessments set status = 'aborted', stop_reason = 'cost_ceiling' where id = $1`,
      [id],
    );
    await expect(
      db.query(`update public.assessments set status = 'approved' where id = $1`, [id]),
    ).rejects.toThrow(/must pass through awaiting_review/);
  });
});

describe('what the customer is told', () => {
  it('has a sentence for every reason, and a different one for each', () => {
    // A criterion nothing answers is worse than no criterion, and the same is
    // true of a status with no explanation: the console would print a word.
    expect(Object.keys(STOP_EXPLANATION).sort()).toEqual([...STOP_REASONS].sort());
    expect(new Set(Object.values(STOP_EXPLANATION)).size).toBe(STOP_REASONS.length);
    expect(new Set(Object.values(STOP_HEADLINE)).size).toBe(STOP_REASONS.length);
  });

  it('says that what was assessed still stands', () => {
    // The thing somebody actually wants to know when a run did not finish.
    for (const reason of STOP_REASONS) {
      expect(STOP_EXPLANATION[reason], reason).toMatch(/still stands/);
    }
  });

  it('does not tell somebody their application is at fault when it is not', () => {
    expect(STOP_EXPLANATION.cost_ceiling).toMatch(/Nothing is wrong with the application/);
    expect(STOP_EXPLANATION.scope_violation).toMatch(/rather than a fault in the application/);
  });

  it('says whose it is to act on, where it is anybody at all', () => {
    expect(STOP_EXPLANATION.intensity_ceiling).toMatch(/yours to widen/);
  });

  it('is shown on the page a customer reads, not only stored', () => {
    // A reason recorded and never rendered is a column nobody reads.
    const page = readFileSync(
      join(process.cwd(), 'apps/web/app/console/apps/[id]/page.tsx'),
      'utf8',
    );
    expect(page).toContain('stop_reason');
    expect(page).toContain('STOP_EXPLANATION');
  });

  it('keeps the short label out of the customer-facing sentence', () => {
    // STOP_LABEL is for a log line. It reads as jargon in a console panel.
    for (const reason of STOP_REASONS) {
      expect(STOP_EXPLANATION[reason]).not.toContain(STOP_LABEL[reason]);
    }
  });
});
