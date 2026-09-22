/**
 * The gate that blocks certification, and what it is allowed to fire on.
 *
 * GATE-NO-AUTHORISATION-COVERAGE publishes its own reason: "if the authorised
 * scope did not permit exercising the core flows, we did not assess the product
 * and must not certify it." It fired on one boolean out of the exploring
 * model's structured output — a model that cannot tell "the scope refused me"
 * from "I ran out of turns" from "this application is broken". The last of
 * those is a finding. The middle one is our own ceiling. Neither is a statement
 * about the scope a customer granted, and both blocked their certification
 * under a sentence saying it was.
 */
import { describe, expect, it } from 'vitest';
import {
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ScopeGuard,
  runPipeline,
  type Stage,
  type StageContext,
} from '../packages/engine/src/index.ts';

const context = (): StageContext => ({
  assessmentId: 'assessment-gate',
  depth: 'full',
  guard: new ScopeGuard({
    allowedHosts: ['example.test'],
    exclusions: [],
    ceiling: DEFAULT_CEILING,
  }),
  meter: new CostMeter({ maxRunCostUsd: 1 }),
  evidence: new EvidenceStore('assessment-gate'),
  model: null as never,
  log: () => undefined,
  target: {
    appId: 'app-gate',
    organisationId: 'org-gate',
    appName: 'Kettle',
    appType: 'web_url',
    primaryUrl: 'https://example.test',
    repositoryPath: null,
    intendedForAppStore: false,
    isGame: false,
    hasAuthentication: true,
    hasPayments: false,
    processesPersonalData: false,
    description: 'A shop that sells kettles.',
  },
});

const functionalStage = (coreFlowsReached: boolean, scopeRefusals: number): Stage => ({
  id: 'functional_exploration',
  appliesTo: () => true,
  run: async () => ({
    stage: 'functional_exploration',
    status: 'succeeded',
    findings: [],
    notes: [],
    coreFlowsReached,
    scopeRefusals,
  }),
});

const gatesOf = (outcome: { score: { gatesApplied: readonly { id: string }[] } }) =>
  outcome.score.gatesApplied.map((gate) => gate.id);

describe('core flows reported unreachable', () => {
  it('applies the gate when the scope really refused something', async () => {
    const outcome = await runPipeline({
      context: context(),
      stages: [functionalStage(false, 3)],
    });
    expect(gatesOf(outcome)).toContain('GATE-NO-AUTHORISATION-COVERAGE');
  });

  it('does not apply it when nothing of theirs was refused', async () => {
    // The model could not finish, and the scope turned nothing away. That is a
    // fact about the exploration or about the application, and the gate says
    // something else entirely.
    const outcome = await runPipeline({
      context: context(),
      stages: [functionalStage(false, 0)],
    });
    expect(gatesOf(outcome)).not.toContain('GATE-NO-AUTHORISATION-COVERAGE');
    expect(outcome.notes.join(' ')).toMatch(/nothing was refused by the authorised scope/i);
  });

  it('applies nothing when the flows were reached', async () => {
    const outcome = await runPipeline({
      context: context(),
      stages: [functionalStage(true, 0)],
    });
    expect(gatesOf(outcome)).not.toContain('GATE-NO-AUTHORISATION-COVERAGE');
    expect(outcome.notes.join(' ')).not.toMatch(/could not complete the core flows/i);
  });
});

describe('what a stage records as its own storage', () => {
  it('is what it captured, not what the run has captured so far', async () => {
    // Every stage recorded `evidence.totalBytes`, which is cumulative, so the
    // per-stage cost rows summed to two or three times the evidence that
    // actually exists.
    const ctx = context();
    const capturing = (id: 'functional_exploration' | 'adversarial_practicality'): Stage => ({
      id,
      appliesTo: () => true,
      run: async () => {
        ctx.evidence.capture({
          kind: 'console_log',
          summary: `Output from ${id}`,
          body: 'x'.repeat(1_000),
        });
        ctx.meter.recordCompute(id, 0.1, ctx.evidence.totalBytes - before.get(id)!);
        return { stage: id, status: 'succeeded' as const, findings: [], notes: [] };
      },
    });
    const before = new Map<string, number>();
    const wrap = (stage: Stage): Stage => ({
      ...stage,
      run: async (c) => {
        before.set(stage.id, ctx.evidence.totalBytes);
        return stage.run(c);
      },
    });

    await runPipeline({
      context: ctx,
      stages: [
        wrap(capturing('functional_exploration')),
        wrap(capturing('adversarial_practicality')),
      ],
    });

    const byStage = ctx.meter.summariseByStage();
    const total = Object.values(byStage).reduce((sum, record) => sum + record.storageBytes, 0);
    // Two artefacts of about a kilobyte each. Recording the running total would
    // have made the second stage claim both of them.
    expect(total).toBeLessThanOrEqual(ctx.evidence.totalBytes);
    expect(byStage.adversarial_practicality?.storageBytes).toBeLessThan(ctx.evidence.totalBytes);
  });

  it('is how the engine itself does it', async () => {
    const { readFileSync } = await import('node:fs');
    for (const path of [
      'packages/engine/src/stages/deterministic.ts',
      'packages/engine/src/stages/model-stage.ts',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).toMatch(/totalBytes - bytesAtStart/);
    }
  });
});
