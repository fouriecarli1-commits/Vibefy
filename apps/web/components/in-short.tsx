/**
 * The plain-language summary at the top of a long page.
 *
 * Anré asked for the language to be understandable, and he is right that it is
 * not always. These pages are careful, and careful writing about a careful
 * subject gets long: the sentence that states a limit properly is rarely the
 * short one. The result is pages that are honest and hard work, which is a poor
 * trade for a reader who has not decided yet whether to care.
 *
 * So each long page opens with two to four short lines saying what it is, in
 * words somebody reading English as a second language can take at speed. It is
 * not a teaser and it is not marketing: if the page says a thing is limited,
 * the summary says so too, because a summary that only carries the good half is
 * how somebody ends up reading the rest as small print.
 *
 * `tests/plain-language.test.ts` holds the shape of it. Short sentences, no
 * semicolons, no dashes standing in for a full stop, and none of the words we
 * use among ourselves — rubric, criterion, remediation — which mean nothing to
 * a person on their first visit. The rule is enforced rather than intended,
 * because prose drifts back towards whoever is writing it.
 */
export function InShort({ lines }: { lines: readonly string[] }) {
  return (
    <aside aria-labelledby="in-short" className="in-short">
      <h2 id="in-short" className="eyebrow">
        In short
      </h2>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </aside>
  );
}
