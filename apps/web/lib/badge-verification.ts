import { createClient } from '@supabase/supabase-js';
import { sayItAgain } from './said-recently.ts';
import { readAsAnon } from './sql.ts';

/**
 * The one row every public verification surface reads, by whichever route
 * answers.
 *
 * `/verify` and the badge image route both read exactly one row from
 * `public.badge_verification` by `public_id`, and both read it over a direct
 * Postgres connection on `SUPABASE_DB_URL`. When that connection string is
 * wrong the badge on every customer's site goes grey and `/verify` can say
 * nothing — which is the state this product was in for a week, over a
 * hostname.
 *
 * The view is readable by `anon`, which means Supabase's own API can serve it
 * over HTTPS with the public key, needing no database URL at all. The console
 * already signs in through that key, so when the badge is grey and the console
 * works, this is the route that is still up.
 *
 * Direct first, deliberately. It is one query rather than a round trip through
 * another service, it is the same path the rest of the product reads on, and a
 * fallback that silently became the normal route would hide a broken
 * connection string rather than survive it. So the fallback logs that it was
 * used, every time: a badge that works while something is wrong should still
 * say something is wrong.
 *
 * Row-level security is identical on both routes. The view is granted to
 * `anon` and the direct path sets `set local role anon`; the API key is the
 * anon key. Nothing is reachable here that is not already published.
 */

/** Every column of `public.badge_verification`, as the view publishes them. */
export interface BadgeVerificationRow {
  readonly public_id: string;
  readonly slug: string;
  readonly status: 'active' | 'suspended' | 'expired' | 'revoked';
  readonly score: string;
  readonly rubric_version: string;
  readonly assessed_at: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly certified_origin: string;
  readonly signature: string;
  readonly signing_key_id: string;
  readonly payload: Record<string, unknown>;
  readonly app_name: string;
  readonly owner_is_marketing_client: boolean;
  readonly owner_has_remediation: boolean;
  readonly exit_measurement: unknown;
}

/** Which route answered, so a caller can log it and a test can assert it. */
export type VerificationSource = 'direct' | 'api';

export interface BadgeVerificationLookup {
  readonly row: BadgeVerificationRow | null;
  readonly source: VerificationSource;
}

/**
 * Exactly the columns `public.badge_verification` publishes.
 *
 * Coupled to the view in both directions and checked against it in
 * `tests/the-columns-the-badge-reads.test.ts`, because neither direction can be
 * taken on trust:
 *
 *   · A name here that the view does not have makes the direct query fail with
 *     `column does not exist`, which sends every badge down the fallback — and
 *     the fallback selects the same list, so it fails too and the badge goes
 *     grey everywhere at once. `owner_name` was removed from this view by
 *     migration on 2026-09-23, and had this list not been edited with it, that
 *     is what would have happened.
 *   · A column the view has and this list omits is something published to
 *     `anon` that nothing reads, which is either a leak or dead weight.
 */
export const BADGE_VERIFICATION_COLUMNS = [
  'public_id',
  'slug',
  'status',
  'score',
  'rubric_version',
  'assessed_at',
  'issued_at',
  'expires_at',
  'certified_origin',
  'signature',
  'signing_key_id',
  'payload',
  'app_name',
  'owner_is_marketing_client',
  'owner_has_remediation',
  'exit_measurement',
] as const;

const COLUMNS = BADGE_VERIFICATION_COLUMNS.join(', ');

/**
 * Reads the row, or throws when neither route can answer.
 *
 * Throws rather than returning null on failure, because the two are different
 * and a caller that cannot tell them apart is the defect `/verify` already has
 * a third state for: "never issued" and "we could not look" must not arrive as
 * the same answer.
 */
