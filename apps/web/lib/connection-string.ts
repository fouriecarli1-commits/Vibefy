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
    return `SUPABASE_DB_URL points at ${host}, the direct database host. It publishes no IPv4 address and these functions have no IPv6 outbound, so it cannot be reached from here at all. Copy the transaction pooler string instead: Supabase → Settings → Database → Connection string → Transaction pooler.`;
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
