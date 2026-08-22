import type { Metadata } from 'next';
import { getRubric, rubricChecksum, CURRENT_RUBRIC_VERSION } from '@vibefy/rubric';

export const metadata: Metadata = {
  title: 'Methodology',
  description:
    'The Vibefy rubric in full: dimensions, weights, gates, the certification threshold and the scoring method.',
};

/**
 * The methodology page is a product, not a footnote. It is the source of the
 * mark's credibility, so it renders directly from the same rubric data the
 * scorer uses — the published page and the scoring behaviour cannot diverge.
 */
export default function MethodologyPage() {
  const rubric = getRubric();

  return (
    <article className="space-y-12">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Rating methodology</h1>
        <p className="text-muted">
          Vibefy Rubric v{rubric.version} · checksum{' '}
          <code className="text-sm">{rubricChecksum(CURRENT_RUBRIC_VERSION).slice(0, 16)}…</code>
        </p>
        <p className="max-w-3xl">{rubric.changelog}</p>
      </header>

      <section aria-labelledby="dimensions" className="space-y-4">
        <h2 id="dimensions" className="text-2xl font-bold tracking-tight">
          Dimensions and weights
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              Rubric dimensions, their weights and what they measure
            </caption>
            <thead>
              <tr className="border-b border-line-strong">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Dimension
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Weight
                </th>
                <th scope="col" className="py-2 font-semibold">
                  What it asks
                </th>
              </tr>
            </thead>
            <tbody>
              {rubric.dimensions.map((dimension) => (
                <tr key={dimension.id} className="border-b border-line align-top">
                  <th scope="row" className="py-3 pr-4 font-medium">
                    {dimension.label}
                  </th>
                  <td className="py-3 pr-4 tabular-nums">{Math.round(dimension.weight * 100)}%</td>
                  <td className="py-3 text-muted">{dimension.question}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="scoring" className="space-y-4">
        <h2 id="scoring" className="text-2xl font-bold tracking-tight">
          How a score is computed
        </h2>
        <p className="max-w-3xl text-muted">{rubric.scoring.method}</p>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-5">
            <dt className="font-semibold">Severity penalties</dt>
            <dd className="mt-2 text-sm text-muted">
              {Object.entries(rubric.scoring.severityPenalties)
                .map(([severity, penalty]) => `${severity} −${penalty}`)
                .join(' · ')}
            </dd>
          </div>
          <div className="rounded-xl border border-line p-5">
            <dt className="font-semibold">Confidence multipliers</dt>
            <dd className="mt-2 text-sm text-muted">
              {Object.entries(rubric.scoring.confidenceMultipliers)
                .map(([confidence, multiplier]) => `${confidence} ×${multiplier}`)
                .join(' · ')}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="gates" className="space-y-4">
        <h2 id="gates" className="text-2xl font-bold tracking-tight">
          Gates
        </h2>
        <p className="max-w-3xl text-muted">
          Gates are applied after the arithmetic and can only lower a result. No combination of
          strong dimensions outvotes them.
        </p>
        <ul className="space-y-4">
          {rubric.gates.map((gate) => (
            <li key={gate.id} className="rounded-xl border border-line p-5">
              <h3 className="font-semibold">{gate.label}</h3>
              <p className="mt-1 text-sm text-muted">{gate.rationale}</p>
              <p className="mt-2 text-sm">
                {gate.capOverallAt !== undefined
                  ? `Caps the overall score at ${gate.capOverallAt}. `
                  : ''}
                {gate.blocksCertification ? 'Blocks certification.' : ''}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="threshold" className="space-y-4">
        <h2 id="threshold" className="text-2xl font-bold tracking-tight">
          Certification threshold
        </h2>
        <p className="max-w-3xl text-muted">
          A badge issues only when the overall score reaches{' '}
          <strong>{rubric.certification.overallThreshold}</strong>, every dimension floor is met, no
          gate has fired, and a human reviewer has approved the assessment. Badges expire within{' '}
          {rubric.certification.maximumBadgeValidityMonths} months at the outside.
        </p>
        <ul className="text-sm text-muted">
          {Object.entries(rubric.certification.dimensionFloors).map(([dimension, floor]) => (
            <li key={dimension}>
              {dimension.replace(/_/g, ' ')} — minimum {floor}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="independence" className="space-y-3">
        <h2 id="independence" className="text-2xl font-bold tracking-tight">
          Independence
        </h2>
        <p className="max-w-3xl text-muted">
          Payment buys depth, re-testing, monitoring and support. Payment never buys a score. The
          scoring function receives a data structure that has no field for a plan, a price or a
          marketing relationship, and a test in our build pipeline constructs a maximally-paying
          customer and a free customer with identical apps and asserts that their scores are
          identical. Reviewer overrides are recorded with a written reason and cannot be edited.
        </p>
      </section>
    </article>
  );
}
