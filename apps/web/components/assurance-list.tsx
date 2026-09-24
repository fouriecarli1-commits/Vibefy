import Link from 'next/link';
import {
  ASSURANCE_LEGEND,
  VERIFICATION_STEPS,
  assuranceFor,
  assuranceHeadline,
  type AssuranceInput,
  type AssuranceLine,
} from '@vibefycode/assurance';

/**
 * The tick list, for the person who clicked the mark.
 *
 * Two decisions in here are worth more than the rest of the component.
 *
 * **It never says how many findings there were, or what they were.** A visitor
 * is told that an area turned something up; they are not given a list of a
 * stranger's open weaknesses on a page anybody can read. That information
 * belongs to the owner — it is in their report, and publishing it is their
 * decision to make, not ours. It would also be a map: "one medium finding
 * against guessable object references" is an instruction, not a disclosure.
 *
 * **A question nobody checked looks nothing like a tick.** `not_tested` is
 * rendered as prominently as a pass, because a list that quietly drops what it
 * cannot answer is the precise way assurance seals mislead people: the reader
 * assumes the missing line was fine.
 */

const STATE_MARK: Record<
  AssuranceLine['state'],
  { mark: string; label: string; short: string; tone: string }
> = {
  checked_clear: {
    mark: '✓',
    label: 'Checked — nothing found',
    short: 'Nothing found',
    tone: 'text-ok',
  },
  checked_found: {
    mark: '!',
    label: 'Checked — something was found',
    short: 'Something found',
    tone: 'text-warn',
  },
  not_tested: { mark: '–', label: 'Not tested', short: 'Not tested', tone: 'text-muted' },
};

/**
 * The same nine answers, at a glance.
 *
 * A visitor who clicked a mark on a stranger's site gives this page seconds,
 * not minutes, and nine cards of prose is longer than that. So the grid is the
 * whole list in one screenful, and every cell links to the paragraph that says
 * what was actually checked — the summary is a way into the detail, never a
 * replacement for it.
 *
 * Three things keep it from becoming the thing it summarises:
 *
 *   · It is built from the same `lines` the list below is built from, in the
 *     same component. There is no second call to `assuranceFor`, so a grid that
 *     disagrees with the list underneath it is not a bug that can happen.
 *   · Every cell carries the state in words as well as a symbol. A grid of
 *     symbols is read as a scorecard, and a dash in a column of ticks reads as
 *     a small blemish rather than as "nobody looked at this".
 *   · There is no count, no ratio and no "7 of 9". A fraction invites the
 *     reader to do arithmetic on questions that are not comparable, and it is
 *     one short step from there to a second score.
 */
