/**
 * Ten criteria we publish, score and have never once looked at.
 *
 * `packages/engine/src/stages/trust-checks.ts` says it first, about the three
 * criteria that file was written to answer: "a criterion that nothing checks
 * does not produce a blank, it produces a *pass*, for something nobody looked
 * at. That is the one failure this product cannot survive."
 *
 * Two members of that family were already closed. `assuranceFor` refuses a tick
 * for a criterion the rubric does not define, and the pipeline refuses one for a
 * criterion a run could not reach. The third was open: a criterion the rubric
 * defines, that every run reaches, and that no code and no prompt asks a
 * question about.
 *
 * Measured on 2026-10-09 over rubric 1.1.0's forty-nine criteria. Nineteen are
 * emitted by a check that runs on every application; five more only by the game
 * pass; seventeen are described to a model in `prompts/`; three are reported
 * unreachable without a test account. Ten are in none of those: seven always,
 * and three more for anything the owner did not register as a game.
 *
 * Scoring starts each dimension at full marks and deducts for findings, so those
 * ten did not go unanswered — they scored perfectly, every time. Four of them
 * sit under published questions a visitor reads: three under the privacy
 * question and one under the question about seeing somebody else's data.
 *
 * This holds the measurement in place. A criterion added to the rubric with
 * nothing behind it fails here rather than ticking quietly for a year.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CRITERION_COVERAGE,
  WITHOUT_A_CHECK,
  WITHOUT_A_CHECK_UNLESS_A_GAME,
  withoutACheck,
} from '../packages/engine/src/stages/coverage.ts';
import { getRubric } from '../packages/rubric/src/index.ts';
import { ASSURANCE_CLAIMS } from '../packages/assurance/src/index.ts';

const root = join(import.meta.dirname, '..');

const CRITERION_IDS = getRubric('1.1.0').dimensions.flatMap((dimension) =>
  dimension.criteria.map((criterion) => criterion.id),
);

/**
 * Criteria an actual check emits, read off `ruleId:` in the source.
 *
 * Read rather than declared, so a `code` entry in the map is a measurement of
 * this repository and not a memory of it.
 *
 * Membership of a `_CRITERIA` list constant is not a check — those lists say
 * which criteria a pass is responsible for reporting as unreached when it
 * fails. Counting them as coverage is how five game-only criteria looked
 * checked for every web application, so this reads the emitters themselves.
 */
const emitters = new Map<string, Set<string>>();
for (const file of [
  ...readdirSync(join(root, 'packages/engine/src/stages'))
    .filter((name) => name.endsWith('.ts') && name !== 'coverage.ts')
    .map((name) => join('packages/engine/src/stages', name)),
  'packages/engine/src/pipeline.ts',
]) {
  const source = readFileSync(join(root, file), 'utf8');
  for (const match of source.matchAll(/ruleId: '([A-Z]{2,3}-\d{2})'/g)) {
    const seen = emitters.get(match[1]!) ?? new Set<string>();
    seen.add(file.split('/').pop()!);
    emitters.set(match[1]!, seen);
  }
}

