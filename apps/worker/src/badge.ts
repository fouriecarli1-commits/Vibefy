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
import { loadSigningKey, signBadge, type BadgePayload, type SigningKey } from '@vibefycode/badge';
import {
  badgeIssuedAlert,
  badgeSuspendedAlert,
  isMonitored,
  type MonitoredPlan,
} from '@vibefycode/monitoring';
import { badgeEmbedSnippet } from '@vibefycode/shared';
import { raiseAlert } from './monitoring.ts';
import registry from '../../../legal/registry.json' with { type: 'json' };
import type { PoolClient } from 'pg';

/**
 * How long a badge lasts, by plan. Twelve months is the outside limit; a
 * continuous plan gets less, because it is re-checked.
 *
 * `free` is here at zero rather than absent, and the difference matters. A
 * missing entry used to fall through to twelve months — the longest term we
 * offer — so the plan we know least about got the most generous answer. A new
 * tier added to the enum and forgotten here would have issued year-long badges
 * and nothing would have said a word. `tests/badge-issuance.test.ts` asks
 * `pg_enum` for every plan tier and insists this map has an answer for each.
 */
export const VALIDITY_MONTHS: Readonly<Record<string, number>> = {
  free: 0,
  one_off: 12,
  certified: 3,
  agency: 3,
  organisation: 3,
};

/**
 * The version of the Badge Licence currently in force.
 *
 * Read from the generated legal registry rather than hardcoded, because the two
 * drifting apart is a silent failure with an expensive shape: bump the document
 * and forget the constant, and badge issuance stops finding any accepted licence
 * — no error, just an empty candidate list for ever.
 *
 * A version bump is *meant* to stop issuance until people re-accept. It is not
 * meant to do so by accident.
 */