function AssuranceGrid({ lines }: { lines: readonly AssuranceLine[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {lines.map((line) => {
        const state = STATE_MARK[line.state];
        return (
          <li key={line.claim.id}>
            <a
              href={`#assurance-${line.claim.id}`}
              className="flex h-full items-start gap-3 rounded-xl border border-line p-4 no-underline hover:border-line-strong focus-visible:border-line-strong"
            >
              {/* The box, drawn rather than an input.
                  
                  A real checkbox would be an interactive control that does
                  nothing when clicked, announced to a screen reader as
                  something the reader can change. This is a statement of fact,
                  so it is drawn as one and the state is in the text beside it
                  where assistive software will read it in order. */}
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line text-sm font-bold ${state.tone}`}
              >
                {state.mark}
              </span>
              <span className="space-y-1">
                <span className="block text-sm font-medium text-ink">{line.claim.shortLabel}</span>
                <span className={`block text-sm ${state.tone}`}>{state.short}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function AssuranceList({ input }: { input: AssuranceInput }) {
  const lines = assuranceFor(input);

  return (
    <section aria-labelledby="assurance" className="space-y-6">
      <div className="space-y-3">
        <h2 id="assurance" className="text-2xl font-bold tracking-tight">
          What was checked
        </h2>
        <p className="max-w-prose text-muted">{assuranceHeadline(input, lines)}</p>
      </div>

      <AssuranceGrid lines={lines} />

      <ul className="space-y-4">
        {lines.map((line) => {
          const state = STATE_MARK[line.state];
          return (
            <li
              key={line.claim.id}
              id={`assurance-${line.claim.id}`}
              className="scroll-mt-24 rounded-xl border border-line p-5"
            >
              <div className="flex gap-4">
                {/* A fixed width, because a tick, an exclamation mark and a
                    dash are three different widths, and without it the nine
                    questions do not line up with each other. Three pixels of
                    raggedness, on the page a stranger lands on — found by our
                    own design survey the first time it was pointed here. */}
                <span
                  aria-hidden="true"
                  className={`w-6 shrink-0 text-center text-xl font-bold ${state.tone}`}
                >
                  {state.mark}
                </span>
                <div className="space-y-2">
                  <h3 className="font-semibold">{line.claim.question}</h3>
                  <p className={`text-sm font-medium ${state.tone}`}>{state.label}</p>

                  {line.state === 'not_tested' ? (
                    <p className="max-w-prose text-sm text-muted">{line.notTestedBecause}</p>
                  ) : (
                    <p className="max-w-prose text-sm text-muted">{line.claim.whatWeChecked}</p>
                  )}

                  {line.state === 'checked_found' && (
                    // Said, and not detailed. What was found is in the owner's
                    // report; it is theirs to publish, and a list of somebody
                    // else's open weaknesses on a public page is a map rather
                    // than a disclosure.
                    <p className="max-w-prose text-sm">
                      This area turned something up. What it was, and how serious, is in the owner’s
                      report — it is theirs to share, not ours to publish.
                    </p>
                  )}

                  {line.partialBecause !== null && (
                    // How much of the question the mark above speaks for.
                    //
                    // `whatWeChecked` is printed in the past tense and covers
                    // the whole question, so on a line where only part of it
                    // was covered it promises more than happened. Printed here
                    // rather than folded into that paragraph because the two
                    // sentences come from different places — one is what we
                    // always do, the other is what happened this time — and a
                    // reader who cannot tell them apart cannot check either.
                    <p className="max-w-prose text-sm text-muted">
                      <strong className="font-medium text-ink">
                        How much of this was covered:
                      </strong>{' '}
                      {line.partialBecause}
                    </p>
                  )}

                  {line.state !== 'not_tested' && (
                    <p className="max-w-prose text-sm text-muted">
                      <strong className="font-medium text-ink">What this does not mean:</strong>{' '}
                      {line.claim.limitation}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="max-w-prose rounded-xl border border-line bg-surface-muted p-5 text-sm text-muted">
        {ASSURANCE_LEGEND}
      </p>
    </section>
  );
}

/**
 * The three steps, which are a fact about us rather than about the application.
 *
 * The part a visitor has least reason to believe without being told, and the
 * part that separates this from a graphic anybody can copy into a footer.
 */
export function VerificationSteps() {
  return (
    <section aria-labelledby="three-steps" className="space-y-4">
      <h2 id="three-steps" className="text-2xl font-bold tracking-tight">
        How anything gets this mark
      </h2>
      <p className="max-w-prose text-muted">
        Three steps, in this order, every time. None of them can be skipped by paying.
      </p>
      <ol className="space-y-4">
        {VERIFICATION_STEPS.map((step) => (
          <li key={step.step} className="rounded-xl border border-line p-5">
            <p className="eyebrow">Step {step.step}</p>
            <h3 className="mt-1 font-semibold">{step.title}</h3>
            <p className="mt-2 max-w-prose text-sm text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted">
        <Link href="/methodology">The rubric, published in full</Link> ·{' '}
        <Link href="/how-it-works">What happens to an application we test</Link>
      </p>
    </section>
  );
}