export async function lookUpBadgeVerification(publicId: string): Promise<BadgeVerificationLookup> {
  try {
    const row = await readAsAnon(async (client) => {
      const { rows } = await client.query<BadgeVerificationRow>(
        `select ${COLUMNS} from public.badge_verification where public_id = $1`,
        [publicId],
      );
      return rows[0] ?? null;
    });
    return { row, source: 'direct' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    /*
     * No spare route, and that used to be the one case nobody was told about.
     *
     * This was `if (!url || !key) throw error`, straight out, before any line
     * was written. Every caller turns the throw into a grey badge or "we could
     * not establish anything", and the only log on the direct path is the one
     * `connectAndExplainRefusals` writes when the *connection* is refused — so
     * a deployment missing its public keys, failing on anything other than a
     * refused connection, produced a grey badge everywhere and not one word
     * anywhere. That is the state this product spent a week in, and the week
     * was spent because nothing said so.
     */
    if (!url || !key) {
      if (sayItAgain(`no-spare-route:${detail}`)) {
        console.error('badge verification failed and has no spare route configured', {
          publicId,
          direct: detail,
          means:
            'The direct connection on SUPABASE_DB_URL could not answer, and NEXT_PUBLIC_SUPABASE_URL ' +
            'or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing, so the published view could not be read over ' +
            'HTTPS either. Every badge is grey until one of the two is fixed.',
        });
      }
      throw error;
    }

    /*
     * The fallback, and what is said about it afterwards rather than before.
     *
     * The "fell back to the Supabase API" line used to be written here, above
     * the call, and it ends with "The badge works; the connection string still
     * needs fixing." When the API then failed as well, that sentence was the
     * only record of the event — a log asserting the badge works, at the moment
     * every badge went grey. A line that states the opposite of what happened
     * is worse than no line, because it sends the reader to the wrong fault.
     *
     * The call is wrapped too. `maybeSingle` returns its error for a refusal
     * from Postgrest, but a transport failure — DNS, a refused socket, a proxy
     * — rejects, and a rejection here used to leave this function entirely with
     * the API's error in place of the direct one. The comment below has always
     * said the original is the more useful of the two because it is the one
     * that is supposed to work; the throwing path quietly did the opposite.
     */
    let row: BadgeVerificationRow | null = null;
    let apiDetail: string | null = null;
    try {
      const api = createClient(url, key, { auth: { persistSession: false } });
      const { data, error: apiError } = await api
        .from('badge_verification')
        .select(COLUMNS)
        .eq('public_id', publicId)
        .maybeSingle();
      if (apiError) apiDetail = apiError.message;
      else row = (data as BadgeVerificationRow | null) ?? null;
    } catch (apiFailure) {
      apiDetail = apiFailure instanceof Error ? apiFailure.message : String(apiFailure);
    }

    if (apiDetail !== null) {
      // Both routes failed, said as that rather than as a fallback. Once a
      // minute and keyed on the direct failure, because this state can hold for
      // days across every impression of every badge.
      if (sayItAgain(`neither-route:${detail}`)) {
        console.error('badge verification could not answer by either route', {
          publicId,
          direct: detail,
          api: apiDetail,
          means:
            'The direct connection and the published view over HTTPS both failed, so every badge is ' +
            'grey and /verify can establish nothing. The direct failure is the one to fix first.',
        });
      }
      // The original is the more useful of the two to report, because it is the
      // one that is supposed to work.
      throw error;
    }

    // Said at error level, not warn. The badge is being served from the spare
    // route, which means the main one is down, and the only thing worse than a
    // grey badge is a working one over a fault nobody is told about.
    //
    // Once a minute, though, and keyed on the failure rather than on the badge:
    // this can hold for days, and a line per impression per embed would bury
    // the one line that matters under the traffic it is measuring.
    if (sayItAgain(`fallback:${detail}`)) {
      console.error('badge verification fell back to the Supabase API', {
        publicId,
        direct: detail,
        means:
          'SUPABASE_DB_URL could not answer, so this row came over HTTPS with the public key ' +
          'instead. The badge works; the connection string still needs fixing.',
      });
    }

    return { row, source: 'api' };
  }
}