const BADGE_LICENCE_VERSION: string = (
  registry as { documents: Record<string, { version: string }> }
).documents['badge-licence.md']!.version;

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
 * the owner accepted the current Badge Licence, somebody paid for it, and no
 * badge is already live for this application.
 *
 * Every one of them is asked in SQL, and the reason is the page. This reads a
 * limited number of rows ordered oldest-review-first, so a row that is fetched
 * and then discarded in code is not merely wasted — it is fetched and discarded
 * *again on the next sweep*, for ever, because nothing about it ever changes.
 * A handful of those sit at the front of the window and quietly eat the budget;
 * twenty of them stop badge issuance completely, for every customer, with
 * nothing in the log to say so.
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
            -- The free tier is not a plan that carries a badge. The pricing page
            -- says so in as many words — "a free assessment never leads to one,
            -- at any score" — and until this clause existed nothing but that
            -- sentence stood behind it.
            and s.plan <> 'free'
          -- A tiebreak that should never be needed: subscriptions_one_live_per_org
          -- is unique over every live status, so there is at most one row to
          -- pick. It is written down anyway because this decides how long a
          -- badge lasts, and a limit 1 with no order is a coin toss waiting for
          -- the day that index is relaxed.
          order by case s.status when 'active' then 0 else 1 end
          limit 1
       ) sub on true
      where a.status = 'approved'
        and a.certification_eligible
        and a.overall_score is not null
        -- A badge asserts a certified origin, so an application with no URL
        -- cannot carry one. Repositories and mobile builds are allowed to have
        -- no primary_url by constraint, which is why this is a real row and
        -- not a defensive nicety — and why it belongs here rather than in a
        -- filter after the limit, where it would jam the window for ever.
        and app.primary_url is not null
        -- The app id, not the assessment id: a badge must not issue for an
        -- application whose authorisation has since been withdrawn.
        and public.app_is_authorised_for_testing(a.app_id)
        -- The free tier does not carry a badge. The lateral above declines to
        -- pick a free plan, so this says: either a plan that is not free is in
        -- force, or no subscription is in force at all — which is what a one-off
        -- purchase looks like from here and is left exactly as it was.
        --
        -- Deliberately not a fourth gate. Whether an organisation with no
        -- subscription and no paid invoice should be issued a badge is a
        -- question about what we sell, not a defect, and it is recorded in
        -- docs/OPEN_ITEMS.md rather than decided here.
        and (
          sub.plan is not null
          or not exists (
            select 1 from public.subscriptions s
             where s.organisation_id = a.organisation_id
               and s.status in ('active', 'trialing')
          )
        )
        and not exists (
          select 1 from public.badges b
           where b.app_id = a.app_id and b.status in ('active', 'suspended')
        )
      order by a.reviewed_at
      limit $1`,
    [limit, BADGE_LICENCE_VERSION],
  );

  return rows.map((row) => ({
    assessmentId: row.assessment_id,
    appId: row.app_id,
    organisationId: row.organisation_id,
    appName: row.app_name,
    primaryUrl: row.primary_url,
    rubricVersion: row.rubric_version,
    score: Number(row.overall_score),
    assessedOn: row.assessed_on,
    // No subscription but a paid invoice for this application is what a one-off
    // purchase looks like: a photograph, twelve months, not monitored.
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
  const months = VALIDITY_MONTHS[candidate.plan];
  // Refusing beats guessing. A plan this file has never heard of is a plan
  // whose terms nobody has decided, and the old fallback decided them in the
  // customer's favour by twelve months at a time, silently.
  if (months === undefined || months <= 0) {
    throw new Error(
      `No badge validity is defined for the plan "${candidate.plan}", so no badge was issued.`,
    );
  }
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

/**
 * The verification origin, as the customer will see it in their own footer.
 *
 * Falls back to the site URL, and then to nothing — an alert carrying a relative
 * path is less useful than one that says plainly it could not build the link.
 */
function verifyOrigin(): string {
  return (process.env.NEXT_PUBLIC_VERIFY_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(
    /\/+$/,
    '',
  );
}

async function announceIssuedBadge(
  client: PoolClient,
  candidate: IssuanceCandidate,
  result: { badgeId: string; slug: string; publicId: string },
  log: (message: string, detail?: Record<string, unknown>) => void,
): Promise<void> {
  const origin = verifyOrigin();
  if (!origin.startsWith('https://')) {
    // `badgeEmbedSnippet` refuses to build a snippet against a non-HTTPS origin,
    // which is correct and would throw here. Saying so once beats a stack trace
    // every thirty seconds on a deployment whose URL is not configured yet.
    log('badge issued but not announced — no HTTPS verification origin configured', {
      badgeId: result.badgeId,
      needs: 'NEXT_PUBLIC_VERIFY_URL or NEXT_PUBLIC_SITE_URL',
    });
    return;
  }

  const { rows } = await client.query<{ expires_at: string }>(
    'select expires_at from public.badges where id = $1',
    [result.badgeId],
  );
  const expiresAt = rows[0]?.expires_at;
  if (!expiresAt) {
    // The badge was written a moment ago on this same connection, so this is
    // unreachable — which is exactly why it gets a line rather than a bare
    // return. An unreachable branch that is silently reached is the worst
    // possible combination.
    log('badge issued but its expiry could not be read back, so it was not announced', {
      badgeId: result.badgeId,
    });
    return;
  }

  const draft = badgeIssuedAlert({
    appName: candidate.appName,
    appId: candidate.appId,
    badgeId: result.badgeId,
    score: candidate.score,
    rubricVersion: candidate.rubricVersion,
    expiresAt: new Date(expiresAt),
    verificationUrl: `${origin}/a/${result.slug}`,
    embedSnippet: badgeEmbedSnippet({
      appName: candidate.appName,
      rubricVersion: candidate.rubricVersion,
      assessedOn: candidate.assessedOn,
      verifyOrigin: origin,
      publicId: result.publicId,
      slug: result.slug,
    }),
  });

  await raiseAlert(client, candidate.organisationId, draft);
}

/**
 * Whether the missing-key notice has already been given.
 *
 * Module scope on purpose: the sweep is called afresh every thirty seconds, so
 * anything narrower would say it every thirty seconds and thereby say nothing.
 * Reset when a key appears, so the notice returns if the key goes away again.
 */
let saidTheKeyIsMissing = false;

export async function sweepBadgeIssuance(
  pool: { connect(): Promise<PoolClient> },
  log: (message: string, detail?: Record<string, unknown>) => void = () => undefined,
): Promise<number> {
  const key = loadSigningKey();
  if (!key) {
    // Not an error. A deployment that only serves and verifies badges should not
    // hold a signing key. But it is not nothing either: on the deployment that
    // is *supposed* to sign, this is every paying customer's badge silently not
    // arriving, for as long as nobody notices. So it is said — once, because
    // this runs every thirty seconds and a line every thirty seconds is a line
    // nobody reads.
    if (!saidTheKeyIsMissing) {
      saidTheKeyIsMissing = true;
      log('no badge signing key in this process, so no badge can be issued here', {
        needs: 'VIBEFYCODE_BADGE_SIGNING_KEY_B64 and VIBEFYCODE_BADGE_KEY_ID',
        expected: 'only on a deployment that does not issue badges',
      });
    }
    return 0;
  }
  saidTheKeyIsMissing = false;

  const client = await pool.connect();
  try {
    const candidates = await findIssuanceCandidates(client);
    let issued = 0;
    for (const candidate of candidates) {
      try {
        const result = await issueBadgeFor(client, candidate, key);
        issued += 1;
        log('badge issued', { badgeId: result.badgeId, slug: result.slug, appId: candidate.appId });

        // Tell them. `badge_suspended` and `badge_expiring` existed from the
        // start and nothing marked the moment the badge arrived, so the customer
        // found out by going to look — silence on the one event they paid for.
        //
        // Raised here rather than in a sweep of its own: the alert and the badge
        // are written on the same connection, so a badge cannot exist without
        // its notice having been attempted. If the alert itself fails, the badge
        // still stands; a notification is not worth undoing an issuance for.
        await announceIssuedBadge(client, candidate, result, log);
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
/**
 * Why a badge went down when the subscription that maintained it stopped.
 *
 * One constant, used as the column value and as the alert's wording, so the
 * customer reads in their inbox exactly what the verification page shows a
 * stranger. Two sentences that drift apart is a support conversation nobody
 * can win.
 */
const LAPSED_SUSPENSION_REASON =
  'The subscription that maintains this verification is no longer active, so monitoring has stopped.';

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
    const suspended = await client.query<{
      id: string;
      app_id: string;
      organisation_id: string;
      name: string;
    }>(
      `update public.badges b
          set status = 'suspended', suspended_at = now(),
              suspension_reason = $1
         from public.apps app
        where app.id = b.app_id
          and b.status = 'active'
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
        returning b.id, b.app_id, b.organisation_id, app.name`,
      [LAPSED_SUSPENSION_REASON],
    );

    // The same event from a liveness failure raises `badge_suspended`; this one
    // raised nothing. A customer's mark came down on their own website — which
    // the licence obliges them to then remove — and the only way to find out was
    // to open the console and look. The alert is deduplicated per badge, so a
    // sweep that runs every thirty seconds still writes exactly one.
    for (const row of suspended.rows) {
      try {
        await raiseAlert(
          client,
          row.organisation_id,
          badgeSuspendedAlert(row.name, row.app_id, row.id, LAPSED_SUSPENSION_REASON),
        );
      } catch (error) {
        log('lapse suspension raised no notice', {
          badgeId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (expired.rowCount || suspended.rowCount) {
      log('badge lifecycle applied', { expired: expired.rowCount, suspended: suspended.rowCount });
    }
    return { expired: expired.rowCount ?? 0, suspended: suspended.rowCount ?? 0 };
  } finally {
    client.release();
  }
}

export { BADGE_LICENCE_VERSION };
