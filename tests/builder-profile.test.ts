/**
 * A page that says something about a person.
 *
 * Everything else in this schema describes an application. This describes
 * somebody's work — what they have built, how often, and how it went — and that
 * story is theirs. A profile page nobody asked for, or one that cannot be taken
 * down, is a reputation we took custody of without being asked.
 *
 * So the rules are enforced in the database rather than promised in a policy,
 * and these are the tests of that:
 *
 *   · nothing is public until it is published,
 *   · consent is one decision per application,
 *   · an organisation can only list its own work,
 *   · and an application with no live mark does not appear at all.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actingAs, connect, expectRefusal } from './setup/client.ts';
import { seedAccount, seedBadgedApp, seedApp, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;
let stranger: SeededAccount;

const handle = () => `builder-${Math.random().toString(36).slice(2, 8)}`;

/**
 * A refusal, in its own transaction.
 *
 * `expectRefusal` takes a savepoint, which needs one open. These cases are
 * about what the database refuses rather than about who is asking, so the
 * transaction exists only to be rolled back.
 */
async function refusal(sql: string, params: unknown[]): Promise<string> {
  await db.query('begin');
  try {
    return await expectRefusal(db, sql, params);
  } finally {
    await db.query('rollback');
  }
}

async function makeProfile(account: SeededAccount, published: boolean): Promise<string> {
  const name = handle();
  await db.query(
    `insert into public.builder_profiles (organisation_id, handle, display_name, published)
     values ($1, $2, $3, $4)
     on conflict (organisation_id) do update
       set handle = excluded.handle, published = excluded.published`,
    [account.organisationId, name, 'A Builder', published],
  );
  return name;
}

async function show(account: SeededAccount, appId: string): Promise<void> {
  await db.query(
    `insert into public.builder_profile_apps (organisation_id, app_id, consented_by)
     values ($1, $2, $3)`,
    [account.organisationId, appId, account.userId],
  );
}

async function publicRows(name: string) {
  const { rows } = await db.query('select * from public.builder_profile_public where handle = $1', [
    name,
  ]);
  return rows;
}

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'profile-owner');
  stranger = await seedAccount(db, 'profile-stranger');
});

afterAll(async () => {
  await db?.end();
});

describe('nothing is public until it is published', () => {
  it('shows nothing for a profile that exists but is not published', async () => {
    const seeded = await seedBadgedApp(db, 'profile-unpublished');
    const account = await accountOwning(seeded.appId);
    const name = await makeProfile(account, false);
    await show(account, seeded.appId);

    expect(await publicRows(name)).toEqual([]);
  });

  it('shows it the moment it is published, and hides it again when it is not', async () => {
    const seeded = await seedBadgedApp(db, 'profile-toggle');
    const account = await accountOwning(seeded.appId);
    const name = await makeProfile(account, true);
    await show(account, seeded.appId);

    expect(await publicRows(name)).toHaveLength(1);

    await db.query('update public.builder_profiles set published = false where handle = $1', [
      name,
    ]);
    expect(await publicRows(name)).toEqual([]);
  });
});

describe('consent is one decision per application', () => {
  it('shows only the applications that were put on it', async () => {
    const seeded = await seedBadgedApp(db, 'profile-one-of-two');
    const account = await accountOwning(seeded.appId);
    const other = await seedBadgedApp(db, 'profile-other');
    const name = await makeProfile(account, true);

    await show(account, seeded.appId);

    const rows = await publicRows(name);
    expect(rows).toHaveLength(1);
    expect(rows.map((row) => row.badge_slug)).not.toContain(other.slug);
  });

  it('takes one off without touching the others', async () => {
    // Withdrawing consent is deleting a row, and nothing else is needed.
    const first = await seedBadgedApp(db, 'profile-first');
    const account = await accountOwning(first.appId);
    const name = await makeProfile(account, true);
    await show(account, first.appId);

    expect(await publicRows(name)).toHaveLength(1);

    await db.query(
      'delete from public.builder_profile_apps where organisation_id = $1 and app_id = $2',
      [account.organisationId, first.appId],
    );
    expect(await publicRows(name)).toEqual([]);
  });
});

describe('an organisation can only list its own work', () => {
  it('refuses an application belonging to somebody else', async () => {
    // Without this, a row is a claim about another person's work with your name
    // at the top of the page.
    const theirs = await seedBadgedApp(db, 'profile-not-mine');
    await makeProfile(owner, true);

    const message = await refusal(
      `insert into public.builder_profile_apps (organisation_id, app_id) values ($1, $2)`,
      [owner.organisationId, theirs.appId],
    );
    expect(message).toMatch(/only appear on the profile of the organisation that owns it/i);
  });
});

describe('an application with no live mark does not appear', () => {
  it('is absent while the badge is suspended, and back when it is not', async () => {
    // An assessment that earned no mark, or lost it, is the owner's to talk
    // about. A page we host is not where that decision gets made for them.
    const seeded = await seedBadgedApp(db, 'profile-suspended');
    const account = await accountOwning(seeded.appId);
    const name = await makeProfile(account, true);
    await show(account, seeded.appId);

    expect(await publicRows(name)).toHaveLength(1);

    await db.query(
      `update public.badges
          set status = 'suspended', suspension_reason = 'Suspended by this test, to watch it disappear'
        where app_id = $1`,
      [seeded.appId],
    );
    expect(await publicRows(name)).toEqual([]);

    await db.query(
      `update public.badges set status = 'active', suspension_reason = null where app_id = $1`,
      [seeded.appId],
    );
    expect(await publicRows(name)).toHaveLength(1);
  });

  it('shows an application with no assessment at all not at all', async () => {
    const bare = await seedApp(db, owner, 'Never assessed');
    const name = await makeProfile(owner, true);
    await show(owner, bare);
    expect(await publicRows(name)).toEqual([]);
  });
});

