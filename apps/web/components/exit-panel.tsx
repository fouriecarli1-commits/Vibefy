import { EXIT_LEGEND, bandFor, type ExitBand, type ExitScore } from '@vibefycode/trustcheck';

/**
 * How hard it is to leave, on the verification page.
 *
 * The hardest thing about this panel is not what it says but where it sits.
 * There is already a number on this page — the rubric score — and a second
 * number beside it is how both come to mean less. So this one is separated by
 * everything available: its own heading, its own explanation of where it comes
 * from, and a sentence saying in as many words that it is not part of the
 * rubric and moves no badge.
 *
 * It is shown whether it is good or bad. A measurement that only appears when
 * it flatters is an advertisement.
 */

const BAND_TONE: Record<ExitBand, string> = {
  Easy: 'text-ok',
  Workable: 'text-ink',
  Hard: 'text-warn',
  'No route found': 'text-bad',
};

export interface ExitMeasurement {
  readonly routeFound: boolean;
  readonly clicksToCancel: number | null;
  readonly clicksToSubscribe: number | null;
  readonly score: ExitScore;
}

export function ExitPanel({ measurement }: { measurement: ExitMeasurement }) {
  const { score } = measurement;
  const band = score.band ?? bandFor(score.percentage);

  return (
    <section
      aria-labelledby="getting-out"
      className="space-y-5 rounded-xl border border-line-strong p-6"
    >
      <div className="space-y-2">
        <p className="eyebrow">A separate measurement</p>
        <h2 id="getting-out" className="text-2xl font-bold tracking-tight">
          How hard is it to leave?
        </h2>
        <p className="max-w-prose text-muted">
          Every review of a subscription tells you how good it is to join. This is the other end —
          how easy the way out is to find and to reach. It is measured from the public site, and it
          is <strong>not part of the score above</strong>.
        </p>
      </div>

      <div className="flex flex-wrap items-baseline gap-4">
        <span className={`text-4xl font-bold tracking-tight ${BAND_TONE[band]}`} data-numeric>
          {score.percentage}%
        </span>
        <span className={`text-lg font-medium ${BAND_TONE[band]}`}>{band}</span>
      </div>

      {measurement.routeFound &&
        measurement.clicksToCancel !== null &&
        measurement.clicksToSubscribe !== null && (
          // The sentence that makes the number mean something. Nobody puts the
          // exit four pages further away by accident.
          <p className="max-w-prose">
            {measurement.clicksToSubscribe} click
            {measurement.clicksToSubscribe === 1 ? '' : 's'} from the front door to join,{' '}
            {measurement.clicksToCancel} to reach the way out.
          </p>
        )}

      {/* Every component, with what it was worth. A rating whose working is not
          shown is a rating nobody should believe — and the customer has to be
          able to see exactly what to change. */}
      <ul className="space-y-3">
        {score.components.map((component) => (
          <li key={component.id} className="flex gap-4 rounded-lg border border-line p-4">
            <span
              aria-hidden="true"
              className={`text-sm font-bold ${component.earned === component.weight ? 'text-ok' : component.earned === 0 ? 'text-muted' : 'text-warn'}`}
              data-numeric
            >
              {component.earned}/{component.weight}
            </span>
            <div>
              <p className="text-sm font-medium">{component.label}</p>
              <p className="mt-1 max-w-prose text-sm text-muted">{component.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="max-w-prose rounded-lg bg-surface-muted p-4 text-sm text-muted">
        {EXIT_LEGEND}
      </p>
    </section>
  );
}
