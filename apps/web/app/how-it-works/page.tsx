import type { Metadata } from 'next';
import Link from 'next/link';
import { DEFAULT_CEILING } from '@vibefycode/engine/scope';
import { RETENTION_DAYS } from '@vibefycode/engine/evidence';

export const metadata: Metadata = {
  title: 'What happens to your app',
  description:
    'Step by step: what a VibefyCode assessment does, what it is structurally unable to do, and how long anything is kept.',
};

/**
 * The page that has to be true before anybody will use this product.
 *
 * Somebody who built an app quickly is being asked to let a stranger's software
 * open it and poke at it. "Trust us" is worth nothing here — it is exactly what
 * the thing they are afraid of would also say. So this page does not ask for
 * trust. It describes the mechanism, in order, and states the limits as facts
 * about how the code is built rather than as promises about how we behave.
 *
 * Every number below is imported from the code that enforces it. The ceiling is
 * `DEFAULT_CEILING` from the scope guard; the retention periods are
 * `RETENTION_DAYS` from the evidence store. A page that restates its own
 * product's limits in prose drifts away from them within a release, and the
 * drift always goes one way — the page keeps claiming the safer number. These
 * cannot: change the guard and this page changes with it.
 */
/** Named so the conversion is not mistaken for the ceiling written out. */
const SECONDS_PER_MINUTE = 60;

