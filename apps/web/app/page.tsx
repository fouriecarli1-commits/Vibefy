import Link from 'next/link';
import { getRubric } from '@vibefycode/rubric';

/**
 * The home page.
 *
 * Every block on it is one of the shapes defined in `globals.css` — a panel, a
 * bar, a stat, a chip — because a reader should learn the vocabulary once and
 * then recognise it on every other page. Nothing here is a shape that appears
 * nowhere else.
 */
export default function HomePage() {
  const rubric = getRubric();
  const dimensionCount = rubric.dimensions.length;

  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <p className="eyebrow">The vibe app rating system</p>
        <h1 className="max-w-3xl text-4xl font-bold sm:text-5xl">
          The trust layer for <span className="vibefycode-gradient-text">AI-built apps</span>
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          You built it fast. VibefyCode tells you — with evidence — what a first real user, an app
          store reviewer, or someone poking at your API would find. Every finding carries a
          screenshot, a trace or an HTTP exchange. Nothing we cannot evidence gets published.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href="/sign-up"
            className="rounded-lg bg-accent px-5 py-2.5 font-medium text-on-accent"
          >
            Create an account
          </Link>
          <Link
            href="/methodology"
            className="rounded-lg border border-line-strong px-5 py-2.5 font-medium"
          >
            Read the rubric
          </Link>
        </div>
      </section>

      {/* The three numbers that describe the standard, before any prose about
          it. A reader who reads nothing else has still learned the shape. */}
      <section aria-label="The standard, in numbers" className="grid-cards">
        <div className="stat">
          <span className="stat-value">{dimensionCount}</span>
          <span className="stat-label">Scored dimensions</span>
        </div>
        <div className="stat">
          <span className="stat-value">v{rubric.version}</span>
          <span className="stat-label">Rubric in force</span>
        </div>
        <div className="stat">
          <span className="stat-value">100%</span>
          <span className="stat-label">Findings carrying evidence</span>
        </div>
      </section>

      <section aria-labelledby="rubric-heading" className="space-y-5">
        <div className="space-y-2">
          <h2 id="rubric-heading" className="text-2xl font-bold">
            What gets assessed
          </h2>
          <p className="max-w-2xl text-muted">
            Rubric v{rubric.version}, published in full. Scores are computed from versioned data,
            not from a private judgement.
          </p>
        </div>
        <ul className="grid-cards">
          {rubric.dimensions.map((dimension) => (
            <li key={dimension.id} className="panel space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-semibold">{dimension.label}</h3>
                <span className="chip" data-numeric>
                  {Math.round(dimension.weight * 100)}%
                </span>
              </div>
              <p className="text-sm text-muted">{dimension.question}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how-heading" className="space-y-5">
        <h2 id="how-heading" className="text-2xl font-bold">
          How it works
        </h2>
        <ol className="grid-cards">
          {[
            {
              step: '01',
              title: 'Prove you control it',
              body: 'Publish a DNS record or a file at a known path. Nothing is tested until that check passes — for your protection and ours.',
            },
            {
              step: '02',
              title: 'The assessment runs',
              body: 'Inside the scope you authorised, under a request ceiling and a spend ceiling. Every observation is captured as evidence.',
            },
            {
              step: '03',
              title: 'A person reviews it',
              body: 'A reviewer checks the findings against the evidence before anything is published. No badge is issued without that step.',
            },
            {
              step: '04',
              title: 'The badge stays honest',
              body: 'On a continuous plan the application is re-assessed. If it drifts materially, the badge is suspended and you are told why.',
            },
          ].map((item) => (
            <li key={item.step} className="panel space-y-2">
              <span className="eyebrow" data-numeric>
                {item.step}
              </span>
              <h3 className="font-semibold">{item.title}</h3>
              <p className="text-sm text-muted">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="scope-heading" className="space-y-3">
        <h2 id="scope-heading" className="text-2xl font-bold">
          What a VibefyCode assessment is not
        </h2>
        <div className="bar" data-tone="warn">
          <p className="max-w-3xl text-sm">
            It is not a penetration test, a security audit, a code audit, a legal or regulatory
            certification, or a guarantee of any kind. It does not certify that an application is
            free of defects, lawful, or fit for any particular purpose. The mark means one thing:
            this app was assessed against the published rubric, on a stated date, and met the
            published threshold.
          </p>
        </div>
      </section>
    </div>
  );
}
