/**
 * Which rubric criteria something in this engine actually looks for.
 *
 * The verification page turns "no findings against this criterion" into a tick.
 * `trust-checks.ts` says so in its own header and calls a tick for something
 * nobody looked at "the one failure this product cannot survive".
 *
 * So the question is worth asking of the whole rubric rather than one criterion
 * at a time. Twenty-four of the forty-nine criteria in 1.1.0 are named by a
 * deterministic stage, which is code that either produces a finding or does
 * not. The other twenty-five can only be answered by a model stage, whose
 * `ruleId` is a free string the model picks — it is shown two examples and
 * never the list — so whether any particular one is ever examined is not a
 * property of this codebase.
 *
 * What that means for the tick is a decision for Anré, and it is written up in
 * `docs/OPEN_ITEMS.md`. What this file holds is the smaller thing that is not a
 * decision: the set does not shrink by accident. Delete the only check that
 * names SEC-02 and the criterion keeps ticking for every customer, silently,
 * with nothing anywhere saying a check went away.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface RubricFile {
  dimensions: { id: string; criteria: { id: string }[] }[];
}

const rubric = JSON.parse(
  readFileSync('packages/rubric/versions/1.1.0.json', 'utf8'),
) as RubricFile;

const allCriteria = rubric.dimensions.flatMap((dimension) =>
  dimension.criteria.map((criterion) => criterion.id),
);

/** Rule ids written as literals in the engine: a stage that names one looks for it. */
const named = (pattern: string) => {
  const out = execFileSync('grep', ['-rhoE', pattern, 'packages/engine/src', '--include=*.ts'], {
    encoding: 'utf8',
  });
  return [...new Set([...out.matchAll(/([A-Z]+-[0-9]+)/g)].map((match) => match[1]!))].sort();
};

/**
 * The criteria a deterministic stage answers today.
 *
 * Written out rather than computed, which is the whole point: a list computed
 * from the code can never disagree with the code. This is a record of what was
 * true when somebody last looked, and the test is the disagreement.
 */
const ANSWERED = [
  'FI-01',
  'FI-07',
  'FI-08',
  'PRD-02',
  'PRD-04',
  'PRD-05',
  'PRD-06',
  'PRI-01',
  'PRI-07',
  'SEC-01',
  'SEC-02',
  'SEC-03',
  'SEC-04',
  'SEC-05',
  'SEC-08',
  'SEC-10',
  'SEC-11',
  'SEC-12',
  'SEC-13',
  'UX-02',
  'UX-03',
  'UX-04',
  'UX-06',
  'UX-07',
];

describe('the criteria a deterministic stage answers', () => {
  it('is the set that was last looked at, and has not quietly shrunk', () => {
    const now = named("ruleId: '[A-Z]+-[0-9]+'");
    const gone = ANSWERED.filter((id) => !now.includes(id));
    expect(
      gone,
      `No stage names ${gone.join(', ')} any more. A criterion nothing looks for still renders as a tick on the verification page, so losing a check is not a quiet change. If the check really has gone, take the id out of ANSWERED and say why in DECISIONS.md.`,
    ).toEqual([]);
  });

  it('is the set that was last looked at, and has not quietly grown', () => {
    const now = named("ruleId: '[A-Z]+-[0-9]+'");
    const added = now.filter((id) => !ANSWERED.includes(id) && allCriteria.includes(id));
    expect(
      added,
      `${added.join(', ')} is answered now and was not. That is good news and still belongs in the list, because the list is what the open item in docs/OPEN_ITEMS.md is counted from.`,
    ).toEqual([]);
  });

  it('names nothing the rubric does not define', () => {
    // A stage producing a finding against a criterion that does not exist
    // scores against nothing and renders nowhere. It would be invisible.
    const now = named("ruleId: '[A-Z]+-[0-9]+'");
    expect(now.filter((id) => !allCriteria.includes(id))).toEqual([]);
  });

  it('is fewer than half the rubric, which is the fact the open item is about', () => {
    expect(ANSWERED.length).toBeLessThan(allCriteria.length);
    expect(allCriteria.length - ANSWERED.length).toBe(25);
  });
});
