/**
 * Rubric 1.1.0, and the checks that had to arrive with it.
 *
 * The rule that shaped this whole change: **a criterion nothing checks is worse
 * than no criterion at all.** The verification page turns "no findings against
 * this criterion" into a tick for a visitor, so publishing SEC-12 without a
 * payments check would not have produced a blank — it would have produced a
 * pass, for something nobody looked at, invisibly.
 *
 * So these tests come in two halves. That the version is additive and changes
 * nobody's score, and that every criterion it adds has a check which fires on
 * something broken and stays quiet on something that is not.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserSession } from '../packages/engine/src/runtime/browser.ts';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';
import { DEFAULT_CEILING, ScopeGuard } from '../packages/engine/src/runtime/scope.ts';
import {
  measureTrust,
  trustFindings,
  type TrustMeasurements,
} from '../packages/engine/src/stages/trust-checks.ts';
import { CURRENT_RUBRIC_VERSION, getRubric } from '../packages/rubric/src/rubric.ts';
import { ASSURANCE_CLAIMS, assuranceFor } from '../packages/assurance/src/index.ts';
import { startCheckoutPage, type CheckoutFixture } from './fixtures/checkout-page.ts';

const criteriaOf = (version: string) =>
  getRubric(version).dimensions.flatMap((dimension) =>
    dimension.criteria.map((criterion) => criterion.id),
  );

describe('what 1.1.0 changed, and what it did not', () => {
  it('is the version new assessments are scored against', () => {
    expect(CURRENT_RUBRIC_VERSION).toBe('1.1.0');
  });

  it('adds exactly the seven criteria the four waiting features needed', () => {
    const added = criteriaOf('1.1.0').filter((id) => !criteriaOf('1.0.0').includes(id));
    expect(added.sort()).toEqual(
      ['FI-08', 'PRD-06', 'PRI-07', 'SEC-12', 'SEC-13', 'STR-08', 'UX-07'].sort(),
    );
  });

  it('moves nobody’s score, because nothing that decides a score changed', () => {
    // The claim the changelog makes, asserted rather than trusted. An
    // application with identical findings scores identically under either.
    const before = getRubric('1.0.0');
    const after = getRubric('1.1.0');
    expect(after.scoring).toEqual(before.scoring);
    expect(after.certification).toEqual(before.certification);
    expect(after.gates).toEqual(before.gates);
    expect(after.bands).toEqual(before.bands);
  });

  it('keeps 1.0.0 exactly as it was, because badges were earned against it', () => {
    // A score recomputed against a rubric that did not exist when it was earned
    // is not the score anybody agreed to.
    expect(getRubric('1.0.0').version).toBe('1.0.0');
    expect(criteriaOf('1.0.0')).not.toContain('SEC-12');
  });
});

describe('every new criterion arrived with a check', () => {
  it('leaves no criterion that nothing can ever produce a finding against', async () => {
    // The rule this version was built around. A criterion with no check turns
    // "nobody looked" into "nothing was found", and the assurance list prints
    // that as a tick.
    const { readFileSync } = await import('node:fs');
    const engine = ['trust-checks', 'game-checks', 'design-checks', 'deterministic']
      .map((file) => readFileSync(`packages/engine/src/stages/${file}.ts`, 'utf8'))
      .join('\n');
    const prompts = readFileSync('prompts/game-experience.md', 'utf8');
    const added = criteriaOf('1.1.0').filter((id) => !criteriaOf('1.0.0').includes(id));

    for (const criterion of added) {
      expect(`${engine}\n${prompts}`, criterion).toContain(criterion);
    }
  });
});

describe('the three the verification page asks on a visitor’s behalf', () => {
  let fixture: CheckoutFixture;
  let bad: TrustMeasurements;
  let good: TrustMeasurements;
  let both: TrustMeasurements;

  const rulesOf = (measurements: TrustMeasurements) =>
    trustFindings(measurements, { payments: true }, ['evidence-1']).findings.map((f) => f.ruleId);

  beforeAll(async () => {
    fixture = await startCheckoutPage();
    const guard = new ScopeGuard({
      allowedHosts: [fixture.host.split(':')[0]!],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 400 },
      allowPrivateNetworkForTesting: true,
    });

    const measure = async (url: string) => {
      const session = new BrowserSession(guard, new EvidenceStore(url));
      await session.open();
      try {
        await session.goto(url, 'domcontentloaded');
        return await measureTrust(session, {
          url,
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: await session.page.content(),
          redirectChain: [],
        });
      } finally {
        await session.close();
      }
    };

    bad = await measure(fixture.url);
    good = await measure(`${fixture.url}?good=1`);
    both = await measure(`${fixture.url}?both=1`);
  }, 180_000);

  afterAll(async () => {
    await fixture?.close();
  });

  it('sees a card typed into the application’s own page', () => {
    expect(bad.collectsCardDetails).toBe(true);
    expect(bad.processorFramePresent).toBe(false);
    expect(rulesOf(bad)).toContain('SEC-12');
  });

  it('sees a known cryptominer', () => {
    expect(bad.minerHosts).toContain('coinhive.com');
    expect(bad.minerSignatures.length).toBeGreaterThan(0);
    expect(rulesOf(bad)).toContain('SEC-13');
  });

  it('sees that nobody can be contacted', () => {
    expect(bad.contactOutcome).toBe('not_found');
    expect(rulesOf(bad)).toContain('PRI-07');
  });

  it('says nothing about the same shop done properly', () => {
    // The half that makes the other half mean something.
    expect(good.processorFramePresent).toBe(true);
    expect(good.collectsCardDetails).toBe(false);
    expect(good.processorsPresent).toContain('js.stripe.com');
    expect(good.contactOutcome).toBe('found');
    expect(rulesOf(good)).toEqual([]);
  });

  it('does not accuse an application that has no checkout at all', () => {
    // Nothing to fail the criterion with. The verification page says there was
    // no checkout to test rather than ticking.
    const noCheckout: TrustMeasurements = {
      ...good,
      collectsCardDetails: false,
      processorFramePresent: false,
      processorsPresent: [],
      checkoutObserved: false,
    };
    expect(trustFindings(noCheckout, { payments: false }, ['e']).findings).toEqual([]);
  });

  it('still names the finding when a processor frame is on the page and the card fields are not in it', () => {
    // The common half-migrated checkout. `cardFieldsAreFramed` claimed the
    // card inputs were inside a processor's frame and only ever established
    // that such a frame existed somewhere — and it withheld SEC-12, so this
    // page was reported clean on the criterion it was failing.
    expect(both.processorFramePresent).toBe(true);
    expect(both.collectsCardDetails).toBe(true);
    expect(rulesOf(both)).toContain('SEC-12');
    const finding = trustFindings(both, { payments: true }, ['e']).findings.find(
      (f) => f.ruleId === 'SEC-12',
    );
    expect(finding?.description).toMatch(/frame is also present/i);
  });

  it('says a criterion was not tested rather than letting the page tick it', () => {
    // A checkout lives at /checkout, and this criterion is read from the
    // landing page. For an owner who told us their application takes payments,
    // "no finding" is what a tick is made of.
    const noCheckout: TrustMeasurements = {
      ...good,
      collectsCardDetails: false,
      processorFramePresent: false,
      processorsPresent: [],
      checkoutObserved: false,
    };
    const outcome = trustFindings(noCheckout, { payments: true }, ['e']);
    expect(outcome.findings.some((f) => f.ruleId === 'SEC-12')).toBe(false);
    expect(outcome.notTested.map((entry) => entry.criterion)).toContain('SEC-12');
    expect(outcome.notTested[0]?.because).toMatch(/no checkout was found/i);
  });

  it('keeps the miner list short enough to be defensible', () => {
    // A long list assembled from a feed catches more and eventually accuses a
    // customer of hosting malware because a CDN they use once served something.
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const source = readFileSync('packages/engine/src/stages/trust-checks.ts', 'utf8');
    const hosts = /const MINER_HOSTS = \[([\s\S]*?)\]/.exec(source)![1]!;
    expect([...hosts.matchAll(/'/g)].length / 2).toBeLessThan(25);
    expect(source).toMatch(/narrow list is the defensible one/i);
  });
});

describe('what the visitor is now told', () => {
  const base = {
    appName: 'Kettle',
    assessedOn: '2026-09-18',
    depth: 'full' as const,
    gateFailures: [],
    findings: [],
    declared: { authentication: true, payments: true, personalData: true },
  };

  it('answers all nine questions for an assessment scored against 1.1.0', () => {
    const lines = assuranceFor({
      ...base,
      rubricVersion: '1.1.0',
      rubricCriteria: criteriaOf('1.1.0'),
    });
    expect(lines.filter((line) => line.state === 'not_tested')).toEqual([]);
    expect(lines).toHaveLength(ASSURANCE_CLAIMS.length);
  });

  it('still tells the truth about a badge earned against 1.0.0', () => {
    // An older badge does not silently acquire three answers it never had.
    const lines = assuranceFor({
      ...base,
      rubricVersion: '1.0.0',
      rubricCriteria: criteriaOf('1.0.0'),
    });
    const untested = lines.filter((line) => line.state === 'not_tested').map((l) => l.claim.id);
    expect(untested.sort()).toEqual(['hostile_code', 'payments', 'someone_there']);
  });
});
