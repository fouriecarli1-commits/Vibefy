/**
 * The badge went grey for a week over a hostname, and the row it needed was
 * published the whole time.
 *
 * `/verify` and the badge image route each read one row from
 * `public.badge_verification` by `public_id`, over a direct Postgres
 * connection on `SUPABASE_DB_URL`. When that string is wrong — a dedicated
 * pooler host with no IPv4 address, in this case — every badge on every
 * customer's site renders grey and `/verify` can establish nothing. That was
 * the state of this product for a week.
 *
 * The view is granted to `anon`. Supabase's own API serves it over HTTPS with
 * the public key and no database URL at all, and the console was signing in
 * through that key the entire time. So the route that was still up was the one
 * nothing used.
 *
 * `lookUpBadgeVerification` tries the direct connection first and falls back.
 * This file holds three things about it: the order, the logging, and that both
 * public surfaces go through it. Not the SQL — `badge_verification` has its
 * own tests — and not the fallback's network call, which needs a Supabase to
 * talk to.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Line comments out, then block comments, so prose cannot match. */
function withoutComments(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const lookup = withoutComments(readFileSync('apps/web/lib/badge-verification.ts', 'utf8'));
const verify = withoutComments(readFileSync('apps/web/app/verify/page.tsx', 'utf8'));
const image = withoutComments(readFileSync('apps/web/app/badge/[file]/route.ts', 'utf8'));

describe('which route answers', () => {
  it('tries the direct connection before the API', () => {
    // Order matters and is not decoration: the direct path is one query rather
    // than a round trip through another service, and a fallback that quietly
    // became the normal route would hide a broken connection string instead of
    // surviving it.
    const direct = lookup.indexOf('readAsAnon');
    const api = lookup.indexOf('createClient(url, key');
    expect(direct).toBeGreaterThan(-1);
    expect(api).toBeGreaterThan(direct);
  });

  it('reads the same columns by either route', () => {
    // One list, interpolated into the SQL and handed to `.select()`. Two lists
    // is how a column arrives on one route and not the other, and the row
    // feeds a signature check.
    expect(lookup.match(/COLUMNS/g) ?? []).toHaveLength(3);
    expect(lookup).toMatch(/select \$\{COLUMNS\} from public\.badge_verification/);
    expect(lookup).toMatch(/\.select\(COLUMNS\)/);
  });

  it('reads as nobody on both routes', () => {
    // `set local role anon` on the direct path; the anon key and no session on
    // the other. Row-level security has to be the same either way, or the
    // fallback is a hole rather than a spare.
    expect(lookup).toMatch(/readAsAnon/);
    expect(lookup).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(lookup).toMatch(/persistSession: false/);
    expect(lookup, 'the service-role key must never reach a public read').not.toMatch(
      /SERVICE_ROLE/,
    );
  });

  it('says so when it falls back, at error level', () => {
    // A badge that works over a broken connection string is still a fault, and
    // the only thing worse than a grey badge is a working one nobody is told
    // about.
    const fallback = lookup.slice(lookup.indexOf('catch'));
    expect(fallback).toMatch(/console\.error\(/);
    expect(fallback).toMatch(/fell back to the Supabase API/);
    expect(fallback).toMatch(/publicId/);
  });

  it('throws when neither route can answer, rather than returning nothing', () => {
    // "Never issued" and "we could not look" must not arrive as the same
    // answer. `/verify` has a third state for exactly that, and it only works
    // if a failure is distinguishable from an absence.
    expect(lookup).toMatch(/throw error/);
    expect(lookup).toMatch(/row: BadgeVerificationRow \| null/);
  });
});

describe('the surfaces that use it', () => {
  it('is what the verification page reads through', () => {
    expect(verify).toMatch(/lookUpBadgeVerification\(/);
    expect(verify, 'the page still reads the view directly as well').not.toMatch(
      /from public\.badge_verification/,
    );
  });

  it('is what the badge image reads through', () => {
    expect(image).toMatch(/lookUpBadgeVerification\(/);
    expect(image, 'the route still reads the view directly as well').not.toMatch(
      /from public\.badge_verification/,
    );
  });

  it('leaves the image route its own write path, which is not public', () => {
    // The route also records that a badge was served. That is a write, it goes
    // through `writeAsService`, and it has no business falling back to a public
    // key.
    expect(image).toMatch(/writeAsService/);
  });
});
