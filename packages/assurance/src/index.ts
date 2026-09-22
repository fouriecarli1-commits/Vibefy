/**
 * What the badge means to the person who clicked it.
 *
 * Everything else in this product is written for the owner of an application:
 * dimensions, criteria, severities, a score out of a hundred. The visitor who
 * clicks a mark on a stranger's website is not that person. They are about to
 * type their email address into something a friend sent them, and they have one
 * question — *is this all right?*
 *
 * A score of 88.6 does not answer it. Neither does "security posture". So this
 * file turns an assessment into the questions somebody actually asks, in the
 * words they would use, and answers each one with what was checked and what was
 * found on a stated date.
 *
 * ## The line this cannot cross
 *
 * Anré asked for a tick list telling a visitor the application is sound, free
 * of hostile code and in line with the law. That list would be worth nothing,
 * and not because a rule forbids it: **it is the same list every scam publishes
 * about itself, in the same words.** A sceptical visitor has read those exact
 * superlatives on the worst sites on the internet, which is precisely why they
 * are looking for a second opinion in the first place.
 *
 * What they have never seen is somebody willing to say what they tested, when,
 * what they found, and what they did not look at. So every line here has the
 * same shape:
 *
 *     the question · what was checked · what was found · what this does not mean
 *
 * A tick means "we looked for this and did not find it on that date". It never
 * means "this cannot happen". The difference is the entire product, and a
 * visitor who understands it is worth ten who were told a comforting thing.
 *
 * ## Why some lines say nothing
 *
 * `not_tested` is a first-class answer and is shown as prominently as a tick.
 * A list that silently drops the questions it cannot answer is a list that
 * lies by omission, and it is the specific way assurance seals go wrong: the
 * reader assumes the absent line was fine.
 */
/**
 * Severity, spelled out here rather than imported from the rubric package.
 *
 * This package must not depend on the scoring code: a list written for a
 * visitor has no business being able to reach the arithmetic that produces a
 * score, and the one-way dependency is what keeps it that way.
 */
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type AssuranceState = 'checked_clear' | 'checked_found' | 'not_tested';

export type AssessmentDepth = 'limited' | 'full' | 'continuous';

export interface AssuranceFinding {
  readonly ruleId: string;
  readonly severity: FindingSeverity;
}

export interface AssuranceInput {
  readonly appName: string;
  readonly assessedOn: string;
  readonly rubricVersion: string;
  readonly depth: AssessmentDepth;
  /** Gate ids the assessment failed, from `assessments.gate_failures`. */
  readonly gateFailures: readonly string[];
  /**
   * Every criterion the rubric version this was scored against actually
   * defines.
   *
   * This exists to stop the one bug that would make the whole list worthless.
   * A question whose criteria are not in the rubric produces no findings — and
   * without this, "no findings" renders as a tick. The visitor would be shown a
   * tick for something nobody ever looked at, which is worse than showing them
   * nothing, and it is the exact failure mode of every assurance seal that has
   * ever been embarrassing.
   *
   * So a criterion the rubric does not define is not a pass. It is "not
   * tested", said out loud, until the rubric has a check for it.
   */
  readonly rubricCriteria: readonly string[];
  /**
   * Criteria this particular run did not answer, with the reason.
   *
   * `rubricCriteria` above stops a tick for a criterion the rubric does not
   * define. This stops the other half of the same failure: a criterion the
   * rubric defines that this run could not reach. The question that asks where
   * a card number goes is read from the landing page, and a checkout lives at
   * /checkout — so for most applications that take payments nothing looked, and
   * "no findings" printed a tick.
   */
  readonly notTested?: readonly { readonly criterion: string; readonly because: string }[];
  /** Published findings only. A withheld finding was never told to the owner. */
  readonly findings: readonly AssuranceFinding[];
  /**
   * What the owner told us their application does.
   *
   * Claims we go looking to confirm, never facts we take on trust — and used
   * here only to decide whether a question applies at all. An application whose
   * owner says it takes no payments still gets the payment question; it gets it
   * answered "there was no payment flow to test", which is a different sentence
   * from a tick.
   */
  readonly declared: {
    readonly authentication: boolean;
    readonly payments: boolean;
    readonly personalData: boolean;
  };
}

