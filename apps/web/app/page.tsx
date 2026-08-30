import Link from 'next/link';
import { getRubric } from '@vibefycode/rubric';

/**
 * The first page anybody sees.
 *
 * Three things have to happen here, in this order: they see the mark, they see
 * the thing they would be buying, and they see it doing its job on somebody
 * else's website. A product whose entire value is a small graphic on another
 * company's page has to show that graphic on another company's page.
 *
 * Everything below the fold is built from the same five shapes the rest of the
 * product uses — panel, bar, stat, chip, eyebrow — so the vocabulary is learned
 * here and recognised everywhere after.
 */
export default function HomePage() {
  const rubric = getRubric();

  return (
    <div className="space-y-16">
      {/* --- The mark, at the size it deserves ------------------------------ */}
      <section className="flex flex-col items-center gap-7 pt-4 text-center">
        {/*
          The founder's own artwork, served unmodified — mark and wordmark
          together, exactly as he drew them.

          Everywhere else this product draws the mark from geometry, because a
          badge has to render per request to stay revocable and has to survive
          96 px. The welcome page is neither of those. It is one image, once, at
          the size a logo is meant to be looked at, and there the artwork beats
          any reconstruction of it. It costs 378 KB, which is the trade that was
          made deliberately rather than the one that was overlooked.
        */}
        <div className="hero-lockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/vibefycode-hero-dark.svg" alt="VibefyCode" fetchPriority="high" />
          <span className="hero-sheen" aria-hidden="true" />
        </div>

        <div className="space-y-4">
          <p className="eyebrow">The vibe app rating system</p>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold sm:text-5xl">
            The trust layer for <span className="vibefycode-gradient-text">AI-built apps</span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted">
            You built it fast. VibefyCode tells you — with evidence — what a first real user, an app
            store reviewer, or someone poking at your API would find. Then, if it earns one, you get
            a mark you can put on your site that we take down again if it stops being true.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/sign-up"
            className="rounded-lg bg-accent px-5 py-2.5 font-medium text-on-accent"
          >
            Create an account
          </Link>
          <Link
            href="/how-it-works"
            className="rounded-lg border border-line-strong px-5 py-2.5 font-medium"
          >
            What happens to your app
          </Link>
          <Link
            href="/trust-check"
            className="rounded-lg border border-line-strong px-5 py-2.5 font-medium"
          >
            Check an app before you pay
          </Link>
        </div>
      </section>

      {/* --- What you actually get ------------------------------------------ */}
      <section aria-labelledby="badge-heading" className="space-y-6">
        <div className="space-y-2 text-center">
          <h2 id="badge-heading" className="text-2xl font-bold">
            This is the mark you earn
          </h2>
          <p className="mx-auto max-w-2xl text-muted">
            Issued only after a person has reviewed the assessment. Every one carries a signature
            anybody can check, and a page anybody can open — including the people you are trying to
            persuade.
          </p>
        </div>

        <div className="grid items-center gap-8 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/*
              The founder's own badge artwork, watermark removed and nothing
              else touched. This is the trade mark, and on the one page whose
              job is to show what the mark looks like, it is the mark rather
              than a drawing of it.

              The badge *served onto customers' sites* is still generated per
              request from `packages/badge` — that is what makes a revocation
              take effect in minutes, and what lets one badge carry one
              application's own facts. This is the showcase, not the issue.
            */}
            <img
              src="/brand/vibefycode-badge-artwork.webp"
              alt="The Verified by VibefyCode badge"
              width={300}
              height={300}
              className="h-[300px] w-[300px]"
            />
            <span className="chip" data-tone="ok">
              Active
            </span>
          </div>

          <ul className="space-y-3">
            {[
              {
                title: 'It says one thing, precisely',
                body: 'That this application was assessed against a published rubric version, on a stated date, and met the published threshold. Not that it is free of defects, and not that it is a security audit.',
              },
              {
                title: 'It can be checked by a stranger',
                body: 'The badge carries a signature and a public identifier. Anybody can open its verification page and see the score, the date, and whether it is still in force.',
              },
              {
                title: 'It comes down when it stops being true',
                body: 'On a continuous plan the application is re-assessed. A material regression suspends the badge automatically, and the customer is told what changed and why.',
              },
            ].map((item) => (
              <li key={item.title} className="panel space-y-1.5">
                <h3 className="font-semibold">{item.title}</h3>
                <p className="text-sm text-muted">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>

        {/* The states, so nobody is surprised by one. A badge is never a broken
            image — every non-active state renders as its own legible mark. */}
        <div className="space-y-3">
          <p className="eyebrow text-center">And what it looks like when it is not in force</p>
          <ul className="flex flex-wrap items-end justify-center gap-6">
            {[
              { file: 'vibefycode-badge-artwork-suspended.webp', label: 'Suspended', tone: 'warn' },
              { file: 'vibefycode-badge-artwork-expired.webp', label: 'Expired', tone: undefined },
              { file: 'vibefycode-badge-artwork-revoked.webp', label: 'Revoked', tone: 'bad' },
            ].map((state) => (
              <li key={state.file} className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/brand/${state.file}`}
                  alt={`The badge in its ${state.label.toLowerCase()} state`}
                  width={132}
                  height={132}
                  className="h-[132px] w-[132px]"
                />
                <span className="chip" data-tone={state.tone}>
                  {state.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* --- The badge doing its job ----------------------------------------- */}
      <section aria-labelledby="example-heading" className="space-y-5">
        <div className="space-y-2">
          <h2 id="example-heading" className="text-2xl font-bold">
            Where it sits on your site
          </h2>
          <p className="max-w-2xl text-muted">
            One line of HTML in your footer. It links to the verification page, so a visitor who
            does not believe it can find out in one click — which is the only reason a mark like
            this is worth anything.
          </p>
        </div>

        <div className="browser">
          <div className="browser-bar">
            <span className="browser-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {/* A fictional application, deliberately. A mock built to look like
                a real company's site is a mock that gets read as an endorsement
                of one. */}
            <span className="browser-address">https://kettle.example</span>
          </div>

          <div className="browser-page" aria-hidden="true">
            <div className="space-y-2">
              <div className="mock-line" style={{ width: '38%', height: 16 }} />
              <div className="mock-line" style={{ width: '72%' }} />
              <div className="mock-line" style={{ width: '61%' }} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((column) => (
                <div key={column} className="space-y-2">
                  <div className="mock-line" style={{ width: '52%' }} />
                  <div className="mock-line" style={{ width: '88%' }} />
                  <div className="mock-line" style={{ width: '70%' }} />
                </div>
              ))}
            </div>

            <div className="mock-footer">
              <div className="space-y-2" style={{ minWidth: '40%' }}>
                <div className="mock-line" style={{ width: '55%' }} />
                <div className="mock-line" style={{ width: '35%' }} />
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/vibefycode-badge-artwork.webp"
                alt=""
                width={112}
                height={112}
                className="h-28 w-28"
              />
            </div>
          </div>
        </div>

        <p className="text-sm text-muted">
          A fictional application, used so the example demonstrates the badge rather than endorsing
          anybody.
        </p>
      </section>

      {/* --- What the score is made of --------------------------------------- */}
      <section aria-label="The standard, in numbers" className="grid-cards">
        <div className="stat">
          <span className="stat-value">{rubric.dimensions.length}</span>
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
