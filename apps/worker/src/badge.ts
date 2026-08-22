/**
 * Badge issuance, renewal and suspension.
 *
 * The signing key lives in this process and nowhere else. The console never
 * holds it: every web instance that could sign is another place the key can leak
 * from, and this is the one key whose loss ends the business.
 *
 * Issuance is a sweep, like report generation, for the same reason — three
 * separate things have to be true before a badge exists (a human approved it,
 * the rubric gate passed, the owner accepted the licence), they happen at
 * different times and in different processes, and a sweep notices when the last
 * one lands without anything having to remember to fire.
 */
import { randomBytes } from 'node:crypto';
import { loadSigningKey, signBadge, type BadgePayload, type SigningKey } from '@vibefy/badge';
import { isMonitored, type MonitoredPlan } from '@vibefy/monitoring';
import type { PoolClient } from 'pg';

/** Twelve months is the outside limit; continuous plans get less. */
const VALIDITY_MONTHS: Readonly<Record<string, number>> = {
  one_off: 12,
  certified: 3,
  agency: 3,
  organisation: 3,
};

const BADGE_LICENCE_VERSION = '1.0.0-draft';

export interface IssuanceCandidate {
  readonly assessmentId: string;
  readonly appId: string;
  readonly organisationId: string;
  readonly appName: string;
  readonly primaryUrl: string;
  readonly rubricVersion: string;
  readonly score: number;
  readonly assessedOn: string;
  readonly plan: string;
  readonly consentId: string;
  readonly isMarketingClient: boolean;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'app'}-${randomBytes(3).toString('hex')}`;
}

function originOf(url: string): string {
  return new URL(url).origin;
}

function addMonths(from: Date, months: number): Date {
  const result = new Date(from);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/**
 * Everything that must be true before a badge exists, expressed as one query.
 *
 * Each clause is a rule we sell: a human approved it, the rubric gate passed,
 * the owner accepted the current Badge Licence, and no badge is already live for
 * this application.
 */
export async function findIssuanceCandidates(
  client: PoolClient,
  limit = 20,
): Promise<IssuanceCandidate[]> {
  const { rows } = await client.query<{
    assessment_id: string;
    app_id: string;
    organisation_id: string;
    app_name: string;
    primary_url: string;
    rubric_version: string;
    overall_score: string;
    assessed_on: string;
    plan: string | null;
    consent_id: string;
    is_marketing_client: boolean;
  }>(
    `select a.id            as assessment_id,
            a.app_id,
            a.organisation_id,
            app.name        as app_name,
            app.primary_url,
            a.rubric_version,
            a.overall_score,
            coalesce(a.completed_at, a.created_at)::date::text as assessed_on,
            sub.plan::text  as plan,
            c.id            as consent_id,
            o.is_marketing_client
       from public.assessments a
       join public.apps app on app.id = a.app_id
       join public.organisations o on o.id = a.organisation_id
       -- The licence acceptance, at the version currently in force.
       join lateral (
         select c.id from public.consents c
          where c.organisation_id = a.organisation_id
            and c.document_type = 'badge_licence'
            and c.document_version = $2
            and c.action = 'accepted'
          order by c.occurred_at desc
          limit 1
       ) c on true
       left join lateral (
         select s.plan from public.subscriptions s
          where s.organisation_id = a.organisation_id
            and s.status in ('active', 'trialing')
          limit 1
       ) sub on true
      where a.status = 'approved'
        and a.certification_eligible
        and a.overall_score is not null
        -- The app id, not the assessment id: a badge must not issue for an
        -- application whose authorisation has since been withdrawn.
        and public.app_is_authorised_for_testing(a.app_id)
        and not exists (
          select 1 from public.badges b
           where b.app_id = a.app_id and b.status in ('active', 'suspended')
        )
      order by a.reviewed_at
      limit $1`,
    [limit, BADGE_LICENCE_VERSION],
  );

  return rows
    .filter((row) => Boolean(row.primary_url))
    .map((row) => ({
      assessmentId: row.assessment_id,
      appId: row.app_id,
      organisationId: row.organisation_id,
      appName: row.app_name,
      primaryUrl: row.primary_url,
      rubricVersion: row.rubric_version,
      score: Number(row.overall_score),
      assessedOn: row.assessed_on,
      plan: row.plan ?? 'one_off',
      consentId: row.consent_id,
      isMarketingClient: row.is_marketing_client,
    }));
}

export async function issueBadgeFor(
  client: PoolClient,
  candidate: IssuanceCandidate,
  key: SigningKey,
  now: Date = new Date(),
): Promise<{ badgeId: string; slug: string; publicId: string }> {
  const publicId = randomBytes(16).toString('base64url');
  const slug = slugify(candidate.appName);
  const months = VALIDITY_MONTHS[candidate.plan] ?? 12;
  const expiresAt = addMonths(now, months);

  const payload: BadgePayload = {
    v: 1,
    kid: key.kid,
    badgeId: publicId,
    slug,
    appName: candidate.appName,
    certifiedOrigin: originOf(candidate.primaryUrl),
    rubricVersion: candidate.rubricVersion,
    score: Number(candidate.score.toFixed(1)),
    assessedOn: candidate.assessedOn,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ownerIsMarketingClient: candidate.isMarketingClient,
  };

  const signed = signBadge(payload, key);

  const { rows } = await client.query<{ id: string }>(
    `insert into public.badges
       (app_id, organisation_id, assessment_id, slug, public_id, status, rubric_version, score,
        assessed_at, certified_origin, payload, signature, signing_key_id, licence_consent_id,
        issued_at, expires_at)
     values ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     returning id`,
    [
      candidate.appId,
      candidate.organisationId,
      candidate.assessmentId,
      slug,
      publicId,
      candidate.rubricVersion,
      payload.score,
      candidate.assessedOn,
      payload.certifiedOrigin,
      JSON.stringify(payload),
      signed.signature,
      key.kid,
      candidate.consentId,
      payload.issuedAt,
      payload.expiresAt,
    ],
  );

  // A badge on a continuous plan is a maintained claim, so monitoring starts the
  // moment it is issued rather than when someone remembers to switch it on. A
  // one-off badge is a photograph and is not monitored — it expires instead.
  if (isMonitored(candidate.plan as MonitoredPlan)) {
    await client.query('update public.apps set monitoring_enabled = true where id = $1', [
      candidate.appId,
    ]);
  }

  return { badgeId: rows[0]!.id, slug, publicId };
}

export async function sweepBadgeIssuance(
  pool: { connect(): Promise<PoolClient> },
  log: (message: string, detail?: Record<string, unknown>) => void = () => undefined,
): Promise<number> {
  const key = loadSigningKey();
  if (!key) {
    // Not an error. A deployment that only serves and verifies badges should not
    // hold a signing key, and saying so once is more useful than failing loudly
    // every thirty seconds.
    return 0;
  }

  const client = await pool.connect();
  try {
    const candidates = await findIssuanceCandidates(client);
    let issued = 0;
    for (const candidate of candidates) {
      try {
        const result = await issueBadgeFor(client, candidate, key);
        issued += 1;
        log('badge issued', { badgeId: result.badgeId, slug: result.slug, appId: candidate.appId });
      } catch (error) {
        log('badge issuance failed', {
          appId: candidate.appId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return issued;
  } finally {
    client.release();
  }
}

/**
 * Suspends and expires badges that should no longer read as verified.
 *
 * PART 3.4 lists the triggers: a lapsed subscription, a material regression, the
 * application going dark, an ownership change, a licence breach. Two of those —
 * lapse and expiry — are facts already in the database and are applied here.
 * The others arrive as events and are applied where they happen.
 *
 * Expiry is belt and braces: `badge_effective_status` already reports an expired
 * badge as expired whatever the column says, so a missed sweep cannot leave a
 * stale mark reading as active on someone else's website.
 */
export async function sweepBadgeLifecycle(
  pool: { connect(): Promise<PoolClient> },
  log: (message: string, detail?: Record<string, unknown>) => void = () => undefined,
): Promise<{ expired: number; suspended: number }> {
  const client = await pool.connect();
  try {
    const expired = await client.query(
      `update public.badges
          set status = 'expired'
        where status = 'active' and expires_at <= now()
        returning id`,
    );

    // A badge on a continuous plan is maintained by that plan. When it lapses the
    // monitoring stops, and a badge whose monitoring has stopped is a stale stamp.
    const suspended = await client.query(
      `update public.badges b
          set status = 'suspended', suspended_at = now(),
              suspension_reason = 'The subscription that maintains this verification is no longer active, so monitoring has stopped.'
        where b.status = 'active'
          and exists (
            select 1 from public.subscriptions s
             where s.organisation_id = b.organisation_id
               and s.status in ('past_due', 'cancelled', 'paused')
          )
          and not exists (
            select 1 from public.subscriptions s
             where s.organisation_id = b.organisation_id
               and s.status in ('active', 'trialing')
          )
          and not exists (
            select 1 from public.invoices i
             where i.app_id = b.app_id and i.status = 'paid'
               and i.amount_paid_cents > i.amount_refunded_cents
          )
        returning id`,
    );

    if (expired.rowCount || suspended.rowCount) {
      log('badge lifecycle applied', { expired: expired.rowCount, suspended: suspended.rowCount });
    }
    return { expired: expired.rowCount ?? 0, suspended: suspended.rowCount ?? 0 };
  } finally {
    client.release();
  }
}

export { BADGE_LICENCE_VERSION };
