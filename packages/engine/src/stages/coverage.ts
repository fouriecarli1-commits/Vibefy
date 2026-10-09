/**
 * What actually asks the question behind each published criterion — and the ten
 * that nothing asks.
 *
 * `stages/trust-checks.ts` states the rule this file exists to enforce, in its
 * own words: "a criterion that nothing checks does not produce a blank, it
 * produces a *pass*, for something nobody looked at. That is the one failure
 * this product cannot survive."
 *
 * Two members of that family were already closed. `assuranceFor` refuses a tick
 * for a criterion the rubric does not define; the pipeline refuses one for a
 * criterion a run could not reach. This is the third and nobody had written it:
 * a criterion the rubric defines, that every run reaches, and that no check and
 * no prompt has ever asked about. Scoring starts each dimension at full marks
 * and deducts for findings, so such a criterion is not merely unanswered — it is
 * a perfect score, awarded for silence.
 *
 * Measured on 2026-10-09 across rubric 1.1.0's forty-nine criteria:
 *
 *   · 19 are emitted by a deterministic check that runs on every application.
 *   · 5 more are emitted only by the game pass, which runs where the owner
 *     registered a game. For anything else they are unchecked, and three of
 *     them have no prompt either.
 *   · 17 are described to a model in one of the files under `prompts/`.
 *   · 3 are reported as unreachable without a test account by the pipeline.
 *   · 10 are in none of the above: seven on every assessment, and three more on
 *     every assessment of something that is not a game.
 *
 * docs/OPEN_ITEMS.md already recorded that 25 of the 49 have no deterministic
 * check. That sentence reads as "a model checks it instead", and for these ten
 * nothing does.
 *
 * The `prompt:` entries are the judgement in this file, and the reason each one
 * names its prompt rather than asserting coverage: the prompts carry no
 * criterion ids, so a reader has to open the named file and decide for
 * themselves that the sentence covers the criterion.
 * `tests/the-criteria-nobody-checks.test.ts` verifies everything else
 * mechanically against this repository.
 */

/**
 * Where the question behind each criterion is asked.
 *
 *   · `code`      — a deterministic check emits it, on every application.
 *   · `code:game` — only the game pass emits it, so only where the owner
 *                   registered a game. Each of these is in
 *                   `WITHOUT_A_CHECK_UNLESS_A_GAME` as well.
 *   · `prompt:id` — described to a model in `prompts/<id>.md`.
 *   · `sign-in`   — the pipeline reports it unreachable without a test account.
 *   · `none`      — nothing. Each of these is in `WITHOUT_A_CHECK`.
 */
export const CRITERION_COVERAGE: Readonly<Record<string, string>> = {
  'FI-01': 'prompt:functional-exploration',
  'FI-02': 'sign-in',
  'FI-03': 'prompt:functional-exploration',
  'FI-04': 'prompt:functional-exploration',
  'FI-05': 'prompt:functional-exploration',
  'FI-06': 'prompt:functional-exploration',
  'FI-07': 'sign-in',
  'FI-08': 'code:game',
  'SEC-01': 'code',
  'SEC-02': 'code',
  'SEC-03': 'code',
  'SEC-04': 'code',
  'SEC-05': 'code',
  'SEC-06': 'prompt:adversarial-practicality',
  'SEC-07': 'prompt:adversarial-practicality',
  'SEC-08': 'code',
  'SEC-09': 'prompt:adversarial-practicality',
  'SEC-10': 'code',
  'SEC-11': 'code',
  'SEC-12': 'code',
  'SEC-13': 'code',
  'PRI-01': 'code',
  'PRI-02': 'none',
  'PRI-03': 'sign-in',
  'PRI-04': 'none',
  'PRI-05': 'none',
  'PRI-06': 'none',
  'PRI-07': 'code',
  'UX-01': 'prompt:functional-exploration',
  'UX-02': 'code',
  'UX-03': 'code',
  'UX-04': 'code',
  'UX-05': 'prompt:functional-exploration',
  'UX-06': 'code',
  'UX-07': 'code',
  'PRD-01': 'none',
  'PRD-02': 'code',
  'PRD-03': 'none',
  'PRD-04': 'code',
  'PRD-05': 'code:game',
  'PRD-06': 'code:game',
  'STR-01': 'prompt:store-readiness',
  'STR-02': 'prompt:store-readiness',
  'STR-03': 'sign-in',
  'STR-04': 'prompt:store-readiness',
  'STR-05': 'prompt:store-readiness',
  'STR-06': 'prompt:store-readiness',
  'STR-07': 'prompt:store-readiness',
  'STR-08': 'none',
};

/**
 * Why each unchecked criterion is unchecked, in a sentence the owner reads.
 *
 * Written for the owner of the application rather than for us. An owner who
 * sees "not tested" beside a privacy criterion will otherwise read it as
 * something they failed, so each sentence says plainly that the gap is ours.
 */
export const WITHOUT_A_CHECK: Readonly<Record<string, string>> = {
  'PRI-02':
    'This engine does not compare a privacy policy’s wording against the network requests the application was observed making, so the two were not matched up. That is a gap in our assessment, not a finding about the application.',
  'PRI-04':
    'This engine does not enumerate third-party destinations and check them against what the policy discloses, so undisclosed transfers were neither found nor ruled out. That is a gap in our assessment, not a finding about the application.',
  'PRI-05':
    'This engine does not test whether tracking begins before consent is given, so nothing was established about it either way. That is a gap in our assessment, not a finding about the application.',
  'PRI-06':
    'This engine does not inspect addresses, browser storage and logs for personal data, so nothing was established about them. That is a gap in our assessment, not a finding about the application.',
  'PRD-01':
    'This engine does not run a performance measurement on a simulated mid-tier device, so no performance band was established. That is a gap in our assessment, not a finding about the application.',
  'PRD-03':
    'This engine cannot see whether error monitoring is installed, because that is a property of the server rather than of anything a visitor receives. It was not assessed.',
  'STR-08':
    'This engine does not look for an age rating or an in-app purchase disclosure, so nothing was established about either. That is a gap in our assessment, not a finding about the application.',
};

/**
 * The same, for criteria only the game pass measures.
 *
 * These three are genuinely checked where the owner registered a game, and
 * checked by nothing at all otherwise — no other pass emits them and no prompt
 * describes them. A web application that is not a game scored full marks on all
 * three, every time.
 */
export const WITHOUT_A_CHECK_UNLESS_A_GAME: Readonly<Record<string, string>> = {
  'FI-08':
    'This engine measures whether an application becomes interactive, and which input methods it supports, only where the owner registered it as a game. It was not measured here.',
  'PRD-05':
    'This engine looks for scalability red flags in observable behaviour only where the owner registered a game. Nothing was established about them here.',
  'PRD-06':
    'This engine measures time and transferred weight before an application is usable only where the owner registered a game. Neither was measured here.',
};

/** Every criterion this run has no way to answer, with the reason for each. */
export function withoutACheck(isGame: boolean): { criterion: string; because: string }[] {
  const entries = Object.entries(WITHOUT_A_CHECK);
  if (!isGame) entries.push(...Object.entries(WITHOUT_A_CHECK_UNLESS_A_GAME));
  return entries.map(([criterion, because]) => ({ criterion, because }));
}
