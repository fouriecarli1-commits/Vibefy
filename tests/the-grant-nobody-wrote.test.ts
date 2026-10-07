/**
 * The default grant on a `security definer` function, which nobody wrote down.
 *
 * `cost_records` carries RLS restricting select to platform admins, and
 * `tests/money.test.ts` holds that under the heading "is invisible to customers
 * and to reviewers alike". Measured on 2026-10-07, as the `anon` role:
 *
 *     spend_since        = 2.310345
 *     free_tier_spend    = 122.310345
 *     spending_is_paused = false
 *
 * Postgres grants EXECUTE on a new function to PUBLIC by default and PostgREST
 * publishes every `public`-schema function as `/rpc/<name>`, so a
 * `security definer` function reaches the internet — reading its tables as the
 * owner, past every policy — unless a migration takes the grant away. Five
 * functions here have such a revoke. Seven did not.
 *
 * So the rule is not about those seven. It is the shape of mistake: a function
 * that reads a table the caller may not read, reachable by a caller who was
 * never granted anything. The catalogue knows enough to state it, which means a
 * function added next month is covered without anybody remembering this file.
 *
 * Three exemptions, each measured rather than assumed:
 *
 *   - A function returning `trigger` cannot be called directly at all. Postgres
 *     answers "trigger functions can only be called as triggers".
 *   - A function named in an RLS policy expression must stay callable, because
 *     policy expressions are evaluated as the current role. Revoking
 *     `is_org_member` would break every anon-facing read in the product.
 *   - `sso_routing` is granted to `anon` on purpose, by a line that says so:
 *     the sign-in form has to ask where to send an email address before
 *     anybody is signed in.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actingAs, connect } from './setup/client.ts';
import { seedBadgedApp } from './setup/seed.ts';

/**
 * Functions `anon` may execute although they read a table `anon` may not read,
 * each with the line of SQL that says so. Anything not in here is a defect.
 */
const DELIBERATELY_ANON_CALLABLE: Readonly<Record<string, string>> = {
  sso_routing: 'grant execute on function public.sso_routing(text) to anon, authenticated',
  // `badge_verification` projects this as `owner_has_remediation`, and a view
  // declared `security_invoker = false` shields the privileges on its
  // underlying tables — not EXECUTE on a function in its own select list,
  // which is still checked against whoever is asking. Revoking it returned
  // HTTP 500 on every public verification page. Safe to leave because the
  // boolean is published content: the brief requires a remediation client to
  // be disclosed on the very page that reads it.
  app_has_remediation: 'left with its default grant — projected by public.badge_verification',
};

interface DefinerRow {
  readonly proname: string;
  readonly identity: string;
  readonly returns_trigger: boolean;
  readonly in_policy: boolean;
  readonly unreadable_tables: string | null;
}

let db: Client;
let definers: readonly DefinerRow[];

beforeAll(async () => {
  db = await connect();
  const { rows } = await db.query<DefinerRow>(`
    with definer as (
      select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as identity,
             p.prorettype = 'trigger'::regtype as returns_trigger,
             p.prosrc
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosecdef
         and has_function_privilege('anon', p.oid, 'execute')
    ),
    policy_text as (
      select coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
             coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') as expr
        from pg_policy pol
    )
    select d.proname, d.identity, d.returns_trigger,
           exists (select 1 from policy_text t where t.expr ~ ('\\m' || d.proname || '\\M')) as in_policy,
           (select string_agg(c.relname, ', ' order by c.relname)
              from pg_class c
              join pg_namespace cn on cn.oid = c.relnamespace
             where cn.nspname = 'public'
               and c.relkind in ('r', 'v', 'm')
               and not has_table_privilege('anon', c.oid, 'select')
               and d.prosrc ~ ('\\m' || c.relname || '\\M')) as unreadable_tables
      from definer d
     order by d.proname
  `);
  definers = rows;
});

afterAll(async () => {
  await db?.end();
});

