/**
 * Who is offered what.
 *
 * The menu showed everybody everything: a customer was offered the reviewer
 * queue, and the operator was offered the console and the public verification
 * pages. Both were reading a list of which most items belonged to somebody
 * else, which is the same failure the grouping was meant to fix, one level up.
 *
 * The line these tests hold is that this is presentation and nothing more.
 * Filtering a menu is not access control, and if it ever became the only thing
 * standing in front of `/review` or `/admin`, the product would have a hole
 * shaped exactly like a URL somebody typed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');
const nav = read('apps/web/components/site-nav.tsx');
const viewer = read('apps/web/components/site-nav-viewer.tsx');
const layout = read('apps/web/app/layout.tsx');
const reviewPage = read('apps/web/app/review/page.tsx');
const accountsPage = read('apps/web/app/admin/accounts/page.tsx');
const costsPage = read('apps/web/app/admin/costs/page.tsx');

/** The audience map, read out of the source it is defined in. */
function groupsFor(audience: string): string[] {
  const map = /const GROUPS_FOR[\s\S]*?\n\};/.exec(nav)![0];
  const row = new RegExp(`^\\s{2}${audience}: \\[([^\\]]*)\\]`, 'm').exec(map);
  if (!row) throw new Error(`No audience "${audience}" in GROUPS_FOR`);
  return [...row[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

describe('the customer', () => {
  it('is offered the console', () => {
    expect(groupsFor('customer')).toContain('console');
  });

  it('is not offered the reviewer queue', () => {
    // A customer who follows it gets a page explaining the queue is not theirs.
    // Offering it in the first place is what wastes their time.
    expect(groupsFor('customer')).not.toContain('review');
  });

  it('is not offered the admin screens', () => {
    expect(groupsFor('customer')).not.toContain('admin');
  });
});

describe('the operator', () => {
  it('is offered the queue and the admin screens', () => {
    expect(groupsFor('admin')).toContain('review');
    expect(groupsFor('admin')).toContain('admin');
  });

  it('is not offered the console or the public verification pages', () => {
    expect(groupsFor('admin')).not.toContain('console');
    expect(groupsFor('admin')).not.toContain('verify');
  });
});

describe('the reviewer', () => {
  it('is offered the queue but not the admin screens', () => {
    expect(groupsFor('reviewer')).toContain('review');
    expect(groupsFor('reviewer')).not.toContain('admin');
  });
});

describe('the visitor', () => {
  it('is offered only the public pages', () => {
    expect(groupsFor('visitor')).toEqual(['verify']);
  });

  it('is the only one still offered a sign-in link', () => {
    expect(nav).toContain("audience === 'visitor'");
  });

  it('is what the menu assumes before it knows otherwise', () => {
    // The fallback while the session lookup is in flight. Assuming a customer
    // would flash a console link at somebody who is not signed in.
    expect(nav).toContain("audience = 'visitor'");
    expect(layout).toContain('<SiteNav />');
  });
});

describe('this is presentation, not permission', () => {
  it('every hidden route still refuses on its own', () => {
    for (const page of [reviewPage, accountsPage, costsPage]) {
      expect(page).toContain('platform_role');
    }
  });

  it('the queue and the admin screens each check before rendering', () => {
    expect(reviewPage).toMatch(/platform_role === 'reviewer'|isReviewer/);
    expect(accountsPage).toContain("platform_role !== 'admin'");
    expect(costsPage).toContain("platform_role !== 'admin'");
  });

  it('says so where somebody might mistake it for a gate', () => {
    expect(viewer).toContain('never what is permitted');
  });
});

describe('the header does not wait on a session lookup', () => {
  it('renders the viewer-aware menu inside a boundary', () => {
    // Without it, every public page pays for a database round trip to draw a
    // header that does not depend on the answer.
    expect(layout).toContain('Suspense');
    expect(layout).toContain('SiteNavForViewer');
  });
});
