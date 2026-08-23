/**
 * The public directory.
 *
 * Three claims are defended here, and all three are regulated ones: only
 * certified applications appear, placement cannot be bought, and an owner who
 * opts out disappears immediately while staying certified.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  categoriesOf,
  disclosuresFor,
  matches,
  queryDirectory,
  MARKETING_CLIENT_DISCLOSURE,
  NO_PAID_PLACEMENT,
  type DirectoryEntry,
} from '../packages/directory/src/index.ts';
import { lintText } from '../tools/copy-lint.mjs';
import { actingAs, connect } from './setup/client.ts';
import {
  acceptBadgeLicence,
  approveAssessment,
  issueBadge,
  makeReviewer,
  seedAccount,
  seedAssessment,
  seedFinding,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let reviewer: SeededAccount;

function entry(overrides: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    slug: 'kettle',
    name: 'Kettle',
    certifiedOrigin: 'https://kettle.example',
    score: 82,
    rubricVersion: '1.0.0',
    assessedOn: '2026-08-01',
    dimensions: [
      { dimension: 'security_posture', score: 80 },
      { dimension: 'practicality_ux', score: 90 },
    ],
    tagline: 'A kettle you can talk to.',
    category: 'Home',
    ownerIsMarketingClient: false,
    ...overrides,
  };
}

beforeAll(async () => {
  db = await connect();
  reviewer = await seedAccount(db, 'directory-reviewer');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await db?.end();
});

describe('ordering cannot be bought', () => {
  it('puts a free customer above a paying one when the rubric does', () => {
    const paying = entry({ slug: 'paying', score: 71, ownerIsMarketingClient: true });
    const free = entry({ slug: 'free', score: 93, ownerIsMarketingClient: false });
    const page = queryDirectory([paying, free]);
    expect(page.entries.map((item) => item.slug)).toEqual(['free', 'paying']);
  });

  it('orders identically whether or not the owners are marketing clients', () => {
    const plain = [entry({ slug: 'a', score: 80 }), entry({ slug: 'b', score: 90 })];
    const paid = plain.map((item) => ({ ...item, ownerIsMarketingClient: true }));
    expect(queryDirectory(paid).entries.map((item) => item.slug)).toEqual(
      queryDirectory(plain).entries.map((item) => item.slug),
    );
  });

  it('breaks ties on the slug, not on anything a business could influence', () => {
    const page = queryDirectory([
      entry({ slug: 'zebra', score: 80, ownerIsMarketingClient: true }),
      entry({ slug: 'apple', score: 80 }),
    ]);
    expect(page.entries.map((item) => item.slug)).toEqual(['apple', 'zebra']);
  });

  it('sorts by any rubric dimension', () => {
    const strongSecurity = entry({
      slug: 'secure-ish',
      score: 70,
      dimensions: [{ dimension: 'security_posture', score: 95 }],
    });
    const strongOverall = entry({
      slug: 'rounded',
      score: 88,
      dimensions: [{ dimension: 'security_posture', score: 60 }],
    });
    expect(
      queryDirectory([strongOverall, strongSecurity], { sort: 'security_posture' }).entries.map(
        (item) => item.slug,
      ),
    ).toEqual(['secure-ish', 'rounded']);
  });

  it('states how it is ordered on every page of results', () => {
    expect(queryDirectory([entry()]).orderingNote).toMatch(/not for sale/);
    expect(NO_PAID_PLACEMENT).toMatch(/labelled as advertising/);
  });

  it('has no field through which placement could be bought', () => {
    // The compile-time assertion in types.ts is the real guard. This checks the
    // other half: that the ranking module never mentions a commercial concept.
    const source = readFileSync(join(process.cwd(), 'packages/directory/src/rank.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '')
      .toLowerCase();
    for (const term of ['marketing', 'plan', 'price', 'sponsor', 'promoted', 'boost', 'featured']) {
      expect(source, `rank.ts must not reference "${term}"`).not.toMatch(
        new RegExp(`\\b${term}\\b`),
      );
    }
  });

  it('keeps the directory out of the scoring package', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'packages/rubric/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('@vibefycode/directory');
    for (const file of readdirSync(join(process.cwd(), 'packages/rubric/src'))) {
      expect(readFileSync(join(process.cwd(), 'packages/rubric/src', file), 'utf8')).not.toMatch(
        /@vibefycode\/directory/,
      );
    }
  });
});

describe('search', () => {
  it('matches on name, domain, category and the owner’s tagline', () => {
    const item = entry();
    expect(matches(item, 'kettle')).toBe(true);
    expect(matches(item, 'kettle.example')).toBe(true);
    expect(matches(item, 'home')).toBe(true);
    expect(matches(item, 'talk to')).toBe(true);
    expect(matches(item, 'toaster')).toBe(false);
  });

  it('requires every term, so a search narrows rather than widens', () => {
    expect(matches(entry(), 'kettle home')).toBe(true);
    expect(matches(entry(), 'kettle toaster')).toBe(false);
  });

  it('lists the categories actually in use, case-folded once', () => {
    expect(
      categoriesOf([entry({ category: 'Home' }), entry({ slug: 'b', category: 'home' })]),
    ).toEqual(['Home']);
  });
});

describe('disclosure', () => {
  it('always states the scope, and adds the paid-relationship line when it applies', () => {
    expect(disclosuresFor({ ownerIsMarketingClient: false })).toHaveLength(1);
    const disclosed = disclosuresFor({ ownerIsMarketingClient: true });
    expect(disclosed).toHaveLength(2);
    expect(disclosed[1]).toBe(MARKETING_CLIENT_DISCLOSURE);
  });

  it('uses one wording on every surface that shows a rating', () => {
    // A disclosure worded softly in the place people actually look is not a
    // disclosure, so both surfaces import the same constant.
    const verification = readFileSync(
      join(process.cwd(), 'apps/web/app/a/[slug]/page.tsx'),
      'utf8',
    );
    const directory = readFileSync(join(process.cwd(), 'apps/web/app/directory/page.tsx'), 'utf8');
    expect(verification).toMatch(/MARKETING_CLIENT_DISCLOSURE/);
    expect(directory).toMatch(/MARKETING_CLIENT_DISCLOSURE/);
  });

  it('passes the same copy gate as every other public surface', () => {
    // Checked with the gate itself rather than a second list of banned words:
    // two lists would eventually disagree, and the gate is the one CI runs.
    for (const text of [
      MARKETING_CLIENT_DISCLOSURE,
      NO_PAID_PLACEMENT,
      ...disclosuresFor({ ownerIsMarketingClient: true }),
    ]) {
      expect(lintText(text), text).toHaveLength(0);
    }
  });
});

describe('only certified applications, and only while they are', () => {
  async function certifiedApp(label: string): Promise<{
    owner: SeededAccount;
    appId: string;
    badgeId: string;
    slug: string;
  }> {
    const owner = await seedAccount(db, label);
    const seeded = await seedAssessment(db, owner);
    await seedFinding(db, owner, seeded.assessmentId, { severity: 'low' });
    await approveAssessment(db, owner, seeded.assessmentId, reviewer.userId, { score: 84 });
    await db.query(
      `update public.assessments set dimension_scores = '[{"dimension":"security_posture","score":84}]'::jsonb
        where id = $1`,
      [seeded.assessmentId],
    );
    const consentId = await acceptBadgeLicence(db, owner);
    const badgeId = await issueBadge(db, owner, {
      appId: seeded.appId,
      assessmentId: seeded.assessmentId,
      consentId,
    });
    const { rows } = await db.query<{ slug: string }>(
      'select slug from public.badges where id = $1',
      [badgeId],
    );
    await db.query(
      `insert into public.directory_listings (app_id, organisation_id, tagline, category)
       values ($1, $2, 'A perfectly ordinary application.', 'Utilities')`,
      [seeded.appId, owner.organisationId],
    );
    return { owner, appId: seeded.appId, badgeId, slug: rows[0]!.slug };
  }

  async function publicDirectory(): Promise<{ slug: string }[]> {
    // Read as `anon`, which is how the world reads it.
    return actingAs(db, { role: 'anon' }, async (client) => {
      const { rows } = await client.query<{ slug: string }>('select slug from public.directory');
      return rows;
    });
  }

  it('lists an application with a live badge', async () => {
    const { slug } = await certifiedApp('directory-listed');
    expect((await publicDirectory()).map((row) => row.slug)).toContain(slug);
  });

  it('drops the listing the moment the badge is suspended', async () => {
    const { slug, badgeId } = await certifiedApp('directory-suspended');
    expect((await publicDirectory()).map((row) => row.slug)).toContain(slug);
    await db.query(
      `update public.badges set status = 'suspended', suspended_at = now(),
              suspension_reason = 'Suspended for the purposes of this test.'
        where id = $1`,
      [badgeId],
    );
    expect((await publicDirectory()).map((row) => row.slug)).not.toContain(slug);
  });

  it('drops the listing when the badge expires, without anything having to run', async () => {
    // `badge_effective_status` reports an expired badge as expired whatever the
    // stored column says, so a missed sweep cannot leave a stale listing up.
    const { slug, badgeId } = await certifiedApp('directory-expired');
    await db.query(
      `update public.badges set issued_at = now() - interval '2 days',
                                expires_at = now() - interval '1 day'
        where id = $1`,
      [badgeId],
    );
    expect((await publicDirectory()).map((row) => row.slug)).not.toContain(slug);
  });

  it('removes a listing on opt-out and leaves the badge alone', async () => {
    const { slug, appId, badgeId } = await certifiedApp('directory-opted-out');
    await db.query(
      `update public.directory_listings set state = 'opted_out', opted_out_at = now() where app_id = $1`,
      [appId],
    );
    expect((await publicDirectory()).map((row) => row.slug)).not.toContain(slug);

    const { rows } = await db.query<{ status: string }>(
      'select status::text as status from public.badges where id = $1',
      [badgeId],
    );
    // The Badge Licence says you may opt out entirely and stay certified. This
    // is the assertion that makes that sentence true.
    expect(rows[0]!.status).toBe('active');
  });

  it('keeps every change of mind, and refuses to let one be edited', async () => {
    const { appId } = await certifiedApp('directory-history');
    await db.query(
      `update public.directory_listings set state = 'opted_out', opted_out_at = now() where app_id = $1`,
      [appId],
    );
    await db.query(
      `update public.directory_listings set state = 'listed', opted_out_at = null where app_id = $1`,
      [appId],
    );
    const { rows } = await db.query<{ state: string }>(
      `select state::text as state from public.listing_events where app_id = $1 order by occurred_at`,
      [appId],
    );
    expect(rows.map((row) => row.state)).toEqual(['listed', 'opted_out', 'listed']);
    await expect(
      db.query(
        'update public.listing_events set state = %s where app_id = $1'.replace('%s', "'listed'"),
        [appId],
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it('refuses an opt-out that is not stamped', async () => {
    const { appId } = await certifiedApp('directory-unstamped');
    await expect(
      db.query(`update public.directory_listings set state = 'opted_out' where app_id = $1`, [
        appId,
      ]),
    ).rejects.toThrow(/listing_opt_out_is_stamped/);
  });

  it('shows the world nothing the verification page does not already show', async () => {
    const { slug } = await certifiedApp('directory-columns');
    const columns = await actingAs(db, { role: 'anon' }, async (client) => {
      const { rows } = await client.query(`select * from public.directory where slug = $1`, [slug]);
      return Object.keys(rows[0] ?? {});
    });
    // No organisation id, no app id, no findings, no evidence, no contact.
    for (const forbidden of ['organisation_id', 'app_id', 'owner_email', 'findings', 'evidence']) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('does not let an outsider read the listing table itself', async () => {
    const outsider = await seedAccount(db, 'directory-outsider');
    const { appId } = await certifiedApp('directory-private');
    const visible = await actingAs(db, { userId: outsider.userId }, async (client) => {
      const { rows } = await client.query(
        'select app_id from public.directory_listings where app_id = $1',
        [appId],
      );
      return rows.length;
    });
    expect(visible).toBe(0);
  });
});
