/**
 * A value added to a Postgres enum and not to the TypeScript map that decides
 * what to do with it.
 *
 * Three of these turned up in one day, and they all read the same way:
 *
 *   · `screening_status` gained no value, but the gate named the two that
 *     block a run, so a fourth would have been assessed by default.
 *   · `finding_severity` is ranked in `@vibefycode/policy`, five lines in a
 *     package no migration mentions — and a rank that comes back undefined
 *     makes a procurement ceiling permit everything.
 *   · `plan_tier` had already done it once: a tier added to the enum and
 *     forgotten in the worker's validity table handed out twelve-month badges
 *     from a fallback.
 *
 * `alter type public.x add value 'y'` is one line in a migration. Every map
 * below is in a different package, and nothing in the migration mentions any
 * of them. So this asks the catalogue.
 *
 * The second half is the part that matters: every enum in the database must
 * appear here, either paired with the code that reads it or excused with a
 * reason. A list of the pairs somebody remembered is the defect, one level up.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { RETENTION_DAYS } from '../packages/engine/src/runtime/evidence.ts';
import { STOP_REASONS } from '../packages/shared/src/index.ts';
import { PLAN_TIERS } from '../packages/billing/src/index.ts';
import { REQUEST_KINDS } from '../packages/governance/src/index.ts';
import { getRubric, listRubricVersions } from '../packages/rubric/src/index.ts';
import { badgeStatus, type BadgeRow } from '../packages/badge/src/index.ts';

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function valuesOf(typeName: string): Promise<string[]> {
  const { rows } = await db.query<{ label: string }>(
    `select e.enumlabel as label
       from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = $1
      order by e.enumsortorder`,
    [typeName],
  );
  // A literal type name that no longer exists answers nothing, and nothing
  // compared as a subset reads as complete coverage. So the absence is an
  // error here rather than a quiet pass.
  expect(rows.length, `public.${typeName} has no values, or no such type`).toBeGreaterThan(1);
  return rows.map((row) => row.label);
}

const same = (a: readonly string[], b: readonly string[]) =>
  expect([...a].sort()).toEqual([...b].sort());

/** Enums whose values a map or list in TypeScript has to answer for. */
const PAIRED: readonly string[] = [
  'evidence_kind',
  'assessment_stop_reason',
  'plan_tier',
  'finding_severity',
  'confidence_level',
  'rubric_dimension',
  'data_request_type',
  'badge_status',
];

/**
 * And every other enum, with why no map has to match it.
 *
 * Written out rather than defaulted, because "no code reads this one" is a
 * claim about the code and the next value added to it. Each reason says what
 * the values are for; a reason that only says "nothing reads it" would be the
 * sentence this file exists to disbelieve.
 */
const UNPAIRED: Readonly<Record<string, string>> = {
  account_type: 'Stored on an organisation and rendered. No branch chooses behaviour by it.',
  alert_channel:
    'Which channel delivered an alert, for the delivery log. The sender is chosen by configuration, not by this value.',
  alert_kind:
    'Paired already, by tests/monitoring.test.ts, which asks pg_enum the same question about alert copy.',
  alert_severity:
    'Chooses a colour in the alert email through a record keyed by the same three words. A fourth would render without a colour, which is a visual defect and not a wrong answer about anybody.',
  app_type:
    'Recorded at intake and used to choose which stages apply, by explicit comparison rather than by a map, so an unknown type runs the stages that do not ask.',
  appeal_status:
    'A state machine in SQL, with the transitions enforced by a trigger in the same migration as the enum.',
  assessment_depth:
    'Paired through plan_tier: every entitlement names a depth, and the depth ceilings are keyed by it in config/pricing.json, whose keys tests/two-numbers-for-one-ceiling.test.ts reads against the engine.',
  assessment_status:
    'Nine states a run moves through, enforced by the trigger beside the enum. The worker writes them as literals.',
  authorisation_method:
    'How an authorisation was proved. Each method has its own verification path chosen by an explicit branch, and an unknown method reaches none of them.',
  authorisation_status:
    'Checked by app_is_authorised_for_testing in SQL, which names the one status that permits a run.',
  badge_event_type: 'Telemetry rows. Read by admin queries that group by it; nothing branches.',
  consent_action: 'Given or withdrawn, append-only, read by SQL.',
  consent_document:
    'Generated from legal/registry.json by tools/legal-registry.mjs, and tests/legal.test.ts compares the registry to the enum, which it does by name.',
  cost_purpose: 'Why a cost record exists. Summed by SQL, never branched on.',
  data_request_status:
    'The statutory state machine, with its transitions in @vibefycode/governance and its deadline in the column default. tests/the-table-a-regulator-reads.test.ts holds the deadline against the published notice.',
  engagement_pricing: 'Marketing engagements, priced by an explicit branch per value.',
  engagement_status: 'Marketing engagement state, read by SQL and rendered.',
  invoice_status:
    'Written from the payment provider’s own status. The one value that matters is compared by name where a paid invoice is required.',
  listing_state: 'Listed or not. The view public.listed_badges names the one value that publishes.',
  org_role:
    'Checked by name in row-level security policies, in SQL, in the same migration as the enum.',
  payment_provider:
    'Which provider took a payment. The provider is chosen by currency in @vibefycode/billing, not by reading this back.',
  platform_role: 'Our own staff roles, checked by name in policies.',
  report_format: 'Which artefact a report was rendered as. Chosen before it is written.',
  request_status:
    'Assessment requests from a platform on somebody else’s behalf, with its transitions in SQL.',
  review_action: 'What a reviewer did, append-only, rendered as written.',
  run_stage:
    'Which stage a cost or log row belongs to. The stage list is the pipeline’s own, and a stage with no enum value fails the insert loudly.',
  run_status: 'A worker run’s outcome, written as literals and read by admin queries.',
  screening_status:
    'Paired already, by tests/the-status-that-was-not-on-the-list.test.ts, after the gate named the statuses that block rather than the one that permits.',
  sponsorship_placement:
    'Where a sponsorship appears. Each placement has its own component, chosen by an explicit branch.',
  sponsorship_status: 'Sponsorship state, read by SQL and rendered.',
  subscription_status:
    'Mirrored from the payment provider. The values that mean "paying" are named where that question is asked.',
};

