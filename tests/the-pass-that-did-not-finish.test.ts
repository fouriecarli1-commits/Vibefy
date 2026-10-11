/**
 * A stage that crashed, and the question that ticked on its behalf.
 *
 * Scoring starts each dimension at full marks and deducts for findings, so a
 * pass that asked nothing produces the same number as one that found nothing
 * wrong. The pipeline knew: it pushes a note saying "what they did not look at
 * is not evidence that there was nothing to find". The published question above
 * each criterion did not, because `assuranceFor` withholds a tick only for a
 * criterion the run reports as not tested — and a failed stage reported
 * nothing at all.
 *
 * So a security pass that crashed on its second attempt left "are its keys
 * exposed?" reading as a tick, on a report that published normally, with the
 * explanation sitting in a note three sections down. `stages/coverage.ts`
 * already holds the two neighbouring cases — a criterion the rubric does not
 * define, and one nothing in this engine asks. This is the third: the check
 * exists and did not run.
 *
 * The same for a stage the run never reached, which is a different thing from
 * one that does not apply. A run that hits its ceiling skips what is left; an
 * application with no payments does not need the payment pass, and the claim's
 * own `applies` says so. Marking the second would put "not tested" under a
 * question about a checkout nobody has.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ScopeGuard,
  runPipeline,
  type Stage,
  type StageContext,
  type StageId,
} from '../packages/engine/src/index.ts';
// Not re-exported by the package index, which carries the stages a caller
// assembles a run from rather than the engine's own bookkeeping.
import {
  ASKED_BY_STAGE,
  CRITERION_COVERAGE,
  unasked,
} from '../packages/engine/src/stages/coverage.ts';

const context = (): StageContext => ({
  assessmentId: 'assessment-unfinished',
  depth: 'full',
  guard: new ScopeGuard({
    allowedHosts: ['example.test'],
    exclusions: [],
    ceiling: DEFAULT_CEILING,
  }),
  meter: new CostMeter({ maxRunCostUsd: 1 }),
  evidence: new EvidenceStore('assessment-unfinished'),
  model: null as never,
  log: () => undefined,
  target: {
    appId: 'app-unfinished',
    organisationId: 'org-unfinished',
    appName: 'Kettle',
    appType: 'web_url',
    primaryUrl: 'https://example.test',
    repositoryPath: null,
    intendedForAppStore: false,
    isGame: false,
    hasAuthentication: false,
    hasPayments: false,
    processesPersonalData: false,
    description: 'A shop that sells kettles.',
  },
});

const succeeds = (id: StageId): Stage => ({
  id,
  appliesTo: () => true,
  run: async () => ({ stage: id, status: 'succeeded', findings: [], notes: [] }),
});

const fails = (id: StageId): Stage => ({
  id,
  appliesTo: () => true,
  run: async () => {
    throw new Error(`${id} fell over`);
  },
});

const stops = (id: StageId): Stage => ({
  id,
  appliesTo: () => true,
  run: async () => ({
    stage: id,
    status: 'aborted',
    findings: [],
    notes: [],
    stopReason: 'cost_ceiling',
  }),
});

const notTestedOf = (outcome: { notTestedCriteria: readonly { criterion: string }[] }) =>
  outcome.notTestedCriteria.map((entry) => entry.criterion);

describe('a stage that did not finish', () => {
  it('leaves its criteria marked not tested rather than clean', async () => {
    const outcome = await runPipeline({
      context: context(),
      stages: [fails('deterministic_checks')],
      maxAttemptsPerStage: 1,
    });

    // The positive control first: the run published, which is why this matters.
    // A failed stage among successful ones does not stop a report.
    expect(outcome.findings).toEqual([]);
    for (const criterion of ['SEC-01', 'SEC-04', 'UX-02']) {
      expect(notTestedOf(outcome)).toContain(criterion);
    }
  });

  it('does not mark a criterion another pass did ask about', async () => {
    // `static_intake` reads for an exposed key too, so its finishing means
    // SEC-04 and SEC-10 were asked. Everything only the deterministic pass
    // asks is still unanswered.
    const outcome = await runPipeline({
      context: context(),
      stages: [succeeds('static_intake'), fails('deterministic_checks')],
      maxAttemptsPerStage: 1,
    });

    expect(notTestedOf(outcome)).not.toContain('SEC-04');
    expect(notTestedOf(outcome)).not.toContain('SEC-10');
    expect(notTestedOf(outcome)).toContain('SEC-01');
  });

  it('says whose fault it is, in words for the owner', async () => {
    const outcome = await runPipeline({
      context: context(),
      stages: [fails('adversarial_practicality')],
      maxAttemptsPerStage: 1,
    });

    const entry = outcome.notTestedCriteria.find((row) => row.criterion === 'SEC-06');
    expect(entry?.because).toMatch(/did not finish/i);
    expect(entry?.because).toMatch(/gap in our assessment/i);
  });

  it('names each criterion once, however many reasons it has', async () => {
    // FI-07 is behind a sign-in and read by a deterministic check, so it
    // arrives from two lists.
    const outcome = await runPipeline({
      context: { ...context(), target: { ...context().target, hasAuthentication: true } },
      stages: [fails('deterministic_checks')],
      maxAttemptsPerStage: 1,
    });

    const names = notTestedOf(outcome);
    expect(names).toContain('FI-07');
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('a stage the run never reached', () => {
  it('counts the same as one that failed', async () => {
    const outcome = await runPipeline({
      context: context(),
      stages: [stops('deterministic_checks'), succeeds('store_readiness')],
      maxAttemptsPerStage: 1,
    });

    expect(outcome.status).toBe('aborted');
    expect(outcome.stopReason).toBe('cost_ceiling');
    // The stage after the one that stopped never ran, so its criteria were not
    // asked either — and the stage that aborted did not finish its own.
    expect(notTestedOf(outcome)).toContain('STR-01');
    expect(notTestedOf(outcome)).toContain('SEC-01');
  });
});

describe('a run where everything finished', () => {
  it('adds nothing beyond the criteria this engine never asks', async () => {
    const whole = await runPipeline({
      context: context(),
      stages: [succeeds('static_intake'), succeeds('deterministic_checks')],
      maxAttemptsPerStage: 1,
    });

    // Exactly the standing gaps: the ten nothing checks, plus the sign-in ones
    // for an application that declares authentication — which this one does
    // not. Nothing from `unasked`.
    expect(notTestedOf(whole)).not.toContain('SEC-01');
    expect(notTestedOf(whole).length).toBeGreaterThan(0);
    expect(whole.notTestedCriteria.every((entry) => !/did not finish/i.test(entry.because))).toBe(
      true,
    );
  });
});

describe('the table of who asks what', () => {
  const root = process.cwd();
  const sourceOf = (file: string) =>
    readFileSync(join(root, 'packages/engine/src/stages', file), 'utf8');
  const emitted = (files: readonly string[]) => {
    const ids = new Set<string>();
    for (const file of files) {
      for (const match of sourceOf(file).matchAll(/ruleId: '([A-Z]+-[0-9]+)'/g)) {
        ids.add(match[1]!);
      }
    }
    return [...ids].sort();
  };

  it('matches the criteria the deterministic sources actually emit', () => {
    // Read off the `ruleId:` literals, so adding a check without adding it here
    // fails rather than silently narrowing what a crash is said to have missed.
    expect([...ASKED_BY_STAGE.deterministic_checks!].sort()).toEqual(
      emitted([
        'deterministic.ts',
        'design-checks.ts',
        'trust-checks.ts',
        'exit-checks.ts',
        'game-checks.ts',
      ]),
    );
    expect([...ASKED_BY_STAGE.static_intake!].sort()).toEqual(emitted(['static-intake.ts']));
  });

  it('matches what the coverage map attributes to each prompt', () => {
    const byPrompt = (promptId: string) =>
      Object.entries(CRITERION_COVERAGE)
        .filter(([, kind]) => kind === `prompt:${promptId}`)
        .map(([criterion]) => criterion)
        .sort();

    expect([...ASKED_BY_STAGE.functional_exploration!].sort()).toEqual(
      byPrompt('functional-exploration'),
    );
    expect([...ASKED_BY_STAGE.adversarial_practicality!].sort()).toEqual(
      byPrompt('adversarial-practicality'),
    );
    expect([...ASKED_BY_STAGE.store_readiness!].sort()).toEqual(byPrompt('store-readiness'));
  });

  it('has an entry for every stage the engine runs by default', () => {
    const pipeline = readFileSync(join(root, 'packages/engine/src/pipeline.ts'), 'utf8');
    const listed = pipeline
      .slice(pipeline.indexOf('DEFAULT_STAGES'), pipeline.indexOf('export type AssessmentStatus'))
      .match(/[a-zA-Z]+Stage/g);
    expect(listed).not.toBeNull();
    // Six stages in the default list, six entries here. A stage with no entry
    // would be one whose crash is silently said to have missed nothing.
    expect(Object.keys(ASKED_BY_STAGE)).toHaveLength(new Set(listed).size);
  });

  it('is empty only where that is the documented answer', () => {
    const empty = Object.entries(ASKED_BY_STAGE)
      .filter(([, criteria]) => criteria.length === 0)
      .map(([stage]) => stage);
    expect(empty).toEqual(['game_experience']);
  });
});

describe('the function behind it', () => {
  it('returns nothing when nothing failed', () => {
    expect(unasked([], ['deterministic_checks'])).toEqual([]);
  });

  it('ignores a stage it has never heard of', () => {
    // A stage id that is not in the table contributes nothing rather than
    // throwing: the pipeline accepts a stage list from its caller, and a test
    // harness passing a made-up stage must not take a run down.
    expect(unasked(['invented_stage'], [])).toEqual([]);
  });
});
