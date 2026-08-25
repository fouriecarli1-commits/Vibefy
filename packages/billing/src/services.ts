/**
 * What each plan actually gets you, at length.
 *
 * The one-line summary in `config/pricing.json` is what fits on a card. This is
 * what somebody reads before spending money, and it answers the four questions
 * a one-liner cannot:
 *
 *   · What happens, step by step, after I pay?
 *   · How long does it take?
 *   · What is **not** included?
 *   · How do I stop?
 *
 * The third and fourth are the ones most products leave out, and they are the
 * two this product exists to complain about elsewhere. A service description
 * that lists only what you get is a sales page pretending to be an explanation.
 *
 * Nothing here can reach a score. `packages/rubric` cannot import this package
 * at all — the independence test fails the build if it ever does.
 */

export interface ServiceDetail {
  readonly tierId: string;
  /** What it is, in one sentence, for someone who has not read the card. */
  readonly plainly: string;
  /** What happens after payment, in order, with honest timings. */
  readonly whatHappens: readonly { readonly step: string; readonly timing: string }[];
  readonly included: readonly string[];
  /** Stated as plainly as the inclusions. This is the half that gets omitted. */
  readonly notIncluded: readonly string[];
  /** How to stop, in the words of the person who wants to stop. */
  readonly howToStop: string;
}

const OWNERSHIP_STEP = {
  step: 'You prove you control the application — a DNS record, or a file at a known path. Nothing is tested before that check passes.',
  timing: 'Minutes, once the record has propagated. Sometimes an hour.',
};

const REVIEW_STEP = {
  step: 'A VibefyCode reviewer checks every finding against its evidence, and withholds any that the evidence does not support.',
  timing: 'Usually within one working day.',
};