export interface AssuranceClaim {
  readonly id: string;
  /** The question in the visitor's words. */
  readonly question: string;
  /** What we did, past tense, specific. Shown whatever the answer turns out to be. */
  readonly whatWeChecked: string;
  /** What this line does not mean. Shown on a tick as loudly as on a cross. */
  readonly limitation: string;
  /** The published criteria that answer it. */
  readonly criteria: readonly string[];
  /** A gate that, when failed, makes this a finding whatever the criteria say. */
  readonly gate?: string;
  /** False when the question does not apply, with the reason shown in its place. */
  applies?(input: AssuranceInput): boolean;
  /** Why it was not tested, when it was not. */
  notTested?(input: AssuranceInput): string | null;
}

/**
 * The questions.
 *
 * Ordered by what a visitor worries about first, which is not the order the
 * rubric is written in. Nobody's first thought is "production readiness".
 */
export const ASSURANCE_CLAIMS: readonly AssuranceClaim[] = [
  {
    id: 'account_takeover',
    question: 'Could somebody else get into my account?',
    whatWeChecked:
      'We signed in with a test account and tried the ways accounts are usually taken over: session cookies a script can read, pages that check who you are in the browser but not on the server, and endpoints that answer without asking who is calling.',
    limitation:
      'We tried the common ways, not every way. Somebody with more time, or with access we did not have, may find one we did not.',
    criteria: ['SEC-03', 'SEC-05', 'SEC-07', 'SEC-09'],
    gate: 'GATE-CRITICAL-SECURITY',
    applies: (input) => input.declared.authentication,
    notTested: (input) =>
      !input.declared.authentication
        ? 'This application has no sign-in, so there is no account to take over.'
        : input.depth === 'limited'
          ? 'A free assessment does not include the pass that tries this. The owner can ask for one that does.'
          : null,
  },
  {
    id: 'other_peoples_data',
    question: 'Could I end up seeing somebody else’s data — or them seeing mine?',
    whatWeChecked:
      'We changed the identifiers in addresses the application uses, called its endpoints as a different user, and looked at whether anything that should be private came back.',
    limitation:
      'Only within the parts the owner authorised us to test. Anything we were not permitted to reach was not examined.',
    criteria: ['SEC-06', 'SEC-11', 'PRI-06'],
    gate: 'GATE-CRITICAL-SECURITY',
    notTested: (input) =>
      input.depth === 'limited'
        ? 'A free assessment does not include the pass that tries this. The owner can ask for one that does.'
        : null,
  },
  {
    id: 'leaked_keys',
    question: 'Is the application leaking its own passwords and keys?',
    // The criterion's own published label is "no live credential in client
    // bundles, source maps or repository history", and this sentence promised
    // only the first two — because the repository half had never run. It does
    // now, where one is authorised, and the wording says which.
    whatWeChecked:
      'We read everything the application sends to a browser and searched it for live credentials, and where a repository was authorised we read its source and searched that too. These are the keys that let somebody spend the owner’s money or read their database, and this is the most common serious defect in software built quickly.',
    limitation:
      'We searched what a browser receives, and the source of a repository where one was authorised. A key held somewhere we cannot see is neither found nor ruled out.',
    criteria: ['SEC-04'],
    gate: 'GATE-EXPOSED-SECRET',
  },
  {
    id: 'connection',
    question: 'Is what I type protected on the way there?',
    whatWeChecked:
      'We checked that the whole site is served over an encrypted connection, that it refuses an unencrypted one, and that no part of a page arrives unencrypted inside an encrypted one.',
    limitation:
      'This is about the journey, not the destination. Encryption says nothing about what happens to your data after it arrives.',
    criteria: ['SEC-01', 'SEC-02'],
  },
  {
    id: 'what_they_collect',
    question: 'Do they say what they collect — and can I get my account deleted?',
    whatWeChecked:
      'We opened the privacy policy, compared what it says against what the application was observed sending, and looked for a route a user can actually follow to delete their account.',
    limitation:
      'This is not a legal opinion. We are not lawyers, and nothing here says the application complies with POPIA, the GDPR, or any other law — only that these documents and routes were present and matched what we saw.',
    criteria: ['PRI-01', 'PRI-02', 'PRI-03', 'PRI-04', 'PRI-05'],
    gate: 'GATE-CRITICAL-SECURITY',
  },
  {
    id: 'payments',
    question: 'If I pay, does my card go to a proper payment company?',
    whatWeChecked:
      'We looked at where a card number goes when it is typed in: to a payment company that is set up to hold one, or to the application’s own server.',
    limitation:
      'We looked at how the payment is taken, not at whether the business behind it will deliver. A correctly built checkout can still belong to somebody who does not send the goods.',
    criteria: ['SEC-12'],
    applies: (input) => input.declared.payments,
    notTested: (input) =>
      !input.declared.payments
        ? 'The owner says this application takes no payments, and we found no checkout to test.'
        : null,
  },
  {
    id: 'hostile_code',
    question: 'Is it running anything it should not be?',
    whatWeChecked:
      'We recorded every script the page loaded and where each came from, and checked them against known cryptominers and known malicious hosts. We also checked the application’s declared dependencies for advisories rated critical.',
    limitation:
      'This finds code that is already known to be hostile. It is not an antivirus scan, it cannot see code that has never been reported, and it says nothing about what the application does on its own server.',
    criteria: ['SEC-13', 'SEC-10'],
  },
  {
    id: 'someone_there',
    question: 'Is there a real person to contact if something goes wrong?',
    whatWeChecked:
      'We looked for a way to reach a human that a visitor could find without signing in: an address that is not a no-reply, a telephone number, or a named company behind the site.',
    limitation:
      'Finding an address is not the same as somebody answering it. We checked that a route is published, not that it works.',
    criteria: ['PRI-07'],
  },
  {
    id: 'usable',
    question: 'Will it actually work when I use it?',
    whatWeChecked:
      'We worked through the application’s main path from beginning to end, on a desktop and at the width of a phone, with a keyboard only, and we read what it says when something goes wrong.',
    limitation:
      'We used it the way a careful visitor would on one day. It is not a guarantee that it works for everybody, on every device, tomorrow.',
    criteria: ['FI-01', 'FI-03', 'FI-04', 'UX-02', 'UX-03', 'UX-04', 'UX-06'],
  },
];

