import type { Metadata } from 'next';
import Link from 'next/link';
import { PRICING_BASIS, REMEDIATION_OFFER } from '@vibefycode/remediation';
import { REMEDIATION_CLIENT_DISCLOSURE } from '@vibefycode/shared';

export const metadata: Metadata = {
  title: 'Help fixing what the report found',
  description:
    'We can help you fix what an assessment found — and the conflict that creates, stated plainly, with what stops it mattering.',
};

/**
 * The page that sells the service, and argues against itself first.
 *
 * A rating service offering to fix what it rates has a financial interest in
 * finding faults. Every sceptic will notice, and they will be right to. A page
 * that leads with the offer and buries the conflict is a page that confirms
 * their suspicion the moment they scroll.
 *
 * So the conflict is the first section, before anything is offered, in the
 * plainest words available. What follows is not a rebuttal — the incentive is
 * real whether or not anyone acts on it — but the four things that make it
 * inert, each of which is a fact about the code rather than a promise about us.
 *
 * The offer copy is imported from `@vibefycode/remediation` rather than written
 * here, so the page and the tests that hold it to no-promised-outcomes are
 * reading the same words.
 */
export default function RemediationPage() {
  return (
    <div className="space-y-16">
      <header className="space-y-4">
        <p className="eyebrow">A service, and its conflict</p>
        <h1 className="text-4xl font-bold">{REMEDIATION_OFFER.headline}</h1>
        <p className="max-w-2xl text-lg text-muted">{REMEDIATION_OFFER.plainly}</p>
      </header>

      {/* --- The objection, before the offer --------------------------------- */}
      <section aria-labelledby="conflict-heading" className="space-y-5">
        <h2 id="conflict-heading" className="text-2xl font-bold">
          Read this part first
        </h2>
        <div className="bar" data-tone="warn">
          <p className="max-w-3xl text-sm">
            A company that rates applications and also sells repairs has a financial interest in
            finding faults. That is arithmetic, not an accusation, and it is true of us. You should
            be sceptical of this page, and we would rather say so than have you notice it yourself
            two paragraphs later.
          </p>
        </div>
        <p className="max-w-2xl text-sm text-muted">
          What follows is not a promise to behave. The incentive exists whether or not anybody acts
          on it, so the answer is four separations that do not depend on us being good — each one a
          fact about how the code is built.
        </p>
      </section>

      {/* --- The four separations -------------------------------------------- */}
      <section aria-labelledby="separations-heading" className="space-y-5">
        <h2 id="separations-heading" className="text-2xl font-bold">
          What stops it mattering
        </h2>
        <ol className="grid-cards">
          {[
            {
              step: '01',
              title: 'The scoring code cannot see this service',
              body: 'The module that computes a score may not import the module this service lives in, and may not declare it as a dependency. The build fails if either is ever added. Not “does not use it” — cannot.',
            },
            {
              step: '02',
              title: 'Whoever did the work cannot review the result',
              body: 'Recorded in the database, and refused there. A reviewer named against an engagement is rejected however they reach the decision: the console, a script, or a path nobody has written yet.',
            },
            {
              step: '03',
              title: 'The price never depends on what was found',
              body: 'Fixed fee or hourly, and nothing else exists. “Per finding resolved” is the obvious way to price this and the one that would pay us for every fault we report, so there is nowhere in the code to put it.',
            },
            {
              step: '04',
              title: 'You are told, wherever the score appears',
              body: 'If we were paid to work on an application, its verification page says so — beside the score, not in a policy you would have to go looking for.',
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
        <div className="bar">
          <p className="max-w-3xl text-sm">
            None of this makes the conflict disappear. It makes it visible and inert, which is the
            most any rater who also sells services can honestly claim. If that is not enough for
            you, decline — and nothing about your assessment, your badge or your place in the review
            queue changes.
          </p>
        </div>
      </section>

      {/* --- What it actually is ---------------------------------------------- */}
      <section aria-labelledby="offer-heading" className="grid gap-8 sm:grid-cols-2">
        <div className="space-y-3">
          <h2 id="offer-heading" className="text-2xl font-bold">
            What is included
          </h2>
          <ul className="space-y-2">
            {REMEDIATION_OFFER.included.map((line) => (
              <li key={line} className="panel text-sm">
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-3">
          <h2 className="text-2xl font-bold">And what is not</h2>
          <ul className="space-y-2">
            {REMEDIATION_OFFER.notIncluded.map((line) => (
              <li key={line} className="panel text-sm text-muted">
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="pricing-heading" className="space-y-4">
        <h2 id="pricing-heading" className="text-2xl font-bold">
          How it is priced
        </h2>
        <ul className="grid-cards">
          {PRICING_BASIS.map((basis) => (
            <li key={basis} className="panel space-y-2">
              <h3 className="font-semibold">
                {basis === 'fixed_fee' ? 'A fixed fee' : 'By the hour'}
              </h3>
              <p className="text-sm text-muted">
                {basis === 'fixed_fee'
                  ? 'Agreed before anything starts, from the plan. It does not move if the work turns out to be larger than we thought — that is our estimate to get right, not your risk to carry.'
                  : 'For work whose shape is not clear until it is opened. You set a ceiling and we stop at it rather than asking for more.'}
              </p>
            </li>
          ))}
        </ul>
        <p className="max-w-2xl text-sm text-muted">
          There is no third option, and there was never going to be. A price per finding resolved
          would pay us for every fault we report.
        </p>
      </section>

      <section aria-labelledby="stop-heading" className="space-y-3">
        <h2 id="stop-heading" className="text-2xl font-bold">
          How to stop
        </h2>
        <div className="bar">
          <p className="max-w-3xl text-sm">{REMEDIATION_OFFER.howToStop}</p>
        </div>
      </section>

      <section aria-labelledby="disclosure-heading" className="space-y-3">
        <h2 id="disclosure-heading" className="text-2xl font-bold">
          What your verification page will say
        </h2>
        <div className="panel">
          <p className="text-sm text-muted">{REMEDIATION_CLIENT_DISCLOSURE}</p>
        </div>
        <p className="max-w-2xl text-sm text-muted">
          Word for word, beside your score, for as long as the badge is live. If that sentence would
          cost you more than the work is worth, do not buy the work — that is a reasonable
          conclusion and we would rather you reached it here.
        </p>
      </section>

      <section className="flex flex-wrap gap-3">
        <Link
          href="/legal/rating-methodology-and-independence"
          className="rounded-lg border border-line-strong px-5 py-3 font-medium"
        >
          The independence policy
        </Link>
        <Link
          href="/how-it-works"
          className="rounded-lg border border-line-strong px-5 py-3 font-medium"
        >
          What an assessment does
        </Link>
      </section>
    </div>
  );
}
