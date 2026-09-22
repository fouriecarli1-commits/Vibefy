/**
 * How hard is it to leave?
 *
 * Anré's idea, and it is the best question nobody rates. Every review of every
 * subscription tells you how good it is to join. The thing that actually costs
 * people money is the other end: the cancel link that is not on the account
 * page, the "manage preferences" that leads to a survey, the plan you can start
 * in two clicks and can only stop by writing an email and waiting.
 *
 * So this produces a number, and the number is made of facts.
 *
 * ## What it is not
 *
 * It is **not** part of the rubric and it does not move a badge score. A rubric
 * score is what an assessment found against published criteria; this is a
 * separate measurement with its own published weights, and mixing them would
 * make both mean less. The verification page shows it as its own thing and says
 * so.
 *
 * It measures **the route, not the outcome**. We walk to the exit and stop
 * before going through it: whether a cancellation that is offered is actually
 * honoured is not something anybody can observe from outside without cancelling
 * somebody's subscription, and that is not ours to do. A published route that
 * nobody acts on scores well here and deserves to — the failure it describes is
 * a different failure, and the limitation says so.
 *
 * ## Why these four
 *
 * Each is a fact a person can check, and each is a thing a company does on
 * purpose. Nobody accidentally puts the cancel link four pages deeper than the
 * subscribe button.
 */

export type ExitBand = 'Easy' | 'Workable' | 'Hard' | 'No route found';

export interface ExitSignals {
  /** A route to cancelling was found on the site, without signing in. */
  readonly routeFound: boolean;
  /** It can be completed by the user, rather than by asking a person to do it. */
  readonly selfService: boolean;
  /** It is called what it is, rather than "manage preferences" or "options". */
  readonly plainlyNamed: boolean;
  /** Clicks from the home page to the page that offers cancelling. */
  readonly clicksToCancel: number | null;
  /** Clicks from the home page to the page that offers subscribing. */
  readonly clicksToSubscribe: number | null;
}

export interface ExitScore {
  readonly percentage: number;
  readonly band: ExitBand;
  /** Every component, with what it was worth and whether it was earned. */
  readonly components: readonly {
    readonly id: string;
    readonly label: string;
    readonly weight: number;
    readonly earned: number;
    readonly detail: string;
  }[];
}

/**
 * The weights, published rather than tuned.
 *
 * They add to a hundred, they are in the repository, and they are the same for
 * everybody. A weighting nobody can read is a rating nobody should believe.
 */
export const EXIT_WEIGHTS = {
  routeFound: 40,
  selfService: 25,
  symmetry: 20,
  plainlyNamed: 15,
} as const;

export const EXIT_BANDS: readonly { min: number; band: ExitBand }[] = [
  { min: 85, band: 'Easy' },
  { min: 60, band: 'Workable' },
  { min: 1, band: 'Hard' },
  { min: 0, band: 'No route found' },
];

/**
 * The sentence that travels with the number, quoted rather than paraphrased.
 *
 * The paraphrase is always shorter and always claims more.
 */
export const EXIT_LEGEND =
  'This measures how hard the way out is to find and reach, from the public site, on one day. It is not part of the VibefyCode rubric and does not affect any score or badge. It does not test whether a cancellation is honoured — we walk to the exit and stop before going through it, because cancelling somebody else’s subscription is not ours to do. A route that is easy to find can still be operated badly.';

export function scoreExit(signals: ExitSignals): ExitScore {
  const components: ExitScore['components'] = [
    {
      id: 'routeFound',
      label: 'There is a way to cancel that a visitor can find',
      weight: EXIT_WEIGHTS.routeFound,
      earned: signals.routeFound ? EXIT_WEIGHTS.routeFound : 0,
      detail: signals.routeFound
        ? 'A route to cancelling was found on the public site.'
        : 'No route to cancelling was found on the pages we could reach. It may exist behind a sign-in.',
    },
    {
      id: 'selfService',
      label: 'You can do it yourself',
      weight: EXIT_WEIGHTS.selfService,
      earned: signals.routeFound && signals.selfService ? EXIT_WEIGHTS.selfService : 0,
      detail: !signals.routeFound
        ? 'Not reached: no route was found.'
        : signals.selfService
          ? 'The route is one the user completes themselves.'
          : 'The route ends in asking a person to cancel for you — an email address or a telephone number. That is a queue somebody else controls.',
    },
    {
      id: 'symmetry',
      label: 'Leaving is no harder to reach than joining',
      weight: EXIT_WEIGHTS.symmetry,
      earned: symmetryEarned(signals),
      detail: symmetryDetail(signals),
    },
    {
      id: 'plainlyNamed',
      label: 'It is called what it is',
      weight: EXIT_WEIGHTS.plainlyNamed,
      earned: signals.routeFound && signals.plainlyNamed ? EXIT_WEIGHTS.plainlyNamed : 0,
      detail: !signals.routeFound
        ? 'Not reached: no route was found.'
        : signals.plainlyNamed
          ? 'The link says cancel, unsubscribe or end — the words somebody would search for.'
          : 'The route is named something other than cancelling, so somebody looking for the exit has to guess which euphemism was chosen.',
    },
  ];

  // A component that could not be measured must not be scored as a failure.
  //
  // Symmetry needs both routes. Where the exit was found and the entrance was
  // not, the old rule earned zero for it — so a company with a plainly named,
  // one-click, self-service cancel route was marked down twenty points because
  // *we* could not find its join button. Its weight is shared across the
  // components that were measured instead, the panel shows the adjusted
  // weights, and the detail says why.
  const measured = components.filter((component) => !unmeasurable(component.id, signals));
  const adjusted =
    measured.length === components.length
      ? components
      : redistribute(components, new Set(measured.map((component) => component.id)));

  const percentage = adjusted.reduce((total, component) => total + component.earned, 0);
  return { percentage, band: bandFor(percentage), components: adjusted };
}