describe('every enum in the database', () => {
  it('is either paired with the code that reads it or excused with a reason', async () => {
    const { rows } = await db.query<{ label: string }>(
      `select distinct t.typname as label
         from pg_enum e
         join pg_type t on t.oid = e.enumtypid
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public'
        order by 1`,
    );
    const inDatabase = rows.map((row) => row.label);
    expect(inDatabase.length, 'no enums found, so this test read nothing').toBeGreaterThan(20);
    same(inDatabase, [...PAIRED, ...Object.keys(UNPAIRED)]);
  });

  it('gives a reason for each unpaired one that says what its values are for', async () => {
    for (const [name, why] of Object.entries(UNPAIRED)) {
      expect(why.length, name).toBeGreaterThan(40);
      expect(why, `${name}: a reason that only says nothing reads it is not a reason`).not.toMatch(
        /^nothing reads/i,
      );
    }
  });
});

describe('the pairs', () => {
  it('evidence_kind has a retention period for every kind', async () => {
    // A kind with no period makes `retention_until` an invalid date, so the
    // sweep that deletes on it never sees the row — a retention promise kept
    // for every artefact except the new one.
    same(await valuesOf('evidence_kind'), Object.keys(RETENTION_DAYS));
  });

  it('assessment_stop_reason has a sentence for every reason', async () => {
    // `STOP_LABEL` is what a report says about why a run stopped. A reason
    // with no label prints "undefined" to a customer.
    same(await valuesOf('assessment_stop_reason'), [...STOP_REASONS]);
  });

  it('plan_tier has an entitlement for every tier', async () => {
    // Coverage, depth, report tier and ceiling all come from this map. A tier
    // with no entitlement is a plan whose terms nobody decided.
    same(await valuesOf('plan_tier'), [...PLAN_TIERS]);
  });

  it('finding_severity has a penalty in every published rubric', async () => {
    const severities = await valuesOf('finding_severity');
    for (const version of listRubricVersions()) {
      same(severities, Object.keys(getRubric(version).scoring.severityPenalties));
    }
  });

  it('confidence_level has a multiplier in every published rubric', async () => {
    const levels = await valuesOf('confidence_level');
    for (const version of listRubricVersions()) {
      same(levels, Object.keys(getRubric(version).scoring.confidenceMultipliers));
    }
  });

  it('rubric_dimension is the set of dimensions in every published rubric', async () => {
    // Both directions: a dimension in the database and not the rubric has no
    // weight, and one in the rubric and not the database cannot be stored.
    const dimensions = await valuesOf('rubric_dimension');
    for (const version of listRubricVersions()) {
      same(
        dimensions,
        getRubric(version).dimensions.map((dimension) => dimension.id),
      );
    }
  });

  it('data_request_type has copy for every type a person can ask for', async () => {
    // The promise shown beside each right on /console/privacy. A type with no
    // copy throws in `kindCopy`, which is the loud half; the quiet half is a
    // right we never offer because nothing lists it.
    same(
      await valuesOf('data_request_type'),
      REQUEST_KINDS.map((kind) => kind.type),
    );
  });

  it('badge_status has a public state for every status', async () => {
    /*
     * `STATE_BY_STATUS` falls back to `revoked`, deliberately: "there is no
     * status the database can invent that should make a stranger's page show
     * our mark." That is the right fallback for a value nobody chose and the
     * wrong one for a status somebody adds on purpose — a badge paused for a
     * billing problem would read as revoked to every integrator.
     *
     * Asked of the behaviour rather than the map, because the map is private:
     * each status must map to its own state, and only `revoked` may answer
     * `revoked`.
     */
    const row: BadgeRow = {
      public_id: 'pub-1',
      slug: 'an-app',
      status: 'active',
      app_name: 'An App',
      certified_origin: 'https://customer.example',
      rubric_version: '1.1.0',
      assessed_at: '2026-10-01T00:00:00.000Z',
      expires_at: null,
    };
    for (const status of await valuesOf('badge_status')) {
      const state = badgeStatus({ ...row, status }, 'https://v.example').state;
      if (status === 'revoked') {
        expect(state).toBe('revoked');
        continue;
      }
      expect(state, `${status} has no public state of its own`).not.toBe('revoked');
    }
  });
});
