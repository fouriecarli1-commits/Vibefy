/**
 * The half of the verification page that belongs to the customer.
 *
 * A stranger who has just checked a mark usually wants something the assessment
 * cannot tell them — where to write when something goes wrong, who to tell
 * about a vulnerability, whether the service is up. Only the owner knows. The
 * moment they can type it, though, the page stops being only our claim and
 * becomes partly theirs, and a reader who cannot tell which half is which has
 * been misled by the layout rather than by anything either of us wrote.
 *
 * Three things hold that line, and all three are tested here: the words live in
 * a table of their own and never touch an assessment, they are only published
 * while the badge they hang off is live, and they cannot extend the mark.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { checkClaim } from '../packages/shared/src/index.ts';
import { connect, expectRefusal } from './setup/client.ts';
import { seedAccount, seedBadgedApp, type SeededAccount } from './setup/seed.ts';

let db: Client;
let stranger: SeededAccount;

async function owningOrg(appId: string): Promise<string> {
  const { rows } = await db.query<{ organisation_id: string }>(
    'select organisation_id from public.apps where id = $1',
    [appId],
  );
  return rows[0]!.organisation_id;
}

async function writePage(appId: string, published: boolean): Promise<void> {
  await db.query(
    `insert into public.trust_pages
       (app_id, organisation_id, contact_email, security_contact, note, published)
     values ($1, $2, 'help@kettle.example', 'security@kettle.example', 'We answer within a day.', $3)
     on conflict (app_id) do update set published = excluded.published`,
    [appId, await owningOrg(appId), published],
  );
}

async function publicRows(slug: string) {
  const { rows } = await db.query('select * from public.trust_page_public where badge_slug = $1', [
    slug,
  ]);
  return rows;
}

beforeAll(async () => {
  db = await connect();
  stranger = await seedAccount(db, 'trust-stranger');
});

afterAll(async () => {
  await db?.end();
});

describe('it is theirs to publish and theirs to take down', () => {
  it('shows nothing until it is published', async () => {
    const seeded = await seedBadgedApp(db, 'trust-unpublished');
    await writePage(seeded.appId, false);
    expect(await publicRows(seeded.slug)).toEqual([]);
  });

  it('shows it when published, and stops the moment it is not', async () => {
    const seeded = await seedBadgedApp(db, 'trust-toggle');
    await writePage(seeded.appId, true);
    expect(await publicRows(seeded.slug)).toHaveLength(1);

    await db.query('update public.trust_pages set published = false where app_id = $1', [
      seeded.appId,
    ]);
    expect(await publicRows(seeded.slug)).toEqual([]);
  });
});

describe('it lives only as long as the mark it hangs off', () => {
  it('disappears when the badge is suspended', async () => {
    // A trust page attached to a suspended mark would outlive the reason
    // anybody had to be reading it.
    const seeded = await seedBadgedApp(db, 'trust-suspended');
    await writePage(seeded.appId, true);
    expect(await publicRows(seeded.slug)).toHaveLength(1);

    await db.query(
      `update public.badges
          set status = 'suspended', suspension_reason = 'Suspended by this test, to watch it disappear'
        where app_id = $1`,
      [seeded.appId],
    );
    expect(await publicRows(seeded.slug)).toEqual([]);
  });
});

describe('it is the owner’s page, and only the owner’s', () => {
  it('refuses a page written by a different organisation', async () => {
    // Otherwise a row here is one organisation writing on another's
    // verification page.
    const seeded = await seedBadgedApp(db, 'trust-not-mine');
    await db.query('begin');
    try {
      const message = await expectRefusal(
        db,
        'insert into public.trust_pages (app_id, organisation_id) values ($1, $2)',
        [seeded.appId, stranger.organisationId],
      );
      expect(message).toMatch(/belongs to the organisation that owns the application/i);
    } finally {
      await db.query('rollback');
    }
  });
});

describe('it cannot extend the mark', () => {
  it('refuses the words a badge holder will reach for first', () => {
    for (const claim of [
      'We are VibefyCode approved.',
      'Certified secure by an independent assessor.',
      'Our app is hack-proof.',
      'Verified by Vibefy in March.',
    ]) {
      expect(checkClaim(claim).ok, claim).toBe(false);
    }
  });

  it('is applied to every field the customer can type into', () => {
    // Checking one field and not the others is the same as checking none: the
    // sentence goes in whichever box is not guarded.
    const action = readFileSync(
      join(process.cwd(), 'apps/web/app/console/apps/[id]/trust/actions.ts'),
      'utf8',
    );
    expect(action).toMatch(/for \(const \[name, value\] of Object\.entries\(fields\)\)/);
    expect(action).toMatch(/checkClaim\(value\)/);
  });

  it('refuses with a reason the person who typed it can act on', () => {
    const verdict = checkClaim('We are VibefyCode certified.');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/Verified by VibefyCode/);
  });
});

describe('what the page does with it', () => {
  const page = readFileSync(join(process.cwd(), 'apps/web/app/a/[slug]/page.tsx'), 'utf8');

  it('heads the block without naming anybody', () => {
    // It used to read "What {trustPage.owner_name} says about itself", with the
    // name taken from the account. An account name is not a publication, and
    // for a solo builder it is a person's name on an unauthenticated page with
    // a share card. The block still has to say whose words these are; it does
    // that by role, which needs no personal information at all.
    expect(page).toContain('What the owner of this application says');
    expect(page).not.toMatch(/owner_name/);
  });

  it('says we did not check it, in the same block', () => {
    expect(page).toMatch(/We have not verified any of\s*\n?\s*it/);
    expect(page).toContain('Not checked by us');
  });

  it('keeps it out of the assessment, and after it', () => {
    // Above the line is what an assessment found. Below it is what somebody
    // says about themselves. The order is part of the argument.
    expect(page.indexOf('What was assessed, and what was not')).toBeLessThan(
      page.indexOf('owner-says'),
    );
  });

  it('does not let the owner’s links carry our standing', () => {
    // A page carrying our mark linking out with our search standing behind it
    // is a thing worth selling, which is exactly why it is not for sale.
    const block = page.slice(page.indexOf('owner-says'), page.indexOf('aria-labelledby="verify"'));
    const links = block.match(/<a\s[^>]*href=\{trustPage\.[a-z_]+\}/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(block.match(/rel="nofollow noopener"/g) ?? []).toHaveLength(links.length);
  });
});
