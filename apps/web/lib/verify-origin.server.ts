import { headers } from 'next/headers';
import { originFrom } from './verify-origin';

/** The same decision, with the request read for it. */
export async function resolveVerifyOrigin(): Promise<string> {
  const headerList = await headers();
  // `x-forwarded-host` is what a proxy sets, and Vercel always does. `host` is
  // the fallback for running this locally.
  return originFrom(
    process.env.NEXT_PUBLIC_VERIFY_URL ?? process.env.NEXT_PUBLIC_SITE_URL,
    headerList.get('x-forwarded-host') ?? headerList.get('host'),
  );
}
