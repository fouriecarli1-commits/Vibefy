/**
 * Turning a change into something a person reads.
 *
 * Every alert carries a `dedupeKey` and the database has a unique index on it.
 * That is the whole anti-noise design: a monitoring system that sends the same
 * warning every thirty seconds trains its recipients to ignore all of them, and
 * the one that mattered arrives in a folder nobody opens.
 *
 * The wording rules from the brief apply to every string in this file. Nothing
 * here says an application is secure, safe or approved; it says what changed and
 * what was looked at.
 */
import type { Drift } from './types.ts';
import type { MaterialityVerdict } from './regression.ts';
import type { LivenessDecision } from './liveness.ts';

export type AlertKind =
  | 'assessment_completed'
  | 'drift_detected'
  | 'material_regression'
  | 'badge_suspended'
  | 'badge_expiring'
  | 'badge_issued'
  | 'application_unreachable'
  | 'application_recovered'
  | 'subscription_problem';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertDraft {
  readonly kind: AlertKind;
  readonly severity: AlertSeverity;
  readonly title: string;
  readonly body: string;
  readonly appId: string;
  readonly assessmentId?: string | undefined;
  readonly badgeId?: string | undefined;
  readonly dedupeKey: string;
}

function day(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function movement(drift: Drift): string {
  if (drift.scoreDelta > 0) return `rose by ${drift.scoreDelta.toFixed(1)} points`;
  if (drift.scoreDelta < 0) return `fell by ${Math.abs(drift.scoreDelta).toFixed(1)} points`;
  return 'did not change';
}

/** The neutral "we looked again and here is what moved" alert. */
export function driftAlert(appName: string, appId: string, drift: Drift): AlertDraft {
  const counts = `${drift.newFindings.length} new, ${drift.resolvedFindings.length} resolved, ${drift.persistingFindings.length} unchanged`;
  const caveat = drift.comparable
    ? ''
    : ' These two assessments used different rubric versions, so part of the movement is a change in the standard rather than in the application.';
  return {
    kind: 'drift_detected',
    severity: drift.scoreDelta < 0 ? 'warning' : 'info',
    title: `${appName}: score ${movement(drift)}`,
    body:
      `A re-assessment of ${appName} finished. The overall score ${movement(drift)}, from ` +
      `${drift.scoreBefore.toFixed(1)} to ${drift.scoreAfter.toFixed(1)}. Findings: ${counts}.${caveat}`,
    appId,
    assessmentId: drift.assessmentId,
    // One per assessment: re-running the sweep must not produce a second copy.
    dedupeKey: `drift:${drift.assessmentId}`,
  };
}

export function regressionAlert(
  appName: string,
  appId: string,
  drift: Drift,
  verdict: MaterialityVerdict,
): AlertDraft {
  const reasons = verdict.reasons.map((reason) => `• ${reason.explanation}`).join('\n');
  return {
    kind: 'material_regression',
    severity: 'critical',
    title: `${appName}: material change found at re-assessment`,
    body:
      `The latest assessment of ${appName} found changes that fall outside what its ` +
      `verification covered. The reasons, in full:\n\n${reasons}\n\n` +
      `Fix the findings listed in the report and request a re-assessment; the badge is restored ` +
      `when a new assessment passes review.`,
    appId,
    assessmentId: drift.assessmentId,
    dedupeKey: `regression:${drift.assessmentId}`,
  };
}

export function badgeSuspendedAlert(
  appName: string,
  appId: string,
  badgeId: string,
  reason: string,
): AlertDraft {
  return {
    kind: 'badge_suspended',
    severity: 'critical',
    title: `${appName}: Verified by VibefyCode badge suspended`,
    body:
      `The badge for ${appName} has been suspended and its verification page now shows it as ` +
      `suspended. Reason: ${reason} Please remove the badge from your site until it is restored — ` +
      `the licence requires it.`,
    appId,
    badgeId,
    dedupeKey: `badge-suspended:${badgeId}`,
  };
}

export function unreachableAlert(
  appName: string,
  appId: string,
  decision: LivenessDecision,
  at: Date,
): AlertDraft {
  return {
    kind: 'application_unreachable',
    severity: decision.suspendBadge ? 'critical' : 'warning',
    title: `${appName}: not responding to checks`,
    body:
      `${appName} has not answered our liveness checks. ${decision.reason ?? 'The last check did not get a response.'} ` +
      `We check the certified origin only, with a single GET request, and nothing else.`,
    appId,
    // Per app per day. A site that is down for a week should produce seven
    // alerts, not two thousand.
    dedupeKey: `unreachable:${appId}:${day(at)}`,
  };
}

export function recoveredAlert(appName: string, appId: string, at: Date): AlertDraft {
  return {
    kind: 'application_recovered',
    severity: 'info',
    title: `${appName}: responding again`,
    body: `${appName} is answering our liveness checks again. Any badge suspended for unreachability has been restored.`,
    appId,
    dedupeKey: `recovered:${appId}:${day(at)}`,
  };
}

/**
 * The one piece of good news, and for its first months the only event the
 * customer was not told about.
 *
 * `badge_suspended` and `badge_expiring` existed from the start. Nothing marked
 * the moment the badge actually arrived — the moment they paid for — so they
 * found out by going to look. A product that reliably delivers its bad news and
 * stays quiet about its good news teaches people to dread hearing from it.
 *
 * The embed snippet travels in the body rather than as a link to it. Somebody
 * reading this on a phone can forward it to whoever maintains the site, and
 * that person needs the line, not a login.
 */
export function badgeIssuedAlert(input: {
  readonly appName: string;
  readonly appId: string;
  readonly badgeId: string;
  readonly score: number;
  readonly rubricVersion: string;
  readonly expiresAt: Date;
  readonly verificationUrl: string;
  readonly embedSnippet: string;
}): AlertDraft {
  return {
    kind: 'badge_issued',
    severity: 'info',
    title: `${input.appName}: the badge is live`,
    body:
      `${input.appName} scored ${input.score.toFixed(1)} against Rubric v${input.rubricVersion} and a reviewer approved it, ` +
      `so the Verified by VibefyCode badge is now issued. It is in force until ${day(input.expiresAt)}, ` +
      `and on a continuous plan it is re-assessed before then rather than left to lapse.\n\n` +
      `Its verification page, which anybody may open: ${input.verificationUrl}\n\n` +
      `To show it, paste this where you want it to appear:\n\n${input.embedSnippet}\n\n` +
      `The image is served from VibefyCode on every load and is never copied to your server. ` +
      `That is what lets a suspension take effect within minutes, and it is why there is no file to download.`,
    appId: input.appId,
    badgeId: input.badgeId,
    // Once per badge. A badge is issued once; a duplicate here would mean the
    // issuance sweep ran twice over the same row, which is a different bug.
    dedupeKey: `badge-issued:${input.badgeId}`,
  };
}

export function badgeExpiringAlert(
  appName: string,
  appId: string,
  badgeId: string,
  expiresAt: Date,
  daysRemaining: number,
): AlertDraft {
  return {
    kind: 'badge_expiring',
    severity: daysRemaining <= 7 ? 'warning' : 'info',
    title: `${appName}: badge expires on ${day(expiresAt)}`,
    body:
      `The Verified by VibefyCode badge for ${appName} expires in ${daysRemaining} days, on ${day(expiresAt)}. ` +
      `After that its verification page reads as expired. Request a re-assessment to renew it.`,
    appId,
    badgeId,
    dedupeKey: `badge-expiring:${badgeId}:${daysRemaining <= 7 ? '7' : '30'}`,
  };
}
