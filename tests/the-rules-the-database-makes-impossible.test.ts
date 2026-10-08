/**
 * Every rule this schema enforces with a trigger, named — so that one going
 * missing is a failure rather than a diff nobody reads.
 *
 * `tools/policy-mutation.mjs triggers` answers a different question: which of
 * these rules would nothing notice the loss of. Re-run on 2026-10-08, the
 * answer is reassuring — twenty-nine assertion triggers, sixty-eight failing
 * test files when all of them are disabled, against none at all in September.
 *
 * The question this file answers is the one the mutation cannot: whether the
 * *set* is still what it was. A migration that drops a trigger changes
 * `supabase/schema.sql` in the same breath, so `deployment.test.ts` compares
 * one new file against another and sees nothing wrong. Only a list written
 * somewhere else notices.
 *
 * Both directions, because a list that can fall behind the schema is a
 * description and not a rule:
 *
 *   · a rule here that the database no longer carries, and
 *   · a trigger the database carries that nobody wrote down.
 *
 * Each line is the rule in the schema's own words — the sentence the trigger
 * raises — rather than my summary of it, so the list cannot drift from what
 * the database actually says while still looking right.
 *
 * Out of scope on purpose: the seventeen `set_updated_at` triggers, which are
 * bookkeeping rather than rules, and the eleven `reject_mutation` ones, which
 * are one rule applied eleven times and have their own file with the events
 * each must refuse.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';

/**
 * `table.trigger` → what it makes impossible.
 *
 * Where the trigger raises, the line is its own sentence, shortened. Where it
 * records rather than refuses, the line says what would otherwise go
 * unrecorded.
 */
const RULES: Readonly<Record<string, string>> = {
  'appeals.appeals_set_deadline':
    'An appeal gets the published turnaround, not a date whoever filed it chose.',
  'apps.apps_refusal_at_intake_is_written_down':
    'A submission that arrives already refused is written into the audit log.',
  'assessments.assessments_certification_gate':
    'An assessment with a critical security or privacy finding cannot be certification-eligible.',
  'assessments.assessments_require_authorisation':
    'An app with no verified, unexpired authorisation to test cannot carry an assessment.',
  'assessments.assessments_require_evidence':
    'A published finding without evidence stops the assessment it belongs to.',
  'assessments.assessments_require_human_review':
    'An assessment must pass through awaiting_review before it is approved or rejected.',
  'assessments.assessments_score_is_not_pulled_from_under_a_badge':
    'The number under a signed badge cannot be rewritten; the correction is the published three steps.',
  'authorisations.authorisations_are_verified_by_us':
    'A customer may ask and may withdraw; whether ownership was proved is ours to record.',
  'badges.badges_log_lifecycle': 'Every badge that moves leaves a badge_event saying why.',
  'badges.badges_must_be_earned':
    'A badge needs a real assessment, a human approval, the certification gate and an accepted licence.',
  'billing_events.billing_events_immutable_payload':
    'What a provider told us is fixed; only the handled flag may change.',
  'builder_profile_apps.builder_profile_apps_own_only':
    'An application can only appear on the profile of the organisation that owns it.',
  'data_requests.data_requests_set_deadline':
    'A statutory request gets the statutory clock, not one its subject set.',
  'directory_listings.directory_listings_record_event':
    'Every listing that appears or goes leaves a listing_event saying why.',
  'invitations.invitations_seat_limit':
    'An invitation beyond the seats a workspace pays for is refused, counting outstanding ones.',
  'memberships.memberships_keep_an_owner': 'An organisation must retain at least one owner.',
  'memberships.memberships_seat_limit':
    'A membership beyond the seats a workspace pays for is refused.',
  'reviews.reviews_reviewer_not_a_remediation_worker':
    'A reviewer paid to work on an application may not review its assessment.',
  'rubric_versions.rubric_versions_frozen_once_published':
    'A published rubric version is immutable; publish a new version instead.',
  'sponsorships.sponsorships_need_a_reviewer':
    'A sponsorship cannot go live without a recorded human review.',
  'sponsorships.sponsorships_one_per_surface':
    'Two sponsorships cannot hold one surface for overlapping periods.',
  'sso_connections.sso_domains_are_verified_by_us':
    'A workspace may claim a domain; whether the DNS record was there is ours to record.',
  'trust_pages.trust_pages_own_only':
    'A trust page belongs to the organisation that owns the application.',
};

/**
 * Functions that are not rules, with the reason they are not listed above.
 *
 * `handle_new_auth_user` is on `auth.users`, outside the `public` schema this
 * reads, and is the only one that would otherwise need a note here.
 */
const NOT_RULES: Readonly<Record<string, string>> = {
  set_updated_at: 'bookkeeping — a timestamp, not a rule',
  reject_mutation: 'one rule eleven times; see the-tables-that-may-only-be-added-to.test.ts',
};

let db: Client;
let present: readonly string[];

beforeAll(async () => {
  db = await connect();
  const { rows } = await db.query<{ key: string }>(
    `select c.relname || '.' || t.tgname as key
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_proc p on p.oid = t.tgfoid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal
        and p.proname <> all ($1::text[])
      order by key`,
    [Object.keys(NOT_RULES)],
  );
  present = rows.map((row) => row.key);
});

afterAll(async () => {
  await db?.end();
});

describe('the rules, against the schema', () => {
  it('still carries every rule on the list', () => {
    const gone = Object.keys(RULES).filter((key) => !present.includes(key));
    expect(
      gone,
      'a rule the database used to enforce is no longer there. If that was deliberate, remove it ' +
        `from RULES in the same change:\n  ${gone.map((key) => `${key} — ${RULES[key]}`).join('\n  ')}`,
    ).toEqual([]);
  });

  it('carries nothing that nobody wrote down', () => {
    const unlisted = present.filter((key) => RULES[key] === undefined);
    expect(
      unlisted,
      'a trigger enforces something and this file does not say what. Add it with the sentence it ' +
        `raises, or add its function to NOT_RULES with the reason:\n  ${unlisted.join('\n  ')}`,
    ).toEqual([]);
  });

  it('is not empty, which is how a catalogue test passes having read nothing', () => {
    expect(present.length).toBe(Object.keys(RULES).length);
    expect(present.length).toBeGreaterThan(20);
  });
});