export default function HowItWorksPage() {
  // Minutes, not hours. The ceiling is half an hour, and "0.5 hours" is a way
  // of writing thirty minutes that nobody reads as thirty minutes.
  const minutes = Math.round(DEFAULT_CEILING.maxDurationSeconds / SECONDS_PER_MINUTE);
  // Derived too. An earlier draft opened this paragraph with the word "Sixty",
  // which is the ceiling restated in prose — lower the guard and the page goes
  // on advertising the old number, which is the one direction that matters.
  const perSecond = (DEFAULT_CEILING.maxRequestsPerMinute / SECONDS_PER_MINUTE).toFixed(1);

  return (
    <div className="space-y-16">
      <header className="space-y-4">
        <p className="eyebrow">Before you submit anything</p>
        <h1 className="text-4xl font-bold">What happens to your app</h1>
        <p className="max-w-2xl text-lg text-muted">
          You are about to let software you did not write open an application you did. That is a
          reasonable thing to be careful about. This page is the mechanism, in order, with the
          limits stated as what the code cannot do rather than as what we promise not to.
        </p>
      </header>

      {/* --- The question everybody actually has ---------------------------- */}
      <section aria-labelledby="code-heading" className="space-y-5">
        <h2 id="code-heading" className="text-2xl font-bold">
          We never see your code
        </h2>
        <div className="bar" data-tone="ok">
          <p className="max-w-3xl text-sm">
            There is nowhere to give it to us. No repository access, no upload, no integration that
            reads your files. VibefyCode opens the address you gave us in a browser and looks at
            what a visitor would see — the pages that render, the requests they make, the headers
            that come back. If your source is not published on the internet, we have not read it.
          </p>
        </div>
        <p className="max-w-2xl text-sm text-muted">
          This is a fact about the shape of the product rather than a policy. There is no code path
          that could read a repository, because nothing in this system has ever been given one.
        </p>
      </section>

      {/* --- The five steps -------------------------------------------------- */}
      <section aria-labelledby="steps-heading" className="space-y-5">
        <div className="space-y-2">
          <h2 id="steps-heading" className="text-2xl font-bold">
            The five steps, and what we can see at each
          </h2>
          <p className="max-w-2xl text-muted">
            Nothing skips ahead. Each step waits for the one before it, and the first two happen
            before anything touches your application at all.
          </p>
        </div>

        <ol className="space-y-3">
          {[
            {
              step: '01',
              title: 'You describe the application',
              what: 'A name and an address. That is the whole form.',
              sees: 'Nothing yet. No request has been made to your app.',
            },
            {
              step: '02',
              title: 'You prove you control it',
              what: 'Publish a DNS record, or put a small text file at a known path on your own site. Then press Verify.',
              sees: 'One request, to that one file, to read one token. Nothing is assessed and nothing is stored about your application beyond the fact that the check passed.',
            },
            {
              step: '03',
              title: 'You set the boundary',
              what: 'Which hosts are in scope, which paths are excluded, and how hard the run may push. Exclusions always win over inclusions.',
              sees: 'Still nothing. This is you writing the rules the next step is held to.',
            },
            {
              step: '04',
              title: 'The assessment runs',
              what: `Inside the boundary you set, under the ceiling below. It stops at ${minutes} minutes whatever else is true — a run that has not finished by then is a run that has found what it is going to find.`,
              sees: 'Your public pages, the requests they make, and anything a synthetic test account can reach. Every observation is captured as evidence, and the evidence is yours to read.',
            },
            {
              step: '05',
              title: 'A person reviews it',
              what: 'A VibefyCode reviewer checks every finding against its evidence and withholds any the evidence does not support. Usually within one working day.',
              sees: 'The same evidence you can see. Nothing is published before this step.',
            },
          ].map((item) => (
            <li key={item.step} className="panel space-y-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="eyebrow" data-numeric>
                  {item.step}
                </span>
                <h3 className="font-semibold">{item.title}</h3>
              </div>
              <p className="text-sm">{item.what}</p>
              <p className="text-sm text-muted">
                <span className="font-medium text-ink">What we can see:</span> {item.sees}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* --- The ceiling, in the numbers the guard enforces ------------------- */}
      <section aria-labelledby="ceiling-heading" className="space-y-5">
        <div className="space-y-2">
          <h2 id="ceiling-heading" className="text-2xl font-bold">
            The ceiling your app is protected by
          </h2>
          <p className="max-w-2xl text-muted">
            These are read from the scope guard itself, not written out here. A run that tries to
            exceed one of them is stopped by the code rather than reported afterwards.
          </p>
        </div>

        <div className="grid-cards">
          <div className="stat">
            <span className="stat-value">{DEFAULT_CEILING.maxRequestsPerMinute}</span>
            <span className="stat-label">Requests per minute, at most</span>
          </div>
          <div className="stat">
            <span className="stat-value">
              {DEFAULT_CEILING.maxTotalRequests.toLocaleString('en')}
            </span>
            <span className="stat-label">Requests in the whole run</span>
          </div>
          <div className="stat">
            <span className="stat-value">{minutes} min</span>
            <span className="stat-label">Longest a run may last</span>
          </div>
        </div>

        <p className="max-w-2xl text-sm text-muted">
          That is roughly {perSecond} request{perSecond === '1' ? '' : 's'} a second — slower than
          one person clicking quickly, and far below anything that would trouble a server. If your
          application is small enough that this still worries you, say so when you set the boundary
          and the ceiling comes down.
        </p>
      </section>

      {/* --- What it structurally cannot do ---------------------------------- */}
      <section aria-labelledby="never-heading" className="space-y-5">
        <div className="space-y-2">
          <h2 id="never-heading" className="text-2xl font-bold">
            What it is unable to do
          </h2>
          <p className="max-w-2xl text-muted">
            Not a list of things we choose not to do. A list of things the runner refuses, at the
            moment it opens the connection.
          </p>
        </div>

        <ul className="grid-cards">
          {[
            {
              title: 'Change or delete anything',
              body: `DELETE, PUT and PATCH are never sent. ${DEFAULT_CEILING.allowDataModification ? '' : 'Data modification is off, '}and the run is non-destructive by construction — a stage that tried would be stopped before the request left.`,
            },
            {
              title: 'Touch a host you did not authorise',
              body: 'The address is checked after it resolves, not just as text. A hostname that points somewhere else — including at an internal address — is refused at connect time, which closes the window a check on the URL alone would leave open.',
            },
            {
              title: 'Use your real accounts',
              body: 'Synthetic test accounts only. We never ask for, accept or store a real user credential, and there is no field in which to give us one.',
            },
            {
              title: 'Export your data',
              body: `Data export is off. The run reads what a page shows; it does not pull records out of your application.`,
            },
            {
              title: 'Keep running after you say stop',
              body: 'Withdrawing authorisation stops the run. Nothing claims new work for an application whose authorisation is no longer live.',
            },
            {
              title: 'Spend without a limit',
              body: 'A global spending cap is checked before any run is claimed. It is a row in the database rather than state in a process, so restarting the runner does not lift it.',
            },
          ].map((item) => (
            <li key={item.title} className="panel space-y-1.5">
              <h3 className="font-semibold">{item.title}</h3>
              <p className="text-sm text-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* --- What is kept, and for how long ----------------------------------- */}
      <section aria-labelledby="evidence-heading" className="space-y-5">
        <div className="space-y-2">
          <h2 id="evidence-heading" className="text-2xl font-bold">
            What is kept, and for how long
          </h2>
          <p className="max-w-2xl text-muted">
            Evidence is what makes a finding checkable rather than an opinion, so it is kept — and
            then it is deleted, on a clock set when it is captured rather than when somebody
            remembers.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Evidence kinds and how many days each is retained</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-line py-2 text-left font-semibold">
                  Kind of evidence
                </th>
                <th scope="col" className="border-b border-line py-2 text-right font-semibold">
                  Kept for
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(RETENTION_DAYS)
                .sort((a, b) => a[1] - b[1])
                .map(([kind, days]) => (
                  <tr key={kind}>
                    <td className="border-b border-line py-2">{kind.replace(/_/g, ' ')}</td>
                    <td className="tabular border-b border-line py-2 text-right">{days} days</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="bar">
          <p className="max-w-3xl text-sm">
            Screenshots and traces are held for the shortest time, because they are where something
            incidental is most likely to have been captured. Credentials are scrubbed at capture
            rather than before publication — an artefact that has to be remembered about later is an
            artefact that eventually gets published unsanitised.
          </p>
        </div>
      </section>

      {/* --- The honest limits ------------------------------------------------ */}
      <section aria-labelledby="not-heading" className="space-y-3">
        <h2 id="not-heading" className="text-2xl font-bold">
          And what this is not
        </h2>
        <div className="bar" data-tone="warn">
          <p className="max-w-3xl text-sm">
            An assessment is point-in-time and scope-limited. It is not a penetration test, a
            security audit, a code audit, a legal or regulatory certification, or a guarantee of any
            kind. It does not certify that an application is free of defects, lawful, or fit for any
            particular purpose. Absence of a finding is not evidence that nothing is there — it
            means we did not find it within the boundary you set.
          </p>
        </div>
      </section>

      <section className="flex flex-wrap gap-3">
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
          How the score is worked out
        </Link>
        <Link
          href="/legal"
          className="rounded-lg border border-line-strong px-5 py-2.5 font-medium"
        >
          The terms, in full
        </Link>
      </section>
    </div>
  );
}
