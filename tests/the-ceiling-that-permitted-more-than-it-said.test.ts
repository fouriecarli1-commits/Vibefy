/**
 * The ceiling that governs what we do to somebody else's application.
 *
 * `policyFromAuthorisation` turns the customer's authorisation record into the
 * policy the scope guard enforces. `intensity_ceiling` is jsonb with no shape
 * constraint, and the conversion read every field the same way:
 *
 *     nonDestructiveOnly: raw.non_destructive_only === true
 *
 * That is right for a *permission* — absent means not granted. For a
 * *restriction* it is backwards, and both restrictions on the record were
 * written that way. Measured on 2026-10-10: `non_destructive_only` and
 * `synthetic_accounts_only` came back false for an empty object, for a null,
 * and for the string `'true'`. What that permits is destructive operations
 * against a customer's application, with real accounts rather than synthetic
 * ones — the two things the brief is most explicit about.
 *
 * The column's default sets both to true, so a record written the ordinary way
 * was fine. A record written with a partial object was not, and nothing would
 * have said so.
 *
 * The numbers were worse in one direction and better in another:
 * `Number(raw.x ?? DEFAULT)` covered an absent key and nothing else, so a
 * non-numeric string gave `NaN` — and every `count > NaN` is false, so the one
 * thing bounding how hard we hit the application stopped bounding it. An empty
 * string gave 0, which fails closed and merely looks like a broken run.
 *
 * Now: absent means "not specified" and the default stands; present and
 * unusable stops the run, because a ceiling we cannot read is not a ceiling.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CEILING,
  MalformedCeilingError,
  policyFromAuthorisation,
} from '../packages/engine/src/index.ts';

const from = (ceiling: Record<string, unknown>) =>
  policyFromAuthorisation({
    scope_domains: ['kettle.example'],
    scope_exclusions: [],
    intensity_ceiling: ceiling,
  });

/** What the column's default writes, which is the ordinary case. */
const AS_WRITTEN = {
  non_destructive_only: true,
  max_requests_per_minute: 240,
  max_total_requests: 12000,
  max_duration_seconds: 1800,
  allow_data_modification: false,
  allow_data_export: false,
  allow_account_creation: true,
  synthetic_accounts_only: true,
};

describe('a record written the ordinary way', () => {
  it('comes through exactly as it stands, which is what the rest of this rests on', () => {
    const { ceiling } = from(AS_WRITTEN);
    expect(ceiling).toEqual({
      nonDestructiveOnly: true,
      maxRequestsPerMinute: 240,
      maxTotalRequests: 12000,
      maxDurationSeconds: 1800,
      allowDataModification: false,
      allowDataExport: false,
      allowAccountCreation: true,
      syntheticAccountsOnly: true,
    });
  });

  it('still refuses a private address, whatever the record says', () => {
    expect('allowPrivateNetworkForTesting' in from(AS_WRITTEN)).toBe(false);
  });
});

describe('a restriction the record does not mention', () => {
  it('stays on, rather than reading as permission to ignore it', () => {
    const { ceiling } = from({});
    expect(ceiling.nonDestructiveOnly, 'destructive operations were permitted').toBe(true);
    expect(ceiling.syntheticAccountsOnly, 'real accounts were permitted').toBe(true);
  });

  it('stays on when the record says null, which is what a partial write leaves', () => {
    const { ceiling } = from({ non_destructive_only: null, synthetic_accounts_only: null });
    expect(ceiling.nonDestructiveOnly).toBe(true);
    expect(ceiling.syntheticAccountsOnly).toBe(true);
  });

  it('comes off only when the record says false in so many words', () => {
    // The positive control: a fix that pinned both to true would satisfy every
    // assertion above and ignore the customer's actual decision.
    const { ceiling } = from({ non_destructive_only: false, synthetic_accounts_only: false });
    expect(ceiling.nonDestructiveOnly).toBe(false);
    expect(ceiling.syntheticAccountsOnly).toBe(false);
  });
});

describe('a permission the record does not mention', () => {
  it('is not granted, which was already right', () => {
    const { ceiling } = from({});
    expect(ceiling.allowDataModification).toBe(false);
    expect(ceiling.allowDataExport).toBe(false);
    expect(ceiling.allowAccountCreation).toBe(false);
  });

  it('is granted when the record grants it', () => {
    expect(from({ allow_data_export: true }).ceiling.allowDataExport).toBe(true);
  });
});

describe('a ceiling we cannot read', () => {
  it('refuses rather than becoming NaN, which no count is ever greater than', () => {
    expect(() => from({ max_requests_per_minute: 'lots' })).toThrow(MalformedCeilingError);
    expect(() => from({ max_requests_per_minute: 'lots' })).toThrow(/not a limit/);
  });

  it('refuses an empty string, which used to mean a ceiling of zero', () => {
    expect(() => from({ max_total_requests: '' })).toThrow(MalformedCeilingError);
  });

  it('refuses a flag written as a string, which used to read as false', () => {
    expect(() => from({ non_destructive_only: 'true' })).toThrow(/rather than true or false/);
    expect(() => from({ allow_data_export: 'yes' })).toThrow(/rather than true or false/);
  });

  it('refuses a limit of zero or less, because that is not a limit either', () => {
    expect(() => from({ max_duration_seconds: 0 })).toThrow(MalformedCeilingError);
    expect(() => from({ max_total_requests: -5 })).toThrow(MalformedCeilingError);
  });

  it('names the field and what it found, because somebody has to fix the record', () => {
    expect(() => from({ max_duration_seconds: 'forever' })).toThrow(/max_duration_seconds/);
    expect(() => from({ max_duration_seconds: 'forever' })).toThrow(/"forever"/);
  });

  it('takes a number written as a numeric string, which jsonb round-trips produce', () => {
    expect(from({ max_requests_per_minute: '120' }).ceiling.maxRequestsPerMinute).toBe(120);
  });

  it('falls back to the default only when the key is absent', () => {
    expect(from({}).ceiling.maxRequestsPerMinute).toBe(DEFAULT_CEILING.maxRequestsPerMinute);
    expect(from({}).ceiling.maxTotalRequests).toBe(DEFAULT_CEILING.maxTotalRequests);
    expect(from({}).ceiling.maxDurationSeconds).toBe(DEFAULT_CEILING.maxDurationSeconds);
  });
});
