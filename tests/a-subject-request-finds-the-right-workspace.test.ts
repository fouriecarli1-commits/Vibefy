/**
 * The workspace a data-subject request is filed against.
 *
 * `submitDataRequest` asked the database for the caller's memberships and then
 * picked the personal one:
 *
 *     const { data: membership } = await supabase
 *       .from('memberships')
 *       .select('organisation_id, organisations (is_personal)')
 *       .limit(20);
 *     const personal = rows.find((row) => row.organisations?.is_personal) ?? rows[0];
 *
 * Three faults in four lines, and they compound.
 *
 *   1. **A limited window with no `order by`.** Which twenty rows come back is
 *      whatever the plan happens to produce.
 *   2. **The filter runs in JavaScript, after the limit.** `is_personal` is the
 *      thing being looked for and the database was never told. A caller in more
 *      than twenty workspaces can have their personal one outside the window,
 *      and then `find` matches nothing.
 *   3. **`?? rows[0]` turns that miss into an arbitrary workspace** — quite
 *      possibly a client's or an employer's, since the callers with more than
 *      twenty memberships are exactly the agency and consultant accounts.
 *
 * Every user does get a personal workspace: `handle_new_auth_user` creates one
 * on signup. So the trigger is narrow — more than twenty memberships — and the
 * consequence is not.
 *
 * `organisation_id` on `data_requests` grants nobody access:
 * `data_requests_select_own` is `user_id = auth.uid() or is_platform_admin()`.
 * But it is copied onto the audit row when a reviewer exports the subject's
 * data, in `app/review/requests/[id]/export/route.ts`, and **there** it decides
 * who can read:
 *
 *     create policy audit_log_select_members on public.audit_log
 *       using ((organisation_id is not null and public.is_org_member(organisation_id))
 *              or public.is_platform_admin());
 *
 * So every member of that unrelated workspace could read a row saying this
 * person made a data-subject request, which kind, and how much data it covered.
 * A privacy leak about a privacy request, produced by a filter applied after a
 * limit.
 *
 * These tests hold the query shape against the database rather than the action
 * itself, because the shape is what was wrong — the action is the Supabase
 * client's spelling of exactly this.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

let db: Client;
let crowded: SeededAccount;
let personalOrgId: string;

/**
 * A consultant: one personal workspace and twenty-four clients.
 *
 * The personal workspace is created **first**, by the signup trigger, and the
 * clients after it — so an unordered `limit 20` over a freshly written table
 * returns rows that include it. The fault is not that the personal row sorts
 * badly; it is that nothing asked for it, and nothing said which twenty. The
 * assertions below therefore test what the query is *told to find*, not which
 * rows a plan happens to return today.
 */
beforeAll(async () => {
  db = await connect();
  crowded = await seedAccount(db, 'crowded-consultant');
  personalOrgId = crowded.organisationId;

  for (let i = 0; i < 24; i += 1) {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.organisations (name, slug, account_type, is_personal, created_by)
       values ($1, $2, 'agency', false, $3) returning id`,
      [`Client ${i}`, `crowded-client-${i}-${Date.now().toString(36)}`, crowded.userId],
    );
    await db.query(
      `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'member')`,
      [rows[0]!.id, crowded.userId],
    );
  }
});

afterAll(async () => {
  await db?.end();
});

/** What the action now asks for: the personal workspace, by name, in SQL. */
async function personalWorkspaceOf(userId: string): Promise<string | null> {
  const { rows } = await db.query<{ organisation_id: string }>(
    `select m.organisation_id
       from public.memberships m
       join public.organisations o on o.id = m.organisation_id
      where m.user_id = $1 and o.is_personal
      limit 1`,
    [userId],
  );
  return rows[0]?.organisation_id ?? null;
}

describe('the workspace a request is filed against', () => {
  it('is the personal one, however many others there are', async () => {
    expect(await personalWorkspaceOf(crowded.userId)).toBe(personalOrgId);
  });

  it('is found without reading every membership first', async () => {
    // The point of filtering in SQL: the answer does not depend on how many
    // rows a window happened to include.
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.memberships where user_id = $1`,
      [crowded.userId],
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(20);
    expect(await personalWorkspaceOf(crowded.userId)).toBe(personalOrgId);
  });

  it('is null rather than an arbitrary workspace when there is no personal one', async () => {
    // `handle_new_auth_user` gives everybody one, so this is the shape that
    // should never happen — which is exactly why the fallback must not invent an
    // answer. An unknown workspace recorded as unknown is a true statement; an
    // unknown workspace recorded as somebody's client is not.
    const stranger = await seedAccount(db, 'no-personal-workspace');
    await db.query(`update public.organisations set is_personal = false where id = $1`, [
      stranger.organisationId,
    ]);

    expect(await personalWorkspaceOf(stranger.userId)).toBeNull();
  });
});

describe('the action itself', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/web/app/console/privacy/actions.ts'),
    'utf8',
  );

  it('asks the database for the personal workspace rather than sifting afterwards', () => {
    expect(source).toMatch(/is_personal/);
    // The three shapes that were there, each gone.
    expect(source).not.toMatch(/\.limit\(20\)/);
    expect(source).not.toMatch(/rows\.find\(/);
    expect(source).not.toMatch(/\?\? rows\[0\]/);
  });

  it('files the request against nothing rather than against a guess', () => {
    expect(source).toMatch(/organisation_id: personal\?\.organisation_id \?\? null/);
  });
});
