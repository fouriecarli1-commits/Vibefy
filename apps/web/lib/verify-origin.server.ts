import { headers } from 'next/headers';
import { siteOriginFor, verifyOriginFor, verifyOriginWithSource } from './verify-origin';

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

/**
 * The same origin, with where it came from, for the one page that needs it.
 *
 * The console's embed snippet is copied into somebody else's website and keeps
 * the origin it was built from, so "resolved" is not enough: a snippet built
 * from the request host points at whatever address the operator happened to be
 * browsing, and on Vercel that is a generated host that changes. See
 * `verifyOriginWithSource`.
 */
export async function resolveVerifyOriginWithSource(): Promise<
  ReturnType<typeof verifyOriginWithSource>
> {
  const headerList = await headers();
  return verifyOriginWithSource(headerList.get('x-forwarded-host') ?? headerList.get('host'));
}
