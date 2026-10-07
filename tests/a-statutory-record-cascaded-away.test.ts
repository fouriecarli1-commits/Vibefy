/**
 * A seven-year record that one delete would have taken with it.
 *
 * `RETENTION_SCHEDULE` is rendered to customers on `/console/privacy`, rationale
 * and all, and for `cost_record` it publishes 2555 days under: "Cost records are
 * financial records with a statutory retention period."
 *
 * A retention schedule says how long a row is kept. A foreign key says whether
 * it is kept at all. Measured against the live catalogue on 2026-10-07, every
 * long-lived table was written to survive a workspace deletion — `audit_log`,
 * `billing_events` and `retention_deletions` null the organisation and keep the
 * row; `consents`, `authorisations` and `invoices` refuse the delete outright —
 * except `cost_records`, which cascaded.
 *
 * So the single path by which a workspace could be removed would have destroyed
 * the financial records the schedule says we must keep. It is latent: there is
 * no delete policy on `organisations` and nothing in the product deletes one, so
 * it would only fire for an operator running the delete by hand — which is
 * exactly the circumstance in which they would least expect the accounts to go
 * with it. Six of seven agreed and the seventh did not, which is the pattern
 * decision 789 is about.
 *
 * The rule here is read from the published rationale rather than written out: a
 * data class whose own sentence says "statutory" must not be reachable by a
 * cascade. `evidence` at ninety days and `alert` at a year are deliberately not
 * covered — evidence is *meant* to be deleted, and the retention schedule is
 * the thing that deletes it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { RETENTION_SCHEDULE, type DataClass } from '../packages/governance/src/index.ts';

/**
 * The table each published data class lives in.
 *
 * Written out because the mapping is a judgement — "assessment_run_log" is the
 * `assessment_runs` table — and asserted complete below, so a class added to the
 * schedule without a line here fails rather than being skipped.
 */
const TABLE_FOR: Readonly<Record<DataClass, string>> = {
  evidence: 'evidence',
  assessment_run_log: 'assessment_runs',
  alert: 'alerts',
  cost_record: 'cost_records',
};

let db: Client;
let cascades: { child: string; parent: string; constraint: string }[];

beforeAll(async () => {
  db = await connect();
  const { rows } = await db.query<{ child: string; parent: string; constraint: string }>(
    `select c.relname as child, f.relname as parent, con.conname as constraint
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_class f on f.oid = con.confrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and con.contype = 'f' and con.confdeltype = 'c'
      order by c.relname, con.conname`,
  );
  cascades = rows;
});

afterAll(async () => {
  await db?.end();
});

describe('what the schedule calls statutory', () => {
  const statutory = RETENTION_SCHEDULE.filter((rule) => /statutory/i.test(rule.rationale));

  it('is something, so this file is testing a rule rather than an empty set', () => {
    expect(statutory.length).toBeGreaterThan(0);
    expect(statutory.map((rule) => rule.dataClass)).toContain('cost_record');
  });

  it('names a table for every class the schedule publishes', () => {
    expect(Object.keys(TABLE_FOR).sort()).toEqual(
      RETENTION_SCHEDULE.map((rule) => rule.dataClass).sort(),
    );
  });

  it('is kept for years, which is what makes a cascade matter', () => {
    for (const rule of statutory) expect(rule.days).toBeGreaterThan(365);
  });

  it('cannot be reached by a cascade from anywhere', () => {
    const reachable = statutory.flatMap((rule) =>
      cascades
        .filter((fk) => fk.child === TABLE_FOR[rule.dataClass])
        .map((fk) => `${fk.constraint} (${fk.child} → ${fk.parent})`),
    );
    // Anything here is a published multi-year retention that one delete
    // elsewhere defeats, with nothing anywhere saying so.
    expect(reachable).toEqual([]);
  });
});

describe('the siblings it was the odd one out among', () => {
  const action = async (constraint: string) => {
    const { rows } = await db.query<{ action: string }>(
      `select case con.confdeltype
                when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
                when 'c' then 'CASCADE' when 'n' then 'SET NULL'
                when 'd' then 'SET DEFAULT' end as action
         from pg_constraint con where con.conname = $1`,
      [constraint],
    );
    return rows[0]?.action ?? null;
  };

  it('refuses the delete where the organisation cannot be nulled', async () => {
    // `cost_records.organisation_id` is not null, so `set null` is unavailable
    // and `restrict` is the only answer that keeps the row. `invoices` is this
    // table's structural twin and already gave that answer.
    expect(await action('cost_records_organisation_id_fkey')).toBe('RESTRICT');
    expect(await action('invoices_organisation_id_fkey')).toBe('RESTRICT');
  });

  it('keeps the row and drops the link where it can be nulled', async () => {
    expect(await action('cost_records_assessment_id_fkey')).toBe('SET NULL');
    expect(await action('cost_records_assessment_run_id_fkey')).toBe('SET NULL');
    expect(await action('audit_log_organisation_id_fkey')).toBe('SET NULL');
    expect(await action('billing_events_organisation_id_fkey')).toBe('SET NULL');
  });

  it('still cascades the things a deletion request is supposed to remove', async () => {
    // The direction this rule fails in: refusing every delete, so a workspace
    // can never be removed and the deletion right cannot be honoured at all.
    expect(await action('evidence_organisation_id_fkey')).toBe('CASCADE');
    expect(await action('findings_assessment_id_fkey')).toBe('CASCADE');
  });
});