export interface AssuranceLine {
  readonly claim: AssuranceClaim;
  readonly state: AssuranceState;
  /** Published findings against this claim's criteria, worst first. */
  readonly findings: readonly AssuranceFinding[];
  /** Present only when `state` is `not_tested`. */
  readonly notTestedBecause: string | null;
  /** True when a gate — not a finding — is what made this a problem. */
  readonly gateFailed: boolean;
}

const SEVERITY_ORDER: Readonly<Record<FindingSeverity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * The list, for one assessment.
 *
 * Note what this function cannot do: there is no argument for a plan, a price
 * or a payment, and no branch anywhere that looks at one. A paying customer and
 * a free one with identical findings get identical lists, which is the same
 * property the scoring code has and is checked the same way.
 */
export function assuranceFor(input: AssuranceInput): AssuranceLine[] {
  return ASSURANCE_CLAIMS.map((claim) => {
    const applies = claim.applies?.(input) ?? true;
    /*
     * Any missing criterion, not all of them.
     *
     * Caught by rendering the page rather than by reading the code: the
     * question "is it running anything it should not be?" has two criteria, one
     * of which rubric 1.0.0 defines and one of which it does not. Requiring
     * *all* of them to be missing gave it a tick on the strength of the half we
     * do check — under a sentence promising we had checked every script against
     * known cryptominers, which we had not.
     *
     * A claim's description covers all of its criteria, so if one is missing
     * the description is false and the tick is a lie. There is no partial tick,
     * because a visitor cannot be expected to work out which half of a sentence
     * was true.
     */
    const unknown = claim.criteria.filter((id) => !input.rubricCriteria.includes(id));
    /*
     * The same rule for a criterion the run did not reach.
     *
     * The paragraph above is about a rubric with no check for something. This
     * is about a run that had the check and did not get to use it — the
     * question about where a card number goes is read from the landing page,
     * and a checkout is at /checkout. One missing criterion falsifies the
     * claim's sentence exactly as before, and there is still no partial tick.
     */
    const unreached = (input.notTested ?? []).filter((entry) =>
      claim.criteria.includes(entry.criterion),
    );
    const reason =
      unknown.length > 0
        ? `Rubric version ${input.rubricVersion} has no check for ${unknown.length === claim.criteria.length ? 'this' : 'part of this'} yet, so it was not tested. It is not a pass.`
        : unreached.length > 0
          ? `${unreached[0]!.because} It is not a pass.`
          : (claim.notTested?.(input) ?? null);

    if (!applies || reason) {
      return {
        claim,
        state: 'not_tested' as const,
        findings: [],
        notTestedBecause:
          reason ?? 'This question does not apply to this application, so it was not tested.',
        gateFailed: false,
      };
    }

    const findings = input.findings
      .filter((finding) => claim.criteria.includes(finding.ruleId))
      // `info` is an observation that scores nothing. It is not a problem and
      // must not turn a tick into a cross, or every page with eleven type sizes
      // would be reported to a visitor as a defect.
      .filter((finding) => finding.severity !== 'info')
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

    const gateFailed = claim.gate !== undefined && input.gateFailures.includes(claim.gate);

    return {
      claim,
      state:
        findings.length > 0 || gateFailed ? ('checked_found' as const) : ('checked_clear' as const),
      findings,
      notTestedBecause: null,
      gateFailed,
    };
  });
}