export const SERVICE_DETAILS: readonly ServiceDetail[] = [
  {
    tierId: 'free',
    plainly:
      'A first look at one application, so you can see what the rubric actually measures before deciding whether to pay for anything.',
    whatHappens: [
      OWNERSHIP_STEP,
      {
        step: 'A limited assessment runs against the pages you authorised.',
        timing: 'Ten to twenty minutes.',
      },
      REVIEW_STEP,
      {
        step: 'You get a headline score and the three findings that matter most.',
        timing: 'Immediately after review.',
      },
    ],
    included: [
      'One limited assessment per application, every 90 days',
      'The overall score and how it was reached',
      'The three highest-severity findings, with what to do about each',
    ],
    notIncluded: [
      'The evidence behind each finding — screenshots, traces, the HTTP exchanges',
      'The full list of findings',
      'A PDF you can hand to somebody else',
      'A badge. A free assessment never leads to one, at any score',
      'Re-assessment. The result is a photograph of one day',
    ],
    howToStop:
      'There is nothing to stop. No card is held and nothing renews. Delete the application, or the account, whenever you like.',
  },
  {
    tierId: 'one_off',
    plainly:
      'One deep assessment of one application, with everything we saw, so you can fix what it found.',
    whatHappens: [
      OWNERSHIP_STEP,
      {
        step: 'A full assessment runs: the deterministic checks, the exploration of your real flows, and the adversarial pass.',
        timing: 'Twenty to forty minutes, depending on the size of the application.',
      },
      REVIEW_STEP,
      {
        step: 'The report is generated and appears in your console, in HTML and as a PDF.',
        timing: 'Within a few minutes of review.',
      },
      {
        step: 'You fix what you want to fix, and re-run it once at no further cost.',
        timing: 'Any time within 30 days.',
      },
    ],
    included: [
      'Every finding, at every severity, with the evidence attached to each',
      'A remediation guide ordered by what to do first',
      'A store-readiness checklist if the application is going to an app store',
      'PDF export you can send to a client or an investor',
      'One free re-assessment within 30 days, so you can prove you fixed it',
    ],
    notIncluded: [
      'A badge. A badge requires a continuous plan, because a badge is a claim about now and a one-off report is a claim about a date',
      'Monitoring. Nothing re-checks the application after your free re-test',
      'Source code review. This tier assesses the running application from outside',
    ],
    howToStop:
      'Nothing to stop — it is a single payment and nothing recurs. The report stays in your console.',
  },
  {
    tierId: 'certified',
    plainly:
      'A badge you can put on your site, kept honest by re-assessing the application every month and taking the badge down if it stops being true.',
    whatHappens: [
      OWNERSHIP_STEP,
      {
        step: 'A full assessment runs and is reviewed, exactly as the one-off tier.',
        timing: 'Under an hour, plus review.',
      },
      {
        step: 'If it meets the rubric threshold, you accept the badge licence and the badge is issued and signed.',
        timing: 'Immediately after you accept.',
      },
      {
        step: 'The application is re-assessed every month, and checked for availability continuously.',
        timing: 'Ongoing, for as long as the plan runs.',
      },
      {
        step: 'If a re-assessment finds a material regression, the badge is suspended and you are told what changed and why.',
        timing: 'Within minutes of the re-assessment being reviewed.',
      },
    ],
    included: [
      'Everything in the one-off deep report, every month',
      'The "Verified by VibefyCode" badge, and a public verification page anybody can check',
      'Monthly re-assessment, and drift alerts when something changes materially',
      'Score history, so you can see the direction rather than one number',
      'Automatic suspension if the application stops meeting the rubric — which is what makes the badge worth having',
    ],
    notIncluded: [
      'Any influence over the score. Paying more does not raise it, and there is no path in the code by which it could',
      'Multiple applications. One application per subscription',
      'Seats for a team. That is the agency tier',
    ],
    howToStop:
      'Cancel from the billing page in your console, in one step, with no conversation. The badge stays live until the end of the period you have paid for, then expires on its own. You keep every report already issued.',
  },
  {
    tierId: 'agency',
    plainly:
      'The certified plan for somebody who builds applications for other people: many applications, a team, and reports that carry your name rather than ours.',
    whatHappens: [
      {
        step: 'You create a workspace and invite the people who need access, each with a role.',
        timing: 'Minutes.',
      },
      OWNERSHIP_STEP,
      {
        step: 'Each application is assessed, reviewed and badged on its own schedule.',
        timing: 'As the certified tier, per application.',
      },
      {
        step: 'You export reports carrying your own branding to hand to your client.',
        timing: 'Any time.',
      },
    ],
    included: [
      'Everything in the certified plan, for every application in the workspace',
      'A shared workspace with named seats and roles',
      'Reports exported under your own branding',
      'One portfolio view of every application you look after',
    ],
    notIncluded: [
      'Single sign-on, policy profiles and the audit export — those are the organisation tier',
      'Any ability to change a score for a client, including your own',
    ],
    howToStop:
      'Cancel from the billing page. Badges stay live until the period you have paid for ends. Your clients keep their reports.',
  },
  {
    tierId: 'organisation',
    plainly:
      'The agency plan with the things a company with an internal standard needs: everyone signs in through your identity provider, and you set the bar an application must meet.',
    whatHappens: [
      {
        step: 'We agree the scope with you and set up your workspace and identity provider.',
        timing: 'A short conversation, then a day or two.',
      },
      {
        step: 'You define policy profiles — the minimum score, the floors per dimension, and what severity of open finding you will tolerate.',
        timing: 'Once, then edited when your standard changes.',
      },
      {
        step: 'Every application is measured against the published rubric and then against your own profile, separately.',
        timing: 'Ongoing.',
      },
    ],
    included: [
      'Everything in the agency plan',
      'Single sign-on, with domain enforcement',
      'Policy profiles: your own bar, applied over the score rather than to it',
      'The portfolio dashboard across every workspace you own',
      'Audit export, with every export recorded',
    ],
    notIncluded: [
      'A private rubric. The rubric is published, and a score means the same thing for everyone. Your profile sits over it',
      'A policy that can raise a score. A profile can only fail an application the rubric passed, never the reverse',
    ],
    howToStop:
      'By the terms of your agreement, which will say the notice period in plain words. Nothing auto-renews without the renewal date being stated in advance.',
  },
];

export function serviceDetailFor(tierId: string): ServiceDetail | null {
  return SERVICE_DETAILS.find((detail) => detail.tierId === tierId) ?? null;
}
