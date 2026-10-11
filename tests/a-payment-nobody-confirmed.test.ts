/**
 * A page cannot confirm a payment it has not seen.
 *
 * `/console/billing` greeted the return from a checkout with
 *
 *     Payment received. Your plan updates as soon as the provider confirms it,
 *     usually within seconds.
 *
 * in `text-ok`, the colour this app uses for good news. The only thing it read
 * was `?purchased=1`: a parameter the provider appends on its way back, and one
 * anybody can type into the address bar. The first sentence is a statement of
 * fact about money, and nothing on that path establishes it.
 *
 * The parameter granting nothing is the part that is right, and it is worth
 * saying out loud rather than trusting: a plan is written by the signed webhook
 * and by nothing else. So the fix was the sentence, not the mechanism — and the
 * three links the honest sentence now rests on are asserted here, because each
 * of them is invisible when it breaks.
 *
 *   1. The notice claims nothing the page cannot see.
 *   2. `purchased` reaches no entitlement — it decides which paragraph prints.
 *   3. `public.subscriptions` is written from two places and no others: the
 *      webhook applier, reached only through a verified signature, and the
 *      operator override in `/admin/accounts`, which re-checks the caller and
 *      logs the change. The sweep below was written expecting one and found
 *      two, which is the useful half of asserting a set rather than a file.
 *
 * ## The failure the honest sentence is for
 *
 * A webhook that is never delivered. The money moves, our records say free
 * tier, and the customer reads "Payment received" above a page still offering
 * them the plan they just bought — so they buy it twice. Nothing sweeps for
 * that: `retrieveSession` is implemented by all three providers and called by
 * none of them. Whether to build the sweep is a founder decision, and while it
 * is undecided the gap stays named in `docs/OPEN_ITEMS.md` — asserted below, so
 * the note cannot be tidied away while the gap is still there.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutComments } from './setup/source.ts';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

const BILLING_PAGE = 'apps/web/app/console/billing/page.tsx';
const billing = read(BILLING_PAGE);
const billingCode = withoutComments(billing);
const openItems = read('docs/OPEN_ITEMS.md');

describe('what the page says when somebody comes back from a checkout', () => {
  it('does not state the payment as a fact', () => {
    // Each of these asserts receipt. The page learns of the checkout from a
    // query parameter and learns of the payment from the webhook, which may not
    // have arrived — and on the one deployment where it is misconfigured, never
    // will.
    expect(billingCode).not.toMatch(/payment (?:was )?received/i);
    expect(billingCode).not.toMatch(/thank you for your payment/i);
    expect(billingCode).not.toMatch(/you(?:r)? (?:have been|were) charged/i);
    expect(billingCode).not.toMatch(/payment (?:is )?(?:complete|successful)/i);
  });

  it('says what will change it, and that this page is not what changes it', () => {
    expect(billingCode).toMatch(/when the provider confirms the payment/);
    expect(billingCode).toMatch(/cannot see it any sooner/);
  });

  it('tells a customer whose plan did not change what to do instead of paying again', () => {
    // The whole point of the rewrite. Without this sentence an honest notice is
    // just a vaguer version of the dishonest one: the person still has no way
    // to tell a slow webhook from a lost payment, and the cheapest guess is to
    // buy it again.
    expect(billingCode).toMatch(/before paying again/);
    // Pointed at something on this page rather than at an inbox we have not
    // decided on yet. The invoices are the provider's own record of what was
    // taken, and they are already rendered below.
    expect(billingCode).toContain('href="#invoices"');
    expect(billingCode).toContain('id="invoices"');
  });

  it('is not dressed as good news', () => {
    const notice = billingCode.slice(
      billingCode.indexOf('{purchased && ('),
      billingCode.indexOf('{cancelled && ('),
    );
    expect(notice.length).toBeGreaterThan(80);
    expect(notice).not.toContain('text-ok');
    expect(notice).not.toContain('data-tone="ok"');
  });
});

describe('what the parameter is allowed to decide', () => {
  it('decides which paragraph prints and nothing else', () => {
    // Three mentions and no more: the type of `searchParams`, the destructure,
    // and the guard on that paragraph. A fourth is not necessarily wrong, but
    // it is the only way this grows into "?purchased=1 gave me a plan", so it
    // has to be read rather than assumed.
    const mentions = [...billingCode.matchAll(/\bpurchased\b/g)];
    expect(mentions).toHaveLength(3);
  });

  it('is not what the plan, the entitlement or the meters are read from', () => {
    // The plan comes from the subscription row; the allowances come from the
    // plan. Each of these lines is in the file already — asserted so that a
    // later `purchased ? 'starter' : ...` is a failure rather than a nicety.
    expect(billingCode).toMatch(/const currentPlan = \(live\?\.plan \?\? 'free'\)/);
    expect(billingCode).toMatch(/const entitlement = entitlementFor\(currentPlan\)/);
    expect(billingCode).toMatch(/plan: currentPlan/);
  });
});

/** Every shipped `.ts`/`.tsx` under a root, tests and build output excluded. */
function sourcesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next')
        continue;
      found.push(...sourcesUnder(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * A write to the subscriptions table, in either dialect this app writes in.
 *
 * Raw SQL in the packages, the Supabase builder in the app. The builder form
 * has to allow a line break between the table and the verb, because that is
 * how prettier formats a chain of any length.
 */
const WRITES: readonly RegExp[] = [
  /insert\s+into\s+(?:public\.)?subscriptions/i,
  /update\s+(?:public\.)?subscriptions\b/i,
  /delete\s+from\s+(?:public\.)?subscriptions/i,
  /from\(\s*'subscriptions'\s*\)\s*\.?\s*\n?\s*\.(?:insert|upsert|update|delete)/,
];

describe('what can write a plan', () => {
  const sources = ['apps/web/app', 'apps/web/lib', 'apps/worker/src', 'packages'].flatMap((root) =>
    sourcesUnder(root),
  );

  it('found the app to search, rather than reporting an empty sweep as clean', () => {
    expect(sources.length).toBeGreaterThan(200);
    expect(sources).toContain(BILLING_PAGE);
    expect(sources).toContain('packages/billing/src/webhooks.ts');
  });

  it('is two places, and both of them are known', () => {
    const writers = sources.filter((path) => {
      const code = withoutComments(readFileSync(path, 'utf8'));
      return WRITES.some((pattern) => pattern.test(code));
    });
    // The webhook applier, and the operator override. A third entry here is a
    // new way for a workspace to get a plan, and every one of those is either
    // a payment nobody took or a payment nobody recorded.
    expect(writers).toEqual([
      'apps/web/app/admin/accounts/actions.ts',
      'packages/billing/src/webhooks.ts',
    ]);
  });

  it('gives the operator override the two things that make it one', () => {
    // Not a second copy of `tests/admin-console.test.ts`, which holds this
    // path's rules in full. This is the pair that distinguishes an override
    // from a plan anybody can set: the server re-checks who is asking, and the
    // change leaves a record naming what it was before.
    const operator = withoutComments(read('apps/web/app/admin/accounts/actions.ts'));
    expect(operator).toContain('requireAdmin()');
    expect(operator).toContain("action: 'account.plan_set'");
    expect(operator).toContain('before_state');
  });

  it('is reached only after a signature verified', () => {
    const callers = sources.filter(
      (path) =>
        // Its own module defines it; the question is who reaches it.
        path !== 'packages/billing/src/webhooks.ts' &&
        withoutComments(readFileSync(path, 'utf8')).includes('applyBillingEvent('),
    );
    // Two routes today, one per provider. The count is asserted so that a third
    // caller — a cron job, an admin button, a reconciliation sweep — is read
    // before it ships rather than after.
    expect(callers).toEqual([
      'apps/web/app/api/paystack/webhook/route.ts',
      'apps/web/app/api/stripe/webhook/route.ts',
    ]);

    for (const path of callers) {
      const code = withoutComments(readFileSync(path, 'utf8'));
      const verified = code.indexOf('verifyWebhook(');
      const applied = code.indexOf('applyBillingEvent(');
      expect(verified).toBeGreaterThan(-1);
      expect(applied).toBeGreaterThan(verified);
      // And the failure is a refusal rather than a log line.
      expect(code).toMatch(/WebhookVerificationError/);
      expect(code).toMatch(/status: 400/);
    }
  });
});

describe('the payment nobody reconciles', () => {
  const providerSources = sourcesUnder('packages/billing/src').concat(
    sourcesUnder('apps/web/app'),
    sourcesUnder('apps/web/lib'),
    sourcesUnder('apps/worker/src'),
  );

  const callers = providerSources.filter(
    (path) =>
      !path.startsWith('packages/billing/src/') &&
      withoutComments(readFileSync(path, 'utf8')).includes('retrieveSession'),
  );

  it('is written down for as long as nobody reconciles it', () => {
    if (callers.length > 0) {
      // Somebody built it. This block has done its job; delete it with the open
      // item, and assert whatever the sweep now promises instead.
      expect(callers.join(', ')).toBeTruthy();
      return;
    }
    expect(openItems).toMatch(/retrieveSession/);
    expect(openItems).toMatch(/webhook (?:that )?never (?:arrives|arrived|lands|landed)/i);
  });
});