describe('the handle', () => {
  it('cannot be one that would read as us', async () => {
    // A profile at /b/vibefycode would be an impersonation we hosted.
    for (const reserved of ['vibefycode', 'official', 'support']) {
      const message = await refusal(
        `insert into public.builder_profiles (organisation_id, handle, display_name)
         values ($1, $2, 'A Builder')
         on conflict (organisation_id) do update set handle = excluded.handle`,
        [stranger.organisationId, reserved],
      );
      // Named, because the first version of this test passed against the
      // display-name constraint instead and proved nothing about the handle.
      expect(message, reserved).toMatch(/builder_profiles_handle_check/i);
    }
  });

  it('cannot be taken twice', async () => {
    const name = await makeProfile(owner, false);
    const message = await refusal(
      `insert into public.builder_profiles (organisation_id, handle, display_name)
       values ($1, $2, 'A Builder')`,
      [stranger.organisationId, name],
    );
    // A handle is an address. Two pages at one address is not a thing.
    expect(message).toMatch(/duplicate key|already exists|builder_profiles_handle/i);
  });
});

/** The organisation that owns a seeded app, since `seedBadgedApp` makes its own. */
async function accountOwning(appId: string): Promise<SeededAccount> {
  const { rows } = await db.query<{ organisation_id: string; created_by: string }>(
    'select organisation_id, created_by from public.apps where id = $1',
    [appId],
  );
  const row = rows[0]!;
  return { organisationId: row.organisation_id, userId: row.created_by, email: '' };
}

describe('which workspace the console page is about', () => {
  /*
   * The first version took whichever membership came back first, which is fine
   * for the common case of one workspace and wrong for everybody else: a person
   * who belongs to three would have configured one without ever being told
   * which, and would have had no way to reach the other two.
   */
  const page = readFileSync(join(process.cwd(), 'apps/web/app/console/profile/page.tsx'), 'utf8');

  it('says which workspace it is editing', () => {
    expect(page).toMatch(/For <strong>\{organisation\.name\}<\/strong>/);
  });

  it('lets somebody in more than one switch between them', () => {
    expect(page).toMatch(/workspaces\.length > 1/);
    expect(page).toMatch(/\/console\/profile\?workspace=/);
  });

  it('falls back to the first rather than to nothing', () => {
    // A page that showed an error because a stale link named a workspace
    // somebody has since left would be worse than quietly showing theirs.
    expect(page).toMatch(/workspaces\.find\(\(row\) => row\.id === asked\) \?\? workspaces\[0\]/);
  });
});

describe('reachable as a customer, not only as the database owner', () => {
  /*
   * These fixtures connect as the database owner, who is subject to neither
   * the privilege check nor row-level security — which is how three tables
   * shipped with policies, no grants, and a passing test suite. Nothing in
   * here would have worked the first time somebody opened the page.
   *
   * So this asks as the customer, through the same role Supabase uses.
   */
  it('lets an owner create and publish their own profile', async () => {
    const account = await seedAccount(db, 'profile-as-customer');
    const name = handle();

    await actingAs(db, { userId: account.userId }, async (client) => {
      await client.query(
        `insert into public.builder_profiles (organisation_id, handle, display_name)
         values ($1, $2, 'A Builder')`,
        [account.organisationId, name],
      );
      await client.query(
        `update public.builder_profiles set published = true where organisation_id = $1`,
        [account.organisationId],
      );
      const { rows } = await client.query(
        'select handle, published from public.builder_profiles where organisation_id = $1',
        [account.organisationId],
      );
      expect(rows[0]).toMatchObject({ handle: name, published: true });
    });
  });

  it('does not let somebody else read or change it', async () => {
    const account = await seedAccount(db, 'profile-owner-2');
    const outsider = await seedAccount(db, 'profile-outsider');
    const name = handle();
    await db.query(
      `insert into public.builder_profiles (organisation_id, handle, display_name)
       values ($1, $2, 'A Builder')`,
      [account.organisationId, name],
    );

    await actingAs(db, { userId: outsider.userId }, async (client) => {
      const { rows } = await client.query(
        'select handle from public.builder_profiles where organisation_id = $1',
        [account.organisationId],
      );
      expect(rows).toEqual([]);

      const changed = await client.query(
        `update public.builder_profiles set published = true where organisation_id = $1`,
        [account.organisationId],
      );
      expect(changed.rowCount).toBe(0);
    });
  });

  it('lets an owner put one of their own applications on it and take it off', async () => {
    const account = await seedAccount(db, 'profile-consent-customer');
    const appId = await seedApp(db, account, 'Mine');
    await db.query(
      `insert into public.builder_profiles (organisation_id, handle, display_name)
       values ($1, $2, 'A Builder')`,
      [account.organisationId, handle()],
    );

    await actingAs(db, { userId: account.userId }, async (client) => {
      await client.query(
        `insert into public.builder_profile_apps (organisation_id, app_id, consented_by)
         values ($1, $2, $3)`,
        [account.organisationId, appId, account.userId],
      );
      const removed = await client.query(
        'delete from public.builder_profile_apps where organisation_id = $1 and app_id = $2',
        [account.organisationId, appId],
      );
      expect(removed.rowCount).toBe(1);
    });
  });
});
