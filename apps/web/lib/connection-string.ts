/**
 * What is wrong with `SUPABASE_DB_URL`, said in the words of the fix.
 *
 * Written after an outage that took four rounds to diagnose. The badge route
 * logged what `pg` threw, faithfully, and what `pg` throws is `getaddrinfo
 * ENOTFOUND db.<ref>.supabase.co` or `password authentication failed for user
 * "postgres"`. Both are true and neither says what to do, so each round was a
 * guess, a deploy and a wait.
 *
 * Every one of those failures is visible in the string itself, before a socket
 * is opened. Three mistakes account for all of them, and each has exactly one
 * fix:
 *
 *   · The direct host. `db.<ref>.supabase.co` publishes no A record — only
 *     AAAA — and this runs on serverless functions with no IPv6 outbound. Not
 *     slow, not capped: unreachable.
 *   · The pooler host with the direct username. The pooler authenticates as
 *     `postgres.<project-ref>`; a URI with only the host changed arrives as
 *     `postgres` and is refused, which reads as a wrong password and sends
 *     somebody to reset one that was never wrong.
 *   · The placeholder left in. `[YOUR-PASSWORD]` pastes through unnoticed, and
 *     the square brackets make it look like it was meant to be there.
 *
 * This is deliberately not a connectivity check. It reads a string, says what
 * it sees, and stays wrong-free about everything it cannot see — a password
 * that is simply wrong looks identical to a right one from here, and this says
 * nothing about it.
 */

/** The reason, and the sentence that fixes it. Null when nothing is visibly wrong. */
export function whatIsWrongWithTheConnectionString(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'SUPABASE_DB_URL is not a URL. It should start with postgresql:// and end with /postgres.';
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    return `SUPABASE_DB_URL starts with ${url.protocol}//, which is not a database address. It should start with postgresql://.`;
  }

  // Checked before the host, because a string can carry both mistakes and this
  // is the one somebody can act on without opening another tab.
  if (/%5BYOUR-PASSWORD%5D|\[YOUR-PASSWORD\]/i.test(raw)) {
    return 'SUPABASE_DB_URL still contains [YOUR-PASSWORD]. Replace it — square brackets and all — with the database password from Supabase → Settings → Database.';
  }

  const host = url.hostname;
  const user = decodeURIComponent(url.username);

  if (/^db\..+\.supabase\.co$/i.test(host)) {
    /*
     * Two different things live on this hostname, and both are unreachable.
     *
     * Port 5432 is the direct connection. Port 6543 is the *dedicated* pooler,
     * which Supabase offers on paid plans and which is a pooler in every sense
     * except the one that matters here. Saying "the direct host" to somebody
     * looking at a panel that says "Dedicated pooler" sends them away certain
     * they already did this, which is a round-trip the sentence exists to
     * prevent.
     *
     * The hostname publishes no A record, only AAAA. That is the whole fault,
     * and it belongs to the name rather than to either port.
     */
    const dedicated = url.port === '6543';
    return `SUPABASE_DB_URL points at ${host}, which is ${dedicated ? 'the dedicated pooler' : 'the direct connection'}. Both live on that hostname, and it publishes no IPv4 address — only IPv6, which these functions have no route to. Neither can be reached from here at all. The one that works is the shared pooler, whose host ends in pooler.supabase.com and whose username carries the project reference after a dot: Supabase → Connect → Shared pooler.`;
  }

  if (host.endsWith('pooler.supabase.com')) {
    if (!user.includes('.')) {
      return `SUPABASE_DB_URL uses the pooler host but the username "${user}". The pooler authenticates as postgres.<project-ref> — the project reference is part of the username, after a dot. Copy the whole string from Supabase rather than editing the direct one; a refused login here reads as a wrong password and is not one.`;
    }
    if (url.port === '5432') {
      // Allowed, and worth saying: the session pooler holds a connection for
      // the whole session, which is the wrong shape for functions that scale
      // out. It will work, so this is not an error.
      return null;
    }
  }

  return null;
}

/**
 * What a refusal from the database means, where the words mislead.
 *
 * Separate from the check above because this reads what came back rather than
 * what was sent. One case so far, and it earned its place in an evening: a
 * password reset left a second service — the worker — retrying with the old
 * one every few seconds, and Supabase's pooler tripped a breaker that blocks
 * *everybody's* new connections. The console then failed with what looks
 * exactly like its own bad password, while its password was fine, and the
 * thing to fix was somewhere else entirely.
 *
 * Returns null for anything it does not recognise, so the raw message is never
 * replaced by a guess.
 */
export function whyTheDatabaseRefused(message: string): string | null {
  if (/circuit breaker|too many authentication failures/i.test(message)) {
    return 'Supabase has temporarily blocked new connections after repeated failed logins, so this says nothing about the password used here. Something else is still trying with an old one — usually a second service such as the worker — and every retry pushes the block further out. Correct that service\u2019s password or stop it, then wait for the block to lift.';
  }
  return null;
}
