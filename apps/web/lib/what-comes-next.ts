/**
 * What to do next with one application, said in one line.
 *
 * The console listed every application the same way: its name, its address and
 * a screening chip. An application that is authorised and ready to assess
 * looked exactly like one still waiting for a DNS record to propagate, and the
 * action everybody comes here for — assess this — was section four of a
 * thousand-line page, under authorisation, above the badge licence, monitoring,
 * the directory listing and policy profiles.
 *
 * Reported in the founder's own words on 2026-10-21: "ek kan byvoorbeeld nie
 * mooi sien waar om 'n application te launch nie."
 *
 * Nothing here is new behaviour. Every one of these states already decides what
 * the product will let somebody do — `decideAssessmentRequest` refuses a run
 * without a verified authorisation, the screening sweep holds a submission
 * until a person clears it — and all of it was legible only by reading the
 * page that enforces it. This says the same thing in the order it happens.
 *
 * A pure function over facts the console already has, so the ordering can be
 * tested without a browser: the ordering is the whole substance of it.
 */
export type NextStepId =
  | 'refused'
  | 'screening'
  | 'authorise'
  | 'verify'
  | 'assess'
  | 'running'
  | 'review'
  | 'report';

export interface AppState {
  readonly appId: string;
  /** `public.apps.screening_status`. */
  readonly screening: string;
  /** The current authorisation's status, or null where there is none. */
  readonly authorisation: string | null;
  /** Whether `app_is_authorised_for_testing` says yes, which is the gate itself. */
  readonly authorisedForTesting: boolean;
  /** An open request: 'queued' or 'claimed'. Null where none is in flight. */
  readonly openRequest: string | null;
  /** The newest assessment's status, or null where none has ever run. */
  readonly latestAssessment: string | null;
  /** The newest assessment's id, for the link to its report. */
  readonly latestAssessmentId: string | null;
}

export interface NextStep {
  readonly id: NextStepId;
  /** Two or three words, for a chip beside the name. */
  readonly label: string;
  /** One sentence: what this means and who it is waiting on. */
  readonly what: string;
  /** Where the step is taken. Null where it is nobody's move but ours. */
  readonly href: string | null;
  /** Whether this is a step somebody takes, as against a state to wait out. */
  readonly yours: boolean;
}

/**
 * The order is the product's own, and it is not a presentation choice.
 *
 * Screening comes before authorisation because a refused submission is never
 * authorised; authorisation before assessment because the gate refuses a run
 * without it; the report last because it is the only state that is an end
 * rather than a step. Getting this order wrong would tell somebody to publish a
 * DNS record for an application we have already refused.
 */
export function whatComesNext(state: AppState): NextStep {
  const app = `/console/apps/${state.appId}`;

  if (state.screening === 'refused' || state.screening === 'blocked') {
    return {
      id: 'refused',
      label: 'Refused',
      what: 'This application was refused under the Acceptable Use Policy. An appeal is the way forward; re-submitting is not.',
      href: app,
      yours: true,
    };
  }

  if (state.screening !== 'cleared' && state.screening !== 'passed') {
    return {
      id: 'screening',
      label: 'Waiting on us',
      what: 'A person looks at every submission before anything is tested. Nothing is needed from you until that is done.',
      href: null,
      yours: false,
    };
  }

  if (!state.authorisation) {
    return {
      id: 'authorise',
      label: 'Authorise testing',
      what: 'Accept the testing warranty and name what is in scope. Nothing is tested before this, for your protection and ours.',
      href: `${app}#authorisation`,
      yours: true,
    };
  }

  if (!state.authorisedForTesting) {
    /*
     * Pending verification and an expired authorisation arrive here together,
     * and the sentence says both: "prove" covers the first time and the next
     * one, and the page below shows whichever of the two challenges applies.
     */
    return {
      id: 'verify',
      label: 'Prove the domain',
      what: 'Publish the DNS record or the challenge file, then press Verify. An authorisation that has lapsed is renewed the same way.',
      href: `${app}#authorisation`,
      yours: true,
    };
  }

  if (state.openRequest === 'queued' || state.openRequest === 'claimed') {
    return {
      id: 'running',
      label: 'Running',
      what: 'The assessment is queued or under way. It appears here when it finishes; nothing is needed from you.',
      href: null,
      yours: false,
    };
  }

  if (state.latestAssessment === 'queued' || state.latestAssessment === 'running') {
    return {
      id: 'running',
      label: 'Running',
      what: 'The assessment is under way. It appears here when it finishes; nothing is needed from you.',
      href: null,
      yours: false,
    };
  }

  if (state.latestAssessment === 'awaiting_review') {
    return {
      id: 'review',
      label: 'Waiting on us',
      what: 'The run is done and a reviewer has it. Nothing is published before a person has looked at it.',
      href: null,
      yours: false,
    };
  }

  if (
    (state.latestAssessment === 'approved' || state.latestAssessment === 'published') &&
    state.latestAssessmentId
  ) {
    return {
      id: 'report',
      label: 'Read the report',
      what: 'The assessment is finished and reviewed.',
      href: `/console/reports/${state.latestAssessmentId}`,
      yours: true,
    };
  }

  /*
   * Everything else lands here, which is the state this whole file exists for:
   * authorised, nothing in flight, and the next move is to ask for a run. A
   * failed or rejected assessment lands here too, because the answer to both is
   * the same — ask again.
   *
   * Whether the plan allows it right now is `decideAssessmentRequest`'s to say,
   * and it says so with a sentence when the button is pressed. Repeating that
   * judgement here would be a second copy of the rule, and the two would
   * disagree the day either changed.
   */
  return {
    id: 'assess',
    label: 'Assess it',
    what: 'Everything is in place. Requesting the assessment is the next step.',
    href: `${app}#assessment`,
    yours: true,
  };
}
