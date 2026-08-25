import Link from 'next/link';
import { getRubric } from '@vibefycode/rubric';

export default function HomePage() {
  const rubric = getRubric();

  return (
    <div className="space-y-14">
      <section className="space-y-5">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted">
          The vibe app rating system
        </p>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          The trust layer for <span className="vibefycode-gradient-text">AI-built apps</span>
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          You built it fast. VibefyCode tells you — with evidence — what a first real user, an app
          store reviewer, or someone poking at your API would find. Every finding carries a
          screenshot, a trace or an HTTP exchange. Nothing we cannot evidence gets published.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
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

      <section aria-labelledby="rubric-heading" className="space-y-5">
        <h2 id="rubric-heading" className="text-2xl font-bold tracking-tight">
          What gets assessed
        </h2>
        <p className="text-muted">
          Rubric v{rubric.version}, published in full. Scores are computed from versioned data, not
          from a private judgement.
        </p>
        <ul className="grid gap-4 sm:grid-cols-2">
          {rubric.dimensions.map((dimension) => (
            <li key={dimension.id} className="rounded-xl border border-line p-5">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="font-semibold">{dimension.label}</h3>
                <span className="text-sm text-muted">{Math.round(dimension.weight * 100)}%</span>
              </div>
              <p className="mt-2 text-sm text-muted">{dimension.question}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="scope-heading"
        className="rounded-xl border border-line bg-surface-muted p-6"
      >
        <h2 id="scope-heading" className="text-lg font-semibold">
          What a VibefyCode assessment is not
        </h2>
        <p className="mt-3 max-w-3xl text-sm text-muted">
          It is not a penetration test, a security audit, a code audit, a legal or regulatory
          compliance certification, or a guarantee of any kind. It does not certify that an
          application is secure, error-free, lawful, or fit for any particular purpose. The mark
          means one thing: this app was assessed against the published rubric, on a stated date, and
          met the published threshold.
        </p>
      </section>
    </div>
  );
}
