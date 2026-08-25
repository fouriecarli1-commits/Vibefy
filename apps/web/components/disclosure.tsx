import type { ReactNode } from 'react';

/**
 * A section that opens.
 *
 * Built on `<details>` and `<summary>` rather than on state and a click
 * handler. Three things come free that are otherwise easy to get wrong: it
 * works with no JavaScript, a keyboard opens it without anything being wired
 * up, and a browser's find-in-page can open it to show a match. A hand-rolled
 * accordion has to earn each of those and usually earns none.
 */
export function Disclosure({
  summary,
  hint,
  children,
  defaultOpen = false,
}: {
  readonly summary: string;
  readonly hint?: string;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
}) {
  return (
    <details className="disclosure" open={defaultOpen}>
      <summary className="disclosure-summary">
        <span className="disclosure-marker" aria-hidden="true" />
        <span>
          <span className="disclosure-label">{summary}</span>
          {hint && <span className="disclosure-hint">{hint}</span>}
        </span>
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

/**
 * The detail of a service, in a fixed order.
 *
 * The order is the argument: what it is, what happens, what you get, what you
 * do not get, and how to stop. A description that omits the last two is a sales
 * page pretending to be an explanation — and this product exists partly to
 * complain about exactly that.
 */
export function ServiceDetailBody({
  detail,
}: {
  readonly detail: {
    readonly plainly: string;
    readonly whatHappens: readonly { readonly step: string; readonly timing: string }[];
    readonly included: readonly string[];
    readonly notIncluded: readonly string[];
    readonly howToStop: string;
  };
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm">{detail.plainly}</p>

      <section className="space-y-3">
        <h4 className="eyebrow">What happens after you pay</h4>
        <ol className="space-y-2">
          {detail.whatHappens.map((entry, index) => (
            <li key={entry.step} className="flex gap-3">
              <span className="eyebrow shrink-0 pt-0.5" data-numeric>
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="space-y-0.5">
                <span className="block text-sm">{entry.step}</span>
                <span className="block text-xs text-muted">{entry.timing}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        <section className="space-y-2">
          <h4 className="eyebrow">Included</h4>
          <ul className="space-y-1.5">
            {detail.included.map((item) => (
              <li key={item} className="text-sm">
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Stated as plainly as the inclusions, and never in smaller type. */}
        <section className="space-y-2">
          <h4 className="eyebrow">Not included</h4>
          <ul className="space-y-1.5">
            {detail.notIncluded.map((item) => (
              <li key={item} className="text-sm text-muted">
                {item}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="space-y-2">
        <h4 className="eyebrow">How to stop</h4>
        <div className="bar">
          <p className="text-sm">{detail.howToStop}</p>
        </div>
      </section>
    </div>
  );
}
