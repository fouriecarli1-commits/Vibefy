/**
 * Deciding whether the page somebody is looking at carries a live badge,
 * without telling anybody which page it is.
 *
 * The whole design of this extension is in the two words "without telling". An
 * extension that lights up by itself has to watch every page you open, and one
 * that asks a server "does this site have a badge" has sent that server a
 * browsing history one request at a time, whatever its listing promises.
 * Neither is a thing to ship in order to be slightly more convenient than a
 * bookmark.
 *
 * So the list of live badges is downloaded whole, on a schedule, and every
 * question is answered from the copy already on the computer. Nothing here
 * makes a network call and there is nowhere in the shape for one.
 *
 * Plain JavaScript, because this is what the browser loads: a build step for
 * four functions is a thing that breaks in a year when nobody remembers it
 * exists. Types come from the JSDoc below, checked by `pnpm typecheck` like
 * everything else.
 */

/**
 * @typedef {{ badgeId: string, certifiedOrigin: string | null, rubricVersion: string,
 *             assessedOn: string, expiresOn: string | null, verificationPage: string }} LiveBadgeEntry
 * @typedef {{ generatedAt: string, badges: LiveBadgeEntry[] }} StoredList
 * @typedef {'badged' | 'none' | 'not_a_page' | 'no_list'} AnswerKind
 * @typedef {{ kind: AnswerKind, detail: string, origin?: string, entry?: LiveBadgeEntry }} Answer
 */

/**
 * The origin of a URL, or null when the address is not a web page.
 *
 * A new tab, a settings screen, an extension's own page and a local file are
 * all addresses somebody can be looking at, and none of them can carry a
 * badge. Saying so is better than saying "no badge", which reads as a finding.
 *
 * @param {string} url
 * @returns {string | null}
 */

export function originOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether a badge's certified origin covers the page being looked at.
 *
 * Exact origin only. A badge issued for `https://kettle.example` does not
 * cover `https://shop.kettle.example`, and treating a subdomain as covered is
 * how a mark earned by one application ends up vouching for another — which is
 * the misuse the badge licence exists to forbid. `www` is the one exception,
 * because it is the same site by every measure except the string.
 *
 * @param {string | null} certifiedOrigin
 * @param {string} origin
 * @returns {boolean}
 */
export function coversOrigin(certifiedOrigin, origin) {
  if (!certifiedOrigin) return false;
  const certified = originOf(certifiedOrigin);
  if (!certified) return false;
  if (certified === origin) return true;
  /** @param {string} value */
  const withoutWww = (value) => value.replace('://www.', '://');
  return withoutWww(certified) === withoutWww(origin);
}

/** How stale a downloaded list may be before the answer says so. */
export const LIST_STALE_AFTER_HOURS = 24;

/**
 * @param {StoredList | null} list
 * @param {string} url
 * @param {Date} [now]
 * @returns {Answer}
 */
export function answerFor(list, url, now = new Date()) {
  if (!list) {
    return {
      kind: 'no_list',
      detail:
        'The list of live badges has not been downloaded yet. Open this again in a moment — it is fetched in one request, on a schedule, and never per site.',
    };
  }

  const origin = originOf(url);
  if (!origin) {
    return { kind: 'not_a_page', detail: 'This is not a web page, so there is nothing to check.' };
  }

  const entry = list.badges.find((badge) => coversOrigin(badge.certifiedOrigin, origin));
  const age = (now.getTime() - new Date(list.generatedAt).getTime()) / 3600000;
  const staleness =
    age > LIST_STALE_AFTER_HOURS
      ? ` This copy of the list is ${Math.floor(age / 24)} day(s) old, so check the verification page before relying on it.`
      : '';

  if (!entry) {
    return {
      kind: 'none',
      origin,
      detail: `${origin} is not in the list of badged sites on this computer. That is not a finding about it: most sites have never asked for a badge, and a site that has one can ask not to be listed publicly. Both look the same from here.${staleness}`,
    };
  }

  return {
    kind: 'badged',
    origin,
    entry,
    detail: `Assessed on ${entry.assessedOn} against rubric v${entry.rubricVersion}.${staleness}`,
  };
}
