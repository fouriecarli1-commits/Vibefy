/**
 * The rubric says how a finding is evidenced, and nothing read the field.
 *
 * `requiredEvidence` is published: it is in `packages/rubric/versions`, it is
 * in the migration that publishes the rubric to the database, and a customer
 * can read it. FI-02 — "sign-up and sign-in succeed and persist across
 * refresh" — says it is evidenced by a `playwright_trace`.
 *
 * The only test on the field asserted that every criterion names at least one
 * kind, which checks that it is populated rather than honoured. Meanwhile the
 * stage that answers most of the nine criteria naming a trace opens a browser,
 * starts tracing, and discards it in `close()`: only the deterministic pass
 * calls `captureTrace`. One stage of four kept the promise and nobody looked.
 *
 * What is held here: that the shortfall is detected, that it is not detected
 * where there is none, that it does not cost the customer the finding, and
 * that the rubric really does name a trace for the criteria this is about —
 * read from the rubric rather than written down here, because a list of
 * criteria in a test file is the thing that goes stale.
 */
import { describe, expect, it } from 'vitest';
import { evidenceShortfall } from '../packages/engine/src/pipeline.ts';
import { getRubric } from '../packages/rubric/src/index.ts';

const RUBRIC = '1.1.0';

const kinds = (map: Record<string, string>) => (id: string) => map[id];

describe('what the rubric asks for', () => {
  it('names a browser trace for the sign-in criterion, which is where this started', () => {
    // The positive control, and the reason this test file exists at all. If
    // the rubric stops requiring a trace, this fails and the rest of the file
    // is answering a question nobody asked any more.
    const criteria = getRubric(RUBRIC).dimensions.flatMap((dimension) => dimension.criteria);
    const signIn = criteria.find((criterion) => criterion.id === 'FI-02');
    expect(signIn?.requiredEvidence).toContain('playwright_trace');
    const wantingATrace = criteria.filter((criterion) =>
      criterion.requiredEvidence.includes('playwright_trace'),
    );
    expect(wantingATrace.length).toBeGreaterThan(1);
  });
});

describe('a finding evidenced by less than the rubric names', () => {
  it('is reported as a shortfall, by criterion', () => {
    const shortfall = evidenceShortfall(
      [{ ruleId: 'FI-02', evidenceIds: ['ev-1'] }],
      kinds({ 'ev-1': 'screenshot' }),
      RUBRIC,
    );
    expect(shortfall).toEqual([{ criterion: 'FI-02', missing: ['playwright_trace'] }]);
  });

  it('is silent when the finding carries what was asked for', () => {
    // The over-correction worth its own case: a note on every report saying
    // the evidence is short would be noise that teaches a customer to skip
    // the notes, which is where the honest sentences live.
    expect(
      evidenceShortfall(
        [{ ruleId: 'FI-02', evidenceIds: ['ev-1'] }],
        kinds({ 'ev-1': 'playwright_trace' }),
        RUBRIC,
      ),
    ).toEqual([]);
  });

  it('says what is missing when a criterion names two kinds and one is there', () => {
    // FI-01 names a trace and a screenshot. Carrying one of the two is not the
    // same as carrying neither, and a sentence that said "FI-01 names
    // playwright_trace and screenshot" when the screenshot is attached would
    // be wrong in a way a reviewer would notice before a customer did.
    const shortfall = evidenceShortfall(
      [{ ruleId: 'FI-01', evidenceIds: ['ev-1'] }],
      kinds({ 'ev-1': 'screenshot' }),
      RUBRIC,
    );
    expect(shortfall).toEqual([{ criterion: 'FI-01', missing: ['playwright_trace'] }]);
  });

  it('groups ten findings against one criterion into one sentence', () => {
    const shortfall = evidenceShortfall(
      Array.from({ length: 10 }, () => ({ ruleId: 'FI-02', evidenceIds: ['ev-1'] })),
      kinds({ 'ev-1': 'screenshot' }),
      RUBRIC,
    );
    expect(shortfall).toHaveLength(1);
  });

  it('ignores a criterion the rubric does not know', () => {
    // An unplaceable criterion id is already reported by `placeCriteria`, which
    // says so in its own sentence. Two notes about one defect read as two
    // defects.
    expect(evidenceShortfall([{ ruleId: 'NOPE-99', evidenceIds: [] }], kinds({}), RUBRIC)).toEqual(
      [],
    );
  });

  it('counts an evidence id nothing can resolve as carrying nothing', () => {
    // `enforceEvidence` already drops a finding citing an id we never minted,
    // so this should not arise — and if it does, the honest reading of an id
    // that resolves to no artefact is that no artefact is attached.
    const shortfall = evidenceShortfall(
      [{ ruleId: 'FI-02', evidenceIds: ['ev-missing'] }],
      kinds({}),
      RUBRIC,
    );
    expect(shortfall).toEqual([{ criterion: 'FI-02', missing: ['playwright_trace'] }]);
  });
});
