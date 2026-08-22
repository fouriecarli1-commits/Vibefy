/**
 * Badge issuance and lifecycle, against the database.
 *
 * Three separate things must be true before a badge exists, and they are checked
 * one at a time here because each is a rule we sell: a human approved the
 * assessment, the rubric gate passed, and the owner accepted the trademark
 * licence. None of the three can be bought.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { createPublicKey } from 'node:crypto';
import {
  buildKeySet,
  generateSigningKey,
  privateKeyFromBase64,
  renderBadgeSvg,
  toJwk,
  verifyBadge,
} from '../packages/badge/src/index.ts';
import {
  BADGE_LICENCE_VERSION,
  findIssuanceCandidates,
  issueBadgeFor,
  sweepBadgeLifecycle,
} from '../apps/worker/src/badge.ts';
import { connect } from './setup/client.ts';
import {
  approveAssessment,
  makeReviewer,
  seedAccount,
  seedAssessment,
  seedFinding,
  sha256,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let pool: Pool;
let owner: SeededAccount;
let reviewer: SeededAccount;

const generated = generateSigningKey('vibefy-badge-test');
const privateKey = privateKeyFromBase64(generated.privateKeyB64);
const key = {
  kid: generated.kid,
  privateKey,
  jwk: toJwk(createPublicKey(privateKey), generated.kid),
};
const keySet = buildKeySet(key);

async function acceptLicence(account: SeededAccount): Promise<void> {
  await db.query(
    `insert into public.consents (user_id, organisation_id, document_type, document_version, document_sha256, action)
     values ($1, $2, 'badge_licence', $3, $4, 'accepted')`,
    [account.userId, account.organisationId, BADGE_LICENCE_VERSION, sha256('badge-licence')],
  );
}

async function approvedAssessment(
  certificationEligible = true,
): Promise<{ assessmentId: string; appId: string }> {
  const seeded = await seedAssessment(db, owner);
  await seedFinding(db, owner, seeded.assessmentId, { severity: 'low' });
  await approveAssessment(db, owner, seeded.assessmentId, reviewer.userId, {
    certificationEligible,
    score: 84.5,
  });
  return seeded;
}

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFY_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  reviewer = await seedAccount(db, 'badge-reviewer');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

// A fresh workspace per test rather than a cleanup between them: consents and
// badge events are append-only, and a test suite that needs to delete evidence
// is a test suite quietly arguing the evidence should be deletable.
beforeEach(async () => {
  owner = await seedAccount(db, 'badge-owner');
});

describe('the three gates', () => {
  it('does not offer a badge for an assessment no human approved', async () => {
    const seeded = await seedAssessment(db, owner);
    await seedFinding(db, owner, seeded.assessmentId);
    await acceptLicence(owner);

    const client = await pool.connect();
    try {
      const candidates = await findIssuanceCandidates(client);
      expect(candidates.some((candidate) => candidate.assessmentId === seeded.assessmentId)).toBe(
        false,
      );
    } finally {
      client.release();
    }
  });

  it('does not offer a badge for an assessment that failed the certification gate', async () => {
    const { assessmentId } = await approvedAssessment(false);
    await acceptLicence(owner);

    const client = await pool.connect();
    try {
      const candidates = await findIssuanceCandidates(client);
      expect(candidates.some((candidate) => candidate.assessmentId === assessmentId)).toBe(false);
    } finally {
      client.release();
    }
  });

  it('does not offer a badge until the licence is accepted', async () => {
    const { assessmentId } = await approvedAssessment();

    const client = await pool.connect();
    try {
      expect(
        (await findIssuanceCandidates(client)).some((c) => c.assessmentId === assessmentId),
      ).toBe(false);
      await acceptLicence(owner);
      expect(
        (await findIssuanceCandidates(client)).some((c) => c.assessmentId === assessmentId),
      ).toBe(true);
    } finally {
      client.release();
    }
  });

  it('does not accept a licence acceptance at a superseded version', async () => {
    const { assessmentId } = await approvedAssessment();
    await db.query(
      `insert into public.consents (user_id, organisation_id, document_type, document_version, document_sha256, action)
       values ($1, $2, 'badge_licence', '0.9.0-draft', $3, 'accepted')`,
      [owner.userId, owner.organisationId, sha256('old-licence')],
    );

    const client = await pool.connect();
    try {
      expect(
        (await findIssuanceCandidates(client)).some((c) => c.assessmentId === assessmentId),
      ).toBe(false);
    } finally {
      client.release();
    }
  });
});

describe('issuing', () => {
  it('produces a badge that verifies against the published key', async () => {
    const seeded = await approvedAssessment();
    await acceptLicence(owner);

    const client = await pool.connect();
    let issued;
    try {
      const [candidate] = await findIssuanceCandidates(client);
      expect(candidate).toBeDefined();
      issued = await issueBadgeFor(client, candidate!, key);
    } finally {
      client.release();
    }

    const { rows } = await db.query<{
      payload: Record<string, unknown>;
      signature: string;
      status: string;
    }>('select payload, signature, status from public.badges where id = $1', [issued.badgeId]);
    const result = verifyBadge(
      { payload: rows[0]!.payload, signature: rows[0]!.signature },
      keySet,
    );
    expect(result.signatureValid).toBe(true);
    expect(result.withinValidity).toBe(true);
    expect(result.payload?.appName).toBe('Test App');
    expect(rows[0]!.status).toBe('active');
    expect(seeded.appId).toBeTruthy();
  });

  it('records the issuance as an append-only event', async () => {
    const seeded = await approvedAssessment();
    await acceptLicence(owner);
    const client = await pool.connect();
    let issued;
    try {
      const candidate = (await findIssuanceCandidates(client)).find(
        (c) => c.appId === seeded.appId,
      );
      issued = await issueBadgeFor(client, candidate!, key);
    } finally {
      client.release();
    }

    const { rows } = await db.query(
      `select event_type from public.badge_events where badge_id = $1`,
      [issued.badgeId],
    );
    expect(rows.map((row) => row.event_type)).toEqual(['issued']);
  });

  it('gives a continuous plan a shorter validity than a one-off', async () => {
    await approvedAssessment();
    await acceptLicence(owner);
    await db.query(
      `insert into public.subscriptions (organisation_id, plan, status) values ($1, 'certified', 'active')`,
      [owner.organisationId],
    );

    const client = await pool.connect();
    try {
      const candidate = (await findIssuanceCandidates(client)).find(
        (entry) => entry.organisationId === owner.organisationId,
      );
      expect(candidate!.plan).toBe('certified');
      await issueBadgeFor(client, candidate!, key);
    } finally {
      client.release();
    }

    const { rows } = await db.query<{ months: string }>(
      `select round(extract(epoch from (expires_at - issued_at)) / 2629800) as months
         from public.badges where organisation_id = $1`,
      [owner.organisationId],
    );
    expect(
      Number(rows[0]!.months),
      'a maintained badge expires sooner, because monitoring maintains it',
    ).toBe(3);
  });

  it('never issues a second live badge for the same application', async () => {
    const seeded = await approvedAssessment();
    await acceptLicence(owner);
    const client = await pool.connect();
    try {
      const candidate = (await findIssuanceCandidates(client)).find(
        (c) => c.appId === seeded.appId,
      );
      await issueBadgeFor(client, candidate!, key);
      // The candidate query itself excludes an app that already has a live badge.
      const remaining = await findIssuanceCandidates(client);
      expect(remaining.some((entry) => entry.appId === seeded.appId)).toBe(false);
    } finally {
      client.release();
    }
  });
});

describe('the lifecycle sweep', () => {
  async function issueOne(): Promise<string> {
    const seeded = await approvedAssessment();
    await acceptLicence(owner);
    const client = await pool.connect();
    try {
      const candidate = (await findIssuanceCandidates(client)).find(
        (c) => c.appId === seeded.appId,
      );
      const issued = await issueBadgeFor(client, candidate!, key);
      return issued.badgeId;
    } finally {
      client.release();
    }
  }

  it('expires a badge that has passed its expiry', async () => {
    const badgeId = await issueOne();
    await db.query(
      `update public.badges set issued_at = now() - interval '12 months', expires_at = now() - interval '1 day' where id = $1`,
      [badgeId],
    );

    await sweepBadgeLifecycle(pool);

    const { rows } = await db.query('select status from public.badges where id = $1', [badgeId]);
    expect(rows[0].status).toBe('expired');
  });

  it('suspends a badge whose subscription lapsed, because monitoring is what maintains it', async () => {
    const badgeId = await issueOne();
    await db.query(
      `insert into public.subscriptions (organisation_id, plan, status) values ($1, 'certified', 'past_due')`,
      [owner.organisationId],
    );

    await sweepBadgeLifecycle(pool);

    const { rows } = await db.query(
      'select status, suspended_at from public.badges where id = $1',
      [badgeId],
    );
    expect(rows[0].status).toBe('suspended');
    expect(rows[0].suspended_at).not.toBeNull();
  });

  it('leaves a one-off purchase alone — it was bought outright, not rented', async () => {
    const badgeId = await issueOne();
    const app = await db.query('select app_id from public.badges where id = $1', [badgeId]);
    await db.query(
      `insert into public.subscriptions (organisation_id, plan, status) values ($1, 'certified', 'cancelled')`,
      [owner.organisationId],
    );
    await db.query(
      `insert into public.invoices (organisation_id, stripe_invoice_id, amount_due_cents, amount_paid_cents,
                                    currency, status, app_id, plan, issued_at, paid_at)
       values ($1, 'in_outright', 7900, 7900, 'USD', 'paid', $2, 'one_off', now(), now())`,
      [owner.organisationId, app.rows[0].app_id],
    );

    await sweepBadgeLifecycle(pool);
    const { rows } = await db.query('select status from public.badges where id = $1', [badgeId]);
    expect(rows[0].status, 'a badge bought outright is not rented').toBe('active');
  });

  it('writes every transition to the append-only event log', async () => {
    const badgeId = await issueOne();
    await db.query(
      `update public.badges set status = 'revoked', revoked_at = now(), revocation_reason = 'Material regression on re-assessment' where id = $1`,
      [badgeId],
    );

    const { rows } = await db.query(
      `select event_type, reason from public.badge_events where badge_id = $1 order by occurred_at, id`,
      [badgeId],
    );
    expect(rows.map((row) => row.event_type)).toEqual(['issued', 'revoked']);
    expect(rows[1].reason).toMatch(/Material regression/);
  });

  it('reads an expired badge as expired even if a sweep never ran', async () => {
    const badgeId = await issueOne();
    await db.query(
      `update public.badges set issued_at = now() - interval '12 months', expires_at = now() - interval '1 hour' where id = $1`,
      [badgeId],
    );
    const { rows } = await db.query(
      `select status, public.badge_effective_status(b) as effective from public.badges b where id = $1`,
      [badgeId],
    );
    expect(rows[0].status, 'the stored column is stale').toBe('active');
    expect(rows[0].effective, 'what anyone actually sees is not').toBe('expired');
  });
});

describe('what the public verification surface exposes', () => {
  it('shows a badge to anyone, with the marketing disclosure attached', async () => {
    await approvedAssessment();
    await acceptLicence(owner);
    await db.query('update public.organisations set is_marketing_client = true where id = $1', [
      owner.organisationId,
    ]);

    const client = await pool.connect();
    let issued;
    try {
      const candidate = (await findIssuanceCandidates(client)).find(
        (entry) => entry.organisationId === owner.organisationId,
      );
      issued = await issueBadgeFor(client, candidate!, key);
    } finally {
      client.release();
    }

    const anon = await pool.connect();
    try {
      await anon.query('begin read only');
      await anon.query('set local role anon');
      const { rows } = await anon.query(
        'select status, score, owner_is_marketing_client from public.badge_verification where public_id = $1',
        [issued.publicId],
      );
      expect(rows[0].owner_is_marketing_client).toBe(true);
      expect(rows[0].status).toBe('active');
    } finally {
      await anon.query('rollback').catch(() => undefined);
      anon.release();
    }
  });
});

describe('the rendered badge', () => {
  const facts = {
    appName: 'Kettle',
    rubricVersion: '1.0.0',
    assessedOn: '2026-08-22',
    verificationUrl: 'https://verify.vibefy.example/a/kettle-a1b2',
  };

  it('carries the rubric version and the assessment date in its accessible name', () => {
    const svg = renderBadgeSvg({ ...facts, status: 'active' });
    expect(svg).toContain('Rubric v1.0.0');
    expect(svg).toContain('assessed 2026-08-22');
    expect(svg).toContain('not a security guarantee');
  });

  it('never reads as verified when it is not', () => {
    for (const status of ['suspended', 'expired', 'revoked'] as const) {
      const svg = renderBadgeSvg({ ...facts, status });
      expect(svg, status).toContain('Not currently');
      expect(svg, status).not.toMatch(/aria-label="Verified by Vibefy/);
    }
  });

  it('is inert: no script, no external reference, no embedded font', () => {
    const svg = renderBadgeSvg({ ...facts, status: 'active' });
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/https?:\/\/[^"]*\.(?:css|js|woff2?|ttf)/i);
    expect(svg).not.toMatch(/<foreignObject/i);
    expect(svg).not.toMatch(/xlink:href/i);
  });

  it('escapes an application name that is trying to be markup', () => {
    const svg = renderBadgeSvg({
      ...facts,
      appName: '"><script>alert(1)</script>',
      status: 'active',
    });
    expect(svg).not.toContain('<script>alert(1)</script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('renders a generic master with no application named, for print', () => {
    const svg = renderBadgeSvg({ status: 'active' });
    expect(svg).toContain('Verified by Vibefy');
    expect(svg).not.toContain('assessed ');
  });
});
