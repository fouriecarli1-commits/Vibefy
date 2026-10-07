/**
 * The one field in the model's schema that is a free string.
 *
 * `findingSchema` enumerates `dimension` and it enumerates `severity`. `ruleId`
 * is `z.string()` with a description giving two examples — "for example SEC-05
 * or FI-01" — and nothing checks what comes back. Measured on 2026-10-07
 * against rubric 1.1.0, with one critical finding reading "a live credential is
 * readable in the client bundle":
 *
 *     SEC-04   found=[leaked_keys]   leaked_keys: shown as found
 *     SEC-4    found=[]              leaked_keys: a tick
 *     sec-04   found=[]              leaked_keys: a tick
 *     SEC-99   found=[]              leaked_keys: a tick
 *
 * `assuranceFor` matches a finding to a claim with `claim.criteria.includes`, so
 * an id that is not exactly a criterion id belongs to no claim, appears nowhere
 * on the page, and leaves the claim it should have contradicted reading
 * "checked, nothing found". One missing zero.
 *
 * `GATE-EXPOSED-SECRET` names `appliesToRules: ['SEC-04']`, so it does not fire
 * either. GATE-CRITICAL-SECURITY still does — it matches on dimension and
 * severity, both enumerated — so certification is still blocked. The score is
 * also unharmed, because `scoreDimension` filters on `finding.dimension`. What
 * is harmed is the only public surface a finding reaches.
 *
 * Two things are done about it here, and a third is not.
 *
 * `SEC-4` and `sec-04` are the same criterion written two ways, so they are
 * placed: trimmed, upper-cased, and the number padded to the width the rubric
 * uses. That recovers the realistic cases without inventing anything.
 *
 * An id that still matches nothing is kept and said out loud. It cannot be
 * dropped — the finding is real and its dimension scores it — and it cannot be
 * placed, because nothing says which criterion was meant. A note naming it is
 * the honest answer: somebody reading the run can see a finding exists that no
 * claim carries.
 *
 * What is *not* done is making `ruleId` an enum of the forty-nine criteria,
 * which would make this impossible rather than recoverable. That is "give the
 * model the list", which decision 803 recorded as Anré's to make, and this
 * measurement is the strongest argument for it yet — so it is in
 * `docs/OPEN_ITEMS.md` beside the coverage count rather than done here.
 */
import { describe, expect, it } from 'vitest';
import { placeCriteria } from '../packages/engine/src/pipeline.ts';
import { assuranceFor, type AssuranceInput } from '../packages/assurance/src/index.ts';
import { getRubric } from '../packages/rubric/src/rubric.ts';
import type { RawFinding } from '../packages/engine/src/stages/types.ts';

const criteria = getRubric('1.1.0').dimensions.flatMap((dimension) =>
  dimension.criteria.map((criterion) => criterion.id),
);

const leak = (ruleId: string): RawFinding => ({
  ruleId,
  dimension: 'security_posture',
  severity: 'critical',
  confidence: 'high',
  title: 'A live credential is readable in the client bundle',
  description: 'The key is in the JavaScript the browser downloads.',
  remediation: 'Rotate it, then move it behind your server.',
  evidenceIds: ['e1'],
});

describe('an id written a different way', () => {
  it('places a missing zero', () => {
    const { placed } = placeCriteria([leak('SEC-4')], criteria);
    expect(placed[0]!.ruleId).toBe('SEC-04');
  });

  it('places the wrong case', () => {
    const { placed } = placeCriteria([leak('sec-04')], criteria);
    expect(placed[0]!.ruleId).toBe('SEC-04');
  });

  it('places surrounding space', () => {
    const { placed } = placeCriteria([leak('  SEC-04 ')], criteria);
    expect(placed[0]!.ruleId).toBe('SEC-04');
  });

  it('says which ones it corrected, rather than correcting them quietly', () => {
    const { corrected } = placeCriteria([leak('SEC-4'), leak('FI-1')], criteria);
    expect(corrected).toEqual([
      { from: 'SEC-4', to: 'SEC-04' },
      { from: 'FI-1', to: 'FI-01' },
    ]);
  });

  it('leaves an id that was already right alone, and reports no correction', () => {
    const { placed, corrected, unplaceable } = placeCriteria([leak('SEC-04')], criteria);
    expect(placed[0]!.ruleId).toBe('SEC-04');
    expect(corrected).toEqual([]);
    expect(unplaceable).toEqual([]);
  });
});

describe('an id that means nothing', () => {
  it('is not dropped — the finding is real and its dimension scores it', () => {
    const { placed } = placeCriteria([leak('SEC-99')], criteria);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.ruleId).toBe('SEC-99');
  });

  it('is named, so a finding no claim carries is visible', () => {
    const { unplaceable } = placeCriteria([leak('SEC-99')], criteria);
    expect(unplaceable).toEqual(['SEC-99']);
  });

  it('is named once however many findings carry it', () => {
    const { unplaceable } = placeCriteria([leak('SEC-99'), leak('SEC-99')], criteria);
    expect(unplaceable).toEqual(['SEC-99']);
  });

  it('does not invent a criterion out of a number that happens to exist', () => {
    // The direction this fix fails in: padding or truncating until something
    // matches. SEC-4 and SEC-04 are the same id written two ways; SEC-99 and
    // SEC-09 are two different criteria, one of which does not exist.
    const { placed } = placeCriteria([leak('SEC-099')], criteria);
    expect(placed[0]!.ruleId).toBe('SEC-099');
  });
});

describe('what it is worth on the page', () => {
  const base: AssuranceInput = {
    appName: 'Kettle',
    assessedOn: '2026-10-07',
    rubricVersion: '1.1.0',
    depth: 'full',
    gateFailures: [],
    findings: [],
    rubricCriteria: criteria,
    declared: { authentication: true, payments: true, personalData: true },
  };

  const leakedKeys = (findings: readonly RawFinding[]) =>
    assuranceFor({ ...base, findings: [...findings] }).find(
      (line) => line.claim.id === 'leaked_keys',
    )!;

  it('is a tick before the id is placed, which is the whole defect', () => {
    // Kept as a test rather than described, because it is the state the product
    // was in and it should be visible.
    expect(leakedKeys([leak('SEC-4')]).state).toBe('checked_clear');
  });

  it('is shown as found after', () => {
    const { placed } = placeCriteria([leak('SEC-4')], criteria);
    expect(leakedKeys(placed).state).toBe('checked_found');
  });
});
