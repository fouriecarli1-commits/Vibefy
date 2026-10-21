/**
 * Which account at the provider this deployment is actually signing in with.
 *
 * Three days were spent on a Google sign-in where every visible setting was
 * right: the redirect address in Google matched the one Supabase publishes, the
 * host matched the configured origin, the provider was enabled. What nobody
 * could see was the Client ID *inside* Supabase — and the live error URL from
 * 18 October carried a client from a different Google project entirely. Every
 * correct setting in the project that was open was invisible to the flow.
 *
 * The answer is public and one request away. `/auth/v1/authorize` is the
 * endpoint the sign-in button sends a browser to, it needs no key, and it
 * answers with a redirect to the provider carrying `client_id` — which is
 * public by construction: every person who signs in sees it in their address
 * bar.
 *
 * And the failure case is just as useful. When Supabase refuses the address we
 * ask it to hand back to, it redirects to its own Site URL with an `error` on
 * it rather than to the provider. That is the allow-list problem, named, from
 * the one place that can name it.
 *
 * Reading the redirect is separated from making the request so the reading can
 * be tested without a Supabase to talk to.
 */
export type AuthorizeAnswer =
  | {
      readonly kind: 'provider';
      /** Where the browser is being sent — `accounts.google.com`, and so on. */
      readonly host: string;
      /** Public: it is in the address bar of everybody who signs in. */
      readonly clientId: string | null;
      /** What the provider is told to hand back to, which must match its console. */
      readonly redirectUri: string | null;
    }
  | {
      readonly kind: 'refused';
      readonly error: string | null;
      readonly description: string | null;
    }
  | { readonly kind: 'unexpected'; readonly detail: string };

export function readAuthorizeRedirect(status: number, location: string | null): AuthorizeAnswer {
  if (status < 300 || status >= 400) {
    return {
      kind: 'unexpected',
      detail: `the authorize endpoint answered ${status} instead of a redirect`,
    };
  }
  if (!location) {
    return { kind: 'unexpected', detail: 'the authorize endpoint redirected to nowhere' };
  }

  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return {
      kind: 'unexpected',
      detail: 'the authorize endpoint redirected to something that is not an address',
    };
  }

  /*
   * A refusal comes back on the query or on the fragment, depending on which
   * leg failed, and it is a refusal either way.
   */
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const error = url.searchParams.get('error') ?? fragment.get('error');
  if (error) {
    return {
      kind: 'refused',
      error,
      description:
        url.searchParams.get('error_description') ?? fragment.get('error_description') ?? null,
    };
  }

  return {
    kind: 'provider',
    host: url.host,
    clientId: url.searchParams.get('client_id'),
    redirectUri: url.searchParams.get('redirect_uri'),
  };
}

/**
 * The Google Cloud project a client belongs to, which is the first field of it.
 *
 * Two clients from two projects look alike at a glance and are not
 * interchangeable: a redirect address added to one is invisible to the other.
 * Naming the project number is what makes "this is not the client you have been
 * editing" something somebody can see in one line.
 */
export function projectNumberOf(clientId: string | null): string | null {
  const match = /^(\d{6,})-/.exec(clientId ?? '');
  return match?.[1] ?? null;
}
