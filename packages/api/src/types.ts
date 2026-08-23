/**
 * The read surface the mobile app and the console share.
 *
 * These types are what a *client* sees, which is a narrower thing than what the
 * database holds. They are declared here rather than generated from the schema
 * on purpose: a generated type widens the moment somebody adds a column, and a
 * mobile app that silently starts receiving a new field is a mobile app that can
 * silently start displaying one.
 */

export type BadgeStatus = 'active' | 'suspended' | 'expired' | 'revoked';
export type AuthorisationStatus = 'pending' | 'verified' | 'revoked' | 'expired';

export interface AppSummary {
  readonly appId: string;
  readonly organisationId: string;
  readonly name: string;
  readonly primaryUrl: string | null;
  readonly latestScore: number | null;
  readonly latestAssessmentId: string | null;
  readonly assessedOn: string | null;
  readonly certificationEligible: boolean;
  readonly badgeStatus: BadgeStatus | null;
  readonly badgeExpiresAt: string | null;
  readonly authorisationStatus: AuthorisationStatus | null;
  readonly monitoringEnabled: boolean;
  readonly unreadAlerts: number;
}

export interface AssessmentSummary {
  readonly assessmentId: string;
  readonly status: string;
  readonly score: number | null;
  readonly rubricVersion: string;
  readonly assessedOn: string;
  readonly scoreDelta: number | null;
  readonly materialRegression: boolean;
}

export interface AlertSummary {
  readonly alertId: string;
  readonly appId: string | null;
  readonly kind: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly title: string;
  readonly body: string;
  readonly assessmentId: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface RequestSummary {
  readonly requestId: string;
  readonly status: string;
  readonly depth: string;
  readonly refusalMessage: string | null;
  readonly createdAt: string;
  readonly assessmentId: string | null;
}

/** What the mobile app is allowed to do. Deliberately short. */
export interface MobileCapabilities {
  readonly canSubmitApplication: true;
  readonly canTrackProgress: true;
  readonly canReadReports: true;
  readonly canReceiveAlerts: true;
  readonly canApproveReTest: true;
  /**
   * Ownership verification, badge licence acceptance, billing and workspace
   * administration are console-only. Each of them is a decision with a legal or
   * financial consequence, and a phone screen is the wrong place to take one —
   * the brief says read-and-monitor first, and this is where that is written down.
   */
  readonly canVerifyOwnership: false;
  readonly canAcceptBadgeLicence: false;
  readonly canManageBilling: false;
  readonly canManageWorkspace: false;
}

export const MOBILE_CAPABILITIES: MobileCapabilities = {
  canSubmitApplication: true,
  canTrackProgress: true,
  canReadReports: true,
  canReceiveAlerts: true,
  canApproveReTest: true,
  canVerifyOwnership: false,
  canAcceptBadgeLicence: false,
  canManageBilling: false,
  canManageWorkspace: false,
};