/**
 * The three steps, which are a fact about us rather than about the application.
 *
 * This is the part of the list that is always true and always the same, and it
 * is the part a visitor has least reason to believe without being told. "An
 * automated tool gave it a tick" is worth very little; "nobody could start this
 * without proving they own the site, and a person read the result before
 * anything was issued" is worth something, and it is exactly what happened.
 */
export const VERIFICATION_STEPS = [
  {
    step: 1,
    title: 'They proved they own it',
    body: 'Before anything was opened, the owner had to place a record we specified in the application’s own DNS or on its own server — something only somebody who controls it can do. Nothing runs against an application without that, and it is checked again at the moment a run starts.',
  },
  {
    step: 2,
    title: 'It was tested against a rubric anybody can read',
    body: 'Not a private checklist. The rubric is published in full, with every criterion, every weight and the arithmetic that turns findings into a score. Two applications with the same findings get the same score, and you can check the sum yourself.',
  },
  {
    step: 3,
    title: 'A person read the result before anything was issued',
    body: 'Every finding, and the evidence behind it, was reviewed by a human being who could reject it. No badge has ever been issued by software alone, and the database refuses to record one without a named reviewer.',
  },
] as const;

/** The sentence that has to travel with the list, quoted rather than paraphrased. */
export const ASSURANCE_LEGEND =
  'Each line says what was tested on a stated date and what was found. A tick means we looked for something and did not find it — not that it cannot happen, and not that the application is secure, lawful or free of defects. Absence of a finding is not evidence of absence. Nothing here is a guarantee, and no third party should rely on it.';

/** What the badge is worth to somebody who just clicked it, in one sentence. */
export function assuranceHeadline(input: AssuranceInput, lines: readonly AssuranceLine[]): string {
  const tested = lines.filter((line) => line.state !== 'not_tested').length;
  const found = lines.filter((line) => line.state === 'checked_found').length;

  if (found === 0) {
    return `On ${input.assessedOn} we checked ${input.appName} against ${tested} of the questions below and did not find a problem with any of them. That is what this mark means, and it is all it means.`;
  }
  return `On ${input.assessedOn} we checked ${input.appName} against ${tested} of the questions below. ${found === 1 ? 'One' : found} of them turned something up, and it is listed as plainly as the rest.`;
}