const PROMPT_IDS = new Set(
  readdirSync(join(root, 'prompts'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.replace(/\.md$/, '')),
);

describe('the coverage map', () => {
  it('covers the published rubric exactly, with no spare entries', () => {
    expect(Object.keys(CRITERION_COVERAGE).sort()).toEqual([...CRITERION_IDS].sort());
  });

  it('has a check on every application where it claims one', () => {
    for (const [criterion, where] of Object.entries(CRITERION_COVERAGE)) {
      if (where !== 'code') continue;
      const files = emitters.get(criterion);
      expect(
        files,
        `${criterion} is recorded as checked in code and nothing emits it. The consequence is a ` +
          'criterion that scores full marks because nothing can deduct for it.',
      ).toBeDefined();
      expect(
        [...files!].some((file) => file !== 'game-checks.ts'),
        `${criterion} is emitted only by the game pass, so it is unchecked for every application ` +
          'that is not a game. Record it as `code:game` and give it a sentence in ' +
          'WITHOUT_A_CHECK_UNLESS_A_GAME.',
      ).toBe(true);
    }
  });

  it('is honest about the five only a game is measured against', () => {
    for (const [criterion, where] of Object.entries(CRITERION_COVERAGE)) {
      if (where !== 'code:game') continue;
      expect([...(emitters.get(criterion) ?? [])]).toEqual(['game-checks.ts']);
    }
  });

  it('is measured where it claims nothing checks it', () => {
    for (const [criterion, where] of Object.entries(CRITERION_COVERAGE)) {
      if (where !== 'none') continue;
      expect(
        emitters.has(criterion),
        `${criterion} is recorded as unchecked and something emits it. If a check was built, move ` +
          'it to `code` and delete its sentence — a run that both checks a criterion and reports ' +
          'it untested tells the owner two different things.',
      ).toBe(false);
    }
  });

  it('is in BEHIND_A_SIGN_IN where it claims the pipeline reports it unreachable', () => {
    // The fourth value, verified like the others rather than trusted. A
    // criterion recorded as `sign-in` that the pipeline does not actually
    // report is a criterion nothing says anything about.
    const pipeline = readFileSync(join(root, 'packages/engine/src/pipeline.ts'), 'utf8');
    const behind = pipeline.slice(pipeline.indexOf('const BEHIND_A_SIGN_IN'));
    const listed = new Set(
      [...behind.slice(0, behind.indexOf(']')).matchAll(/'([A-Z]{2,3}-\d{2})'/g)].map(
        (match) => match[1]!,
      ),
    );
    for (const [criterion, where] of Object.entries(CRITERION_COVERAGE)) {
      if (where !== 'sign-in') continue;
      expect(
        listed.has(criterion),
        `${criterion} is recorded as reported unreachable without a test account, and ` +
          'BEHIND_A_SIGN_IN does not list it.',
      ).toBe(true);
    }
    expect([...listed].sort()).toEqual(
      Object.entries(CRITERION_COVERAGE)
        .filter(([, where]) => where === 'sign-in')
        .map(([criterion]) => criterion)
        .sort(),
    );
  });

  it('uses no value but the five this file documents', () => {
    for (const [criterion, where] of Object.entries(CRITERION_COVERAGE)) {
      expect(
        where === 'code' ||
          where === 'code:game' ||
          where === 'sign-in' ||
          where === 'none' ||
          where.startsWith('prompt:'),
        `${criterion} is recorded as "${where}", which nothing verifies`,
      ).toBe(true);
    }
  });

  it('names a prompt that exists, where it claims a model is asked', () => {
    for (const [criterion, where] of Object.entries(CRITERION_COVERAGE)) {
      if (!where.startsWith('prompt:')) continue;
      const promptId = where.slice('prompt:'.length);
      expect(
        PROMPT_IDS.has(promptId),
        `${criterion} names prompt "${promptId}", which does not exist`,
      ).toBe(true);
    }
  });

  it('has a sentence for the owner for every criterion nothing checks', () => {
    const unchecked = Object.entries(CRITERION_COVERAGE)
      .filter(([, where]) => where === 'none')
      .map(([criterion]) => criterion);
    expect(Object.keys(WITHOUT_A_CHECK).sort()).toEqual([...unchecked].sort());

    const gameOnly = Object.entries(CRITERION_COVERAGE)
      .filter(([, where]) => where === 'code:game')
      .map(([criterion]) => criterion);
    expect(Object.keys(WITHOUT_A_CHECK_UNLESS_A_GAME).sort()).toEqual([...gameOnly].sort());

    for (const [criterion, because] of Object.entries({
      ...WITHOUT_A_CHECK,
      ...WITHOUT_A_CHECK_UNLESS_A_GAME,
    })) {
      expect(because.length, `${criterion} needs a real sentence`).toBeGreaterThan(80);
      // Said to be ours. "Not tested" beside a privacy criterion otherwise
      // reads to an owner as something they failed.
      expect(because, `${criterion} must not read as a finding about the application`).toMatch(
        /this engine (does not|cannot|measures|looks)/i,
      );
    }
  });

  it('is ten for an ordinary application and seven for a game', () => {
    // Pinned on purpose. This list shrinking is good news and should be a
    // visible commit; it growing means a criterion was published with nothing
    // behind it, and that must not happen quietly.
    expect(
      withoutACheck(false)
        .map((entry) => entry.criterion)
        .sort(),
    ).toEqual([
      'FI-08',
      'PRD-01',
      'PRD-03',
      'PRD-05',
      'PRD-06',
      'PRI-02',
      'PRI-04',
      'PRI-05',
      'PRI-06',
      'STR-08',
    ]);
    expect(
      withoutACheck(true)
        .map((entry) => entry.criterion)
        .sort(),
    ).toEqual(['PRD-01', 'PRD-03', 'PRI-02', 'PRI-04', 'PRI-05', 'PRI-06', 'STR-08']);
  });
});

describe('what the published questions say they did', () => {
  /**
   * No sentence may describe acting as a signed-in user.
   *
   * The engine is no user at all: nothing sets `syntheticCredentials`, there is
   * no sign-in tool, and `fill` refuses a password it was not given. Two
   * sentences asserted otherwise — one said "We signed in with a test account",
   * the other "called its endpoints as a different user" — and both were
   * printed beside a tick.
   */
  const CANNOT_HAVE_HAPPENED: readonly RegExp[] = [
    /\bwe (signed|logged) in\b/i,
    /\bas a (different|second|another) user\b/i,
    /\bsigned in as\b/i,
  ];

  it('claims nothing that requires a session this engine has never had', () => {
    for (const claim of ASSURANCE_CLAIMS) {
      const said = `${claim.whatWeChecked} ${claim.limitation}`;
      for (const forbidden of CANNOT_HAVE_HAPPENED) {
        expect(
          said,
          `${claim.id} tells the reader we acted from inside a session. This engine signs in to ` +
            'nothing. Describe what the checks actually do.',
        ).not.toMatch(forbidden);
      }
    }
  });

  it('does not promise a comparison nothing performs', () => {
    // PRI-02 and PRI-04 are the policy-against-traffic comparison, and both are
    // in WITHOUT_A_CHECK. The privacy question used to describe doing it.
    const privacy = ASSURANCE_CLAIMS.find((claim) => claim.id === 'what_they_collect')!;
    expect(privacy.whatWeChecked).not.toMatch(/compared what it says against/i);
    expect(privacy.criteria).toContain('PRI-02');
  });
});
