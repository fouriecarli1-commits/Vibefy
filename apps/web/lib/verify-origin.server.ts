import { headers } from 'next/headers';
import { siteOriginFor, verifyOriginFor } from './verify-origin';

/** The same decision, with the request read for it. */
export async function resolveVerifyOrigin(): Promise<string> {
  const headerList = await headers();
  return verifyOriginFor(headerList.get('x-forwarded-host') ?? headerList.get('host'));
}

/**
 * The console's own origin, for a link somebody is meant to click.
 *
 * Both of its callers built the string by hand before this existed, and both
 * fell back to something that cannot work: the invitation link to `''`, which
 * makes `/invite/<token>` in an email — and the token is stored only as a
 * hash, so the invitation can never be re-sent with the same link — and the
 * checkout return to `http://localhost:3000`, which is where a provider sent
 * a customer who had just paid.
 */
export async function resolveSiteOrigin(): Promise<string> {
  const headerList = await headers();
  return siteOriginFor(headerList.get('x-forwarded-host') ?? headerList.get('host'));
}