/**
 * Whether a component had nothing to measure, as opposed to measuring badly.
 *
 * Only ever true where the route *was* found: a run that found no route
 * measured that, and scoring it at zero is the answer rather than the absence
 * of one.
 */
function unmeasurable(id: string, signals: ExitSignals): boolean {
  if (id !== 'symmetry') return false;
  return (
    signals.routeFound && (signals.clicksToCancel === null || signals.clicksToSubscribe === null)
  );
}

/**
 * Shares an unmeasurable component's weight across the rest, keeping whole
 * numbers and a total of a hundred, so that the components still add up to the
 * percentage shown beside them.
 */
function redistribute(
  components: ExitScore['components'],
  keep: ReadonlySet<string>,
): ExitScore['components'] {
  const total = components.reduce((sum, component) => sum + component.weight, 0);
  const kept = components.filter((component) => keep.has(component.id));
  const keptWeight = kept.reduce((sum, component) => sum + component.weight, 0);
  if (keptWeight === 0) return components;

  const exact = kept.map((component) => (component.weight * total) / keptWeight);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = total - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - floors[index]! }))
    .sort((a, b) => b.fraction - a.fraction);
  const weights = [...floors];
  for (const entry of order) {
    if (remainder <= 0) break;
    weights[entry.index] = weights[entry.index]! + 1;
    remainder -= 1;
  }

  const byId = new Map(
    kept.map((component, index) => {
      const weight = weights[index]!;
      // Earned in the same proportion it was earned before, so a half-earned
      // component stays half-earned.
      const earned =
        component.weight === 0 ? 0 : Math.round((component.earned / component.weight) * weight);
      return [component.id, { ...component, weight, earned }];
    }),
  );

  return components.map(
    (component) =>
      byId.get(component.id) ?? {
        ...component,
        weight: 0,
        earned: 0,
        detail: `${component.detail} It is not counted, and its weight is shared across the components that were measured.`,
      },
  );
}

/**
 * The asymmetry measure, which is the one that catches a decision rather than
 * an oversight.
 *
 * Nobody accidentally puts the cancel link four pages deeper than the subscribe
 * button. One extra click is forgiven — a subscribe button on the home page and
 * a cancel link in the account area is ordinary and is not a dark pattern.
 */
function symmetryEarned(signals: ExitSignals): number {
  if (!signals.routeFound) return 0;
  if (signals.clicksToCancel === null || signals.clicksToSubscribe === null) return 0;
  const gap = signals.clicksToCancel - signals.clicksToSubscribe;
  if (gap <= 1) return EXIT_WEIGHTS.symmetry;
  if (gap === 2) return Math.round(EXIT_WEIGHTS.symmetry / 2);
  return 0;
}

function symmetryDetail(signals: ExitSignals): string {
  if (!signals.routeFound) return 'Not reached: no route was found.';
  if (signals.clicksToCancel === null || signals.clicksToSubscribe === null) {
    return 'Not measured: one of the two routes was not found on the pages we could reach, so there is nothing to compare.';
  }
  const gap = signals.clicksToCancel - signals.clicksToSubscribe;
  if (gap <= 1) {
    return `${signals.clicksToSubscribe} click${signals.clicksToSubscribe === 1 ? '' : 's'} to join, ${signals.clicksToCancel} to reach the way out.`;
  }
  return `${signals.clicksToSubscribe} click${signals.clicksToSubscribe === 1 ? '' : 's'} to join and ${signals.clicksToCancel} to reach the way out. Nobody puts the exit ${gap} pages further away by accident.`;
}

export function bandFor(percentage: number): ExitBand {
  return EXIT_BANDS.find((band) => percentage >= band.min)!.band;
}
