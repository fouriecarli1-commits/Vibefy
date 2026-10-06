/**
 * Whether this address belongs to a domain that requires single sign-on.
 *
 * Asked before a password is accepted, in two places — the web sign-in form and
 * the one on the phone — and both discarded the lookup's error:
 *
 *     const { data: routing } = await supabase.rpc('sso_routing', { … });
 *     if (route?.email_domain) { … refuse the password … }
 *
 * A failed call returns no data, so `route` is undefined, so the branch is
 * skipped and the password is accepted. The control is off exactly when the
 * database cannot answer — and both copies carry a comment saying the opposite:
 * "a workspace that has enforced SSO has done so precisely so that a password
 * cannot be an alternative route in".
 *
 * It is not an authentication bypass: the password still has to be right. It is
 * the policy that fails — an organisation that enforced SSO so that
 * deprovisioned staff lose access keeps a working password route open, on a
 * network blip or a PostgREST schema-cache miss after a migration, which are
 * both ordinary.
 *
 * ## Why it retries before refusing
 *
 * Failing closed on the first error would lock out every password user,
 * including the great majority whose domain enforces nothing, on any transient
 * fault. Failing open keeps the defect. So: one retry, and then a refusal that
 * says what could not be established.
 *
 * A blip is usually gone by the second call. A persistent failure is precisely
 * the moment to stop accepting passwords for a domain we cannot ask about.
 *
 * One function so the two sign-in forms cannot drift, which they already had.
 */

export interface SsoRoute {
  readonly email_domain: string;
  readonly provider?: string | null;
}

export type SsoRoutingOutcome =
  | { readonly kind: 'required'; readonly domain: string }
  | { readonly kind: 'not_required' }
  | { readonly kind: 'unknown'; readonly because: string };

/** The sentence shown when we could not establish it. Quoted, not paraphrased. */
export const SSO_ROUTING_UNKNOWN =
  'We could not check whether your address belongs to an organisation that requires single sign-on, so a password cannot be accepted right now. Try again in a moment.';

interface RoutingCaller {
  rpc(
    name: 'sso_routing',
    args: { candidate_email: string },
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

export async function ssoRoutingFor(
  client: RoutingCaller,
  email: string,
): Promise<SsoRoutingOutcome> {
  let last: { message: string } | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await client.rpc('sso_routing', { candidate_email: email });
    if (error) {
      last = error;
      continue;
    }
    // The function `returns table`, so PostgREST hands back an array; a direct
    // call in a test may hand back the row. Both shapes, because getting this
    // wrong silently reads as "no SSO" — the same failure one layer along.
    const route = (Array.isArray(data) ? data[0] : data) as SsoRoute | undefined | null;
    return route?.email_domain
      ? { kind: 'required', domain: String(route.email_domain) }
      : { kind: 'not_required' };
  }

  return { kind: 'unknown', because: last?.message ?? 'The lookup did not answer.' };
}