describe('what the anon role may call', () => {
  it('reads a catalogue that is not empty', () => {
    // If this query ever comes back with nothing, the rule below passes by
    // measuring nothing — which is the failure mode this whole file is about.
    expect(definers.length).toBeGreaterThan(10);
  });

  it('exposes no definer function that reads a table the caller may not read', () => {
    const offenders = definers
      .filter((row) => row.unreadable_tables !== null)
      .filter((row) => !row.returns_trigger)
      .filter((row) => !row.in_policy)
      .filter((row) => DELIBERATELY_ANON_CALLABLE[row.proname] === undefined)
      .map((row) => `public.${row.proname}(${row.identity}) reads ${row.unreadable_tables}`);

    expect(
      offenders,
      `anon may execute ${offenders.length} security definer function(s) that read tables anon ` +
        `cannot select. Either add a revoke in a migration, or list it in ` +
        `DELIBERATELY_ANON_CALLABLE with the line of SQL that grants it:\n  ` +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('keeps the caller-identity helpers that RLS policies depend on', () => {
    // The other half of the rule. A blanket revoke across every definer
    // function would satisfy the test above and lock every visitor out of the
    // directory, so the exemption has to be asserted, not merely allowed.
    const byName = new Map(definers.map((row) => [row.proname, row]));
    for (const helper of ['is_org_member', 'has_org_role', 'is_platform_admin', 'is_reviewer']) {
      expect(byName.get(helper), `anon can no longer execute ${helper}`).toBeDefined();
      expect(byName.get(helper)?.in_policy, `${helper} is no longer used in any policy`).toBe(true);
    }
  });
});

describe('the figure a reviewer may not see', () => {
  it('refuses the platform spend total to an unauthenticated caller', async () => {
    await actingAs(db, { role: 'anon' }, async (client) => {
      await expect(
        client.query(`select public.spend_since(now() - interval '1 day')`),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  it('refuses the free-tier total and the pause flag to the same caller', async () => {
    // One `actingAs` per statement on purpose. A refused statement aborts the
    // transaction, so a second one inside the same block comes back with
    // "current transaction is aborted" — which is not the refusal being
    // asserted, and would pass a test of the wrong thing.
    for (const sql of [
      `select public.free_tier_spend_since(now() - interval '7 days')`,
      `select public.spending_is_paused()`,
      `select public.seats_used(gen_random_uuid())`,
      `select public.seats_for_organisation(gen_random_uuid())`,
      `select public.platform_role_of(gen_random_uuid())`,
    ]) {
      await actingAs(db, { role: 'anon' }, async (client) => {
        await expect(client.query(sql), sql).rejects.toThrow(/permission denied/i);
      });
    }
  });

  it('still projects the column a public view computes from a definer function', async () => {
    /*
     * The case that caught the first version of the migration, and the reason
     * it reads a column rather than counting rows: `select count(*)` lets
     * Postgres prune a column nobody projected, and it prunes through a
     * subquery too, so neither form evaluates the function at all. Three
     * measurements in a row came back clean on a view that was about to start
     * returning `permission denied for function app_has_remediation` to every
     * visitor.
     */
    // Seeds its own badge rather than trusting whatever the reset left behind.
    // A view with no rows never evaluates anything in its select list, which is
    // the same way the defect hid in the first place.
    const { slug } = await seedBadgedApp(db, 'anon-grant');
    await actingAs(db, { role: 'anon' }, async (client) => {
      const { rows } = await client.query(
        `select owner_has_remediation from public.badge_verification where slug = $1`,
        [slug],
      );
      expect(rows.length, 'the seeded badge is not in badge_verification').toBe(1);
    });
  });

  it('still answers the owner, which is the only caller there is', async () => {
    const { rows } = await db.query<{ total: string }>(
      `select public.spend_since(now() - interval '1 day') as total`,
    );
    expect(Number(rows[0]!.total)).toBeGreaterThanOrEqual(0);
  });
});
