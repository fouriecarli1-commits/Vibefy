import type { Metadata } from 'next';
import Link from 'next/link';
import { InShort } from '@/components/in-short';
import {
  PREFLIGHT_LEGEND,
  PREFLIGHT_NOT_AN_ASSESSMENT,
  TrustCheckInputError,
  runPreflight,
  type PreflightItem,
  type PreflightResult,
} from '@vibefycode/trustcheck';

export const metadata: Metadata = {
  title: 'Check your own app before you ship it',
  description:
    'Paste your own address and see the things that most often go wrong on a first look: no encryption, nothing telling a phone how to size itself, a key left in the page, no way for anybody to reach you. Free, no account, no score.',
};

/** The plain-language summary, in the shape `tests/plain-language.test.ts` holds. */
const IN_SHORT = [
  'Paste your own address and see what a stranger would find in ten seconds.',
  'It is free, it needs no account, and nothing is kept afterwards.',
  'There is no score and no mark at the end. It is a list of things to go and fix.',
];

export const dynamic = 'force-dynamic';

/**
 * The check you run on your own application before anybody else does.
 *
 * The consumer check beside this one is written for a stranger deciding whether
 * to pay somebody. This is the same machinery pointed the other way, at the
 * person who built the thing — and the questions are different enough that
 * pointing one page at both audiences would have served neither.
 *
 * A GET form, like its sibling, so the result is a link somebody can send to
 * whoever else is working on the application, and so the page works with no
 * JavaScript at all.
 *
 * What it must never become is the product. There is no score here and nowhere
 * to put one: a free thing that produces a number is a free thing people
 * screenshot, and then the number rather than the mark is what VibefyCode
 * means. It says what it is not, at the top, before anybody has run anything.
 */

const TONE: Record<PreflightItem['outcome'], { label: string; tone: string }> = {
  ok: { label: 'Fine', tone: 'ok' },
  unclear: { label: 'Worth a look', tone: 'warn' },
  missing: { label: 'Go and fix', tone: 'bad' },
};

export default async function PreflightPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const submitted = typeof params.url === 'string' ? params.url.trim() : '';

  let result: PreflightResult | null = null;
  let inputError: string | null = null;

  if (submitted) {
    try {
      result = await runPreflight(submitted);
    } catch (error) {
      inputError =
        error instanceof TrustCheckInputError
          ? error.message
          : 'That address could not be opened. Try the application’s main page rather than a deep link.';
    }
  }

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-4">
        <p className="eyebrow">Free, and not an assessment</p>
        <h1 className="text-4xl font-bold tracking-tight">Check your own app before you ship it</h1>
        <p className="text-lg text-muted">
          Ten seconds of what a stranger sees. Most of what comes up here is the same handful of
          things every time: nothing telling a phone how to size itself, no way for anybody to reach
          you, a key sitting in the page source. None of it is hard to fix once somebody has pointed
          at it.
        </p>
      </header>

      <InShort lines={IN_SHORT} />

      {/* Before the form, not after the result. Somebody hoping this is the
          real thing should find out before they run it, not after they have
          screenshotted the output. */}
      <section
        aria-labelledby="not-an-assessment"
        className="space-y-3 rounded-xl border border-line-strong p-6"
      >
        <h2 id="not-an-assessment" className="text-xl font-semibold">
          This is not an assessment, and it earns nothing
        </h2>
        <p className="text-muted">{PREFLIGHT_NOT_AN_ASSESSMENT}</p>
        <p className="text-sm text-muted">
          It also only ever loads the one page you give it, exactly as a browser would. It does not
          go looking for files nobody linked to — we have no way of knowing the address you pasted
          is yours, and testing somebody else’s application without their say-so is the thing this
          whole company refuses to do.
        </p>
      </section>

      <section aria-labelledby="form-heading" className="panel space-y-5">
        <h2 id="form-heading" className="text-lg font-semibold">
          Your application’s address
        </h2>

        <form method="get" className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="url" className="block text-sm font-medium">
              Web address
            </label>
            <input
              id="url"
              name="url"
              type="text"
              inputMode="url"
              autoComplete="url"
              required
              defaultValue={submitted}
              placeholder="my-app.example.com"
              aria-describedby="url-hint"
              className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-3"
            />
            <p id="url-hint" className="text-sm text-muted">
              The page a first-time visitor lands on. That is the one that has to do the work.
            </p>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-accent px-5 py-3 font-medium text-on-accent"
          >
            Look at my app
          </button>
        </form>

        {inputError && (
          <div className="bar" data-tone="bad" role="alert">
            <p className="text-sm">{inputError}</p>
          </div>
        )}
      </section>

      {result && (
        <section aria-labelledby="result-heading" className="space-y-5">
          <h2 id="result-heading" className="text-2xl font-bold tracking-tight">
            What a stranger sees at {result.finalUrl ?? result.requestedUrl}
          </h2>

          {result.unreachable ? (
            <div className="bar" data-tone="bad" role="alert">
              <p className="text-sm">{result.unreachable}</p>
            </div>
          ) : (
            <>
              {/* Counts, never a score. The moment this is one number it is a
                  rating, and it gets screenshotted without any of this page. */}
              <p className="text-muted">
                {result.summary.missing} to go and fix, {result.summary.unclear} worth a look,{' '}
                {result.summary.ok} fine. There is no score here on purpose.
              </p>

              <ul className="space-y-4">
                {result.items.map((entry) => (
                  <li key={entry.id} className="panel space-y-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <h3 className="font-semibold">{entry.question}</h3>
                      <span className="chip" data-tone={TONE[entry.outcome].tone}>
                        {TONE[entry.outcome].label}
                      </span>
                    </div>
                    <p className="text-sm text-muted">{entry.detail}</p>
                    {entry.fix && (
                      <p className="text-sm">
                        <strong>What to do:</strong> {entry.fix}
                      </p>
                    )}
                    {entry.evidence.length > 0 && (
                      <p className="text-sm text-muted">
                        Seen:{' '}
                        {entry.evidence.map((line) => (
                          <code key={line} className="mr-2">
                            {line}
                          </code>
                        ))}
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              <p className="text-sm text-muted">{PREFLIGHT_LEGEND}</p>
            </>
          )}
        </section>
      )}

      <section aria-labelledby="after" className="space-y-3 rounded-xl border border-line p-6">
        <h2 id="after" className="text-lg font-semibold">
          When you want the real thing
        </h2>
        <p className="text-muted">
          An assessment runs the whole published rubric against your application over a period
          rather than in one request, with a person reviewing the findings, and it can earn a mark
          you put on your own site. It starts with proving the application is yours.{' '}
          <Link href="/how-it-works">Here is what happens to it</Link>, and{' '}
          <Link href="/services">here is everything we do</Link>.
        </p>
      </section>
    </div>
  );
}
