import type { Metadata } from 'next';
import Link from 'next/link';
import {
  TRAP_ARTICLES,
  TRUST_CHECK_LEGEND,
  TRUST_CHECK_NOT_A_BADGE,
  TrustCheckInputError,
  runTrustCheck,
  type Observation,
  type TrustCheckResult,
} from '@vibefycode/trustcheck';

export const metadata: Metadata = {
  title: 'Check an app before you pay',
  description:
    'Paste the web address of an app you are about to pay for. VibefyCode reports what its public page does and does not say — whether it can be cancelled, whether there is anyone to contact, and who the company is.',
};

export const dynamic = 'force-dynamic';

/**
 * The consumer trust check.
 *
 * A form that submits with GET rather than a server action, deliberately: the
 * result is then a link. Somebody can send it to the person who asked them
 * whether an app was worth paying for, which is how this actually gets used.
 * It also means the page works with no JavaScript at all.
 *
 * The acceptance tick is required by the form, not by script, for the same
 * reason — a control that only works when JavaScript loads is a control that
 * sometimes does not exist.
 */

const TONE: Record<Observation['outcome'], { label: string; tone: string }> = {
  found: { label: 'Found', tone: 'ok' },
  unclear: { label: 'Unclear', tone: 'warn' },
  not_found: { label: 'Not found', tone: 'bad' },
};

export default async function TrustCheckPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const submitted = typeof params.url === 'string' ? params.url.trim() : '';
  const accepted = params.accept === 'on';

  let result: TrustCheckResult | null = null;
  let inputError: string | null = null;

  if (submitted && accepted) {
    try {
      result = await runTrustCheck(submitted);
    } catch (error) {
      inputError =
        error instanceof TrustCheckInputError
          ? error.message
          : 'That address could not be checked. Try the site’s main page rather than a deep link.';
    }
  } else if (submitted && !accepted) {
    inputError = 'Tick the box to say you have read what this check is and is not.';
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <p className="eyebrow">Before you pay</p>
        <h1 className="max-w-3xl text-3xl font-bold sm:text-4xl">
          Check an app before you hand over a card
        </h1>
        <p className="max-w-2xl text-muted">
          Paste the web address of an app you are about to subscribe to. We look at its public page
          and report what it says — and what it does not say — about cancelling, contacting a human,
          and who the company actually is.
        </p>
      </section>

      <section aria-labelledby="form-heading" className="panel space-y-5">
        <h2 id="form-heading" className="text-lg font-semibold">
          The app’s web address
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
              placeholder="example.com"
              aria-describedby="url-hint"
              className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-3"
            />
            <p id="url-hint" className="text-sm text-muted">
              The app’s own website works best. An app store listing tells us less, because the
              store’s page is not the company’s page.
            </p>
          </div>

          {/* Required by the form itself. A declaration enforced only by script
              is a declaration that is sometimes not made. */}
          <div className="flex items-start gap-3">
            <input
              id="accept"
              name="accept"
              type="checkbox"
              required
              defaultChecked={accepted}
              className="mt-1 h-4 w-4 accent-[var(--vibefycode-accent)]"
            />
            <label htmlFor="accept" className="text-sm">
              I have read what this check is and is not. I understand it looks at one public page
              from outside, that it is not an assessment or a recommendation, that VibefyCode
              accepts no liability for any decision I make on the basis of it, and that the{' '}
              <Link href="/legal/terms-of-service">Terms of Service</Link> and{' '}
              <Link href="/legal/privacy-policy">Privacy Policy</Link> apply.
            </label>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-accent px-5 py-3 font-medium text-on-accent"
          >
            Check this app
          </button>
        </form>

        {inputError && (
          <div className="bar" data-tone="bad" role="alert">
            <p className="text-sm">{inputError}</p>
          </div>
        )}
      </section>

      {result && <Result result={result} />}

      <section aria-labelledby="limits-heading" className="space-y-3">
        <h2 id="limits-heading" className="text-xl font-bold">
          What this is, and what it is not
        </h2>
        <div className="bar" data-tone="warn">
          <p className="max-w-3xl text-sm">{TRUST_CHECK_LEGEND}</p>
        </div>
        <div className="bar">
          <p className="max-w-3xl text-sm">{TRUST_CHECK_NOT_A_BADGE}</p>
        </div>
      </section>

      <section aria-labelledby="traps-heading" className="space-y-4">
        <div className="space-y-2">
          <h2 id="traps-heading" className="text-xl font-bold">
            How people get caught
          </h2>
          <p className="max-w-2xl text-muted">
            Knowing that a page has no cancellation link only helps if you know why that matters.
          </p>
        </div>
        <ul className="grid-cards">
          {TRAP_ARTICLES.map((article) => (
            <li key={article.slug} className="panel space-y-2">
              <h3 className="font-semibold">
                <Link href={`/trust-check/traps/${article.slug}`}>{article.title}</Link>
              </h3>
              <p className="text-sm text-muted">{article.summary}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Result({ result }: { result: TrustCheckResult }) {
  const { summary } = result;

  return (
    <section aria-labelledby="result-heading" className="space-y-5">
      <div className="space-y-2">
        <h2 id="result-heading" className="text-xl font-bold">
          What that page says
        </h2>
        <p className="text-sm text-muted">
          <span className="tabular">{result.finalUrl ?? result.requestedUrl}</span> · looked at{' '}
          <span className="tabular">{result.checkedAt.slice(0, 16).replace('T', ' ')} UTC</span>
        </p>
      </div>

      {/* Counts, never a score. The moment this becomes one figure it reads as a
          rating, gets screenshotted without its context, and becomes the thing
          the rest of the product refuses to be. */}
      <div className="grid-cards">
        <div className="stat">
          <span className="stat-value">{summary.found}</span>
          <span className="stat-label">Questions answered</span>
        </div>
        <div className="stat">
          <span className="stat-value">{summary.unclear}</span>
          <span className="stat-label">Answered unclearly</span>
        </div>
        <div className="stat">
          <span className="stat-value">{summary.notFound}</span>
          <span className="stat-label">Not answered</span>
        </div>
      </div>

      {summary.highWeightMissing > 0 && (
        <div className="bar" data-tone="warn">
          <p className="max-w-3xl text-sm">
            <strong>{summary.highWeightMissing}</strong> of the questions that matter most before
            paying — cancelling, contacting a person, and who the company is — were not answered on
            that page. That does not mean the answers do not exist. It means they were not where
            somebody deciding whether to pay would look.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {result.observations.map((observation) => (
          <li key={observation.id} className="panel space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="font-semibold">{observation.question}</h3>
              <span className="chip" data-tone={TONE[observation.outcome].tone}>
                {TONE[observation.outcome].label}
              </span>
            </div>
            <p className="text-sm">{observation.detail}</p>
            {observation.evidence.length > 0 && (
              <ul className="space-y-1">
                {observation.evidence.map((item) => (
                  <li key={item} className="text-xs text-muted">
                    <code>{item}</code>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
