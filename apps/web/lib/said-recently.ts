/**
 * Says a thing once, then holds its tongue for a while.
 *
 * The worker has `saidOnceADay` for this, and the reason is written beside
 * `announceSpendPause`: a condition checked every few seconds and reported
 * every time was "seventeen thousand identical lines a day — and the lift,
 * which is the line somebody is actually waiting for, would have arrived
 * indistinguishable from all of them".
 *
 * The web app has the same problem with a sharper edge. Once the badge can be
 * served from Supabase's API while `SUPABASE_DB_URL` is wrong, that state can
 * last for days, and every badge impression on every customer's site would
 * write two error lines. The outage is worth reporting; the pageview rate is
 * not.
 *
 * Per process, in memory, and that is the right scope: a serverless function
 * is replaced often enough that the message comes back on its own, and nothing
 * here is worth a round trip to store.
 */
const lastSaid = new Map<string, number>();

/** Milliseconds between repeats of the same key. */
const QUIET_FOR_MS = 60_000;

/**
 * Whether to say it. True the first time and then at most once a minute.
 *
 * Takes a key rather than the message, so a message carrying an id or a
 * timestamp does not defeat the whole thing by never repeating.
 */
export function sayItAgain(key: string, now: number = Date.now()): boolean {
  const previous = lastSaid.get(key);
  if (previous !== undefined && now - previous < QUIET_FOR_MS) return false;
  lastSaid.set(key, now);
  return true;
}

/** Forgets everything said. For tests, which share a process. */
export function forgetWhatWasSaid(): void {
  lastSaid.clear();
}
