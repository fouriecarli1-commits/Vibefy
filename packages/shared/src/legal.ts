/**
 * The scope-and-limitations language, in one place.
 *
 * This text must appear in the Terms of Service, in every report, and on every
 * verification page — above the fold, not in a footer. "Verified by VibefyCode" is
 * defensible only because the verification page defines precisely what was
 * verified; the mark is a pointer and this block is the substance.
 *
 * Callers freeze the rendered string into the row they generate (reports.scope_statement,
 * badges.payload) so that a later edit here can never change what a customer was told.
 */

export const RUBRIC_SCOPE_STATEMENT_VERSION = '1.0.0';

export interface ScopeStatementFacts {
  readonly appName: string;
  readonly rubricVersion: string;
  readonly assessedOn: string;
}

export function scopeStatement({
  appName,
  rubricVersion,
  assessedOn,
}: ScopeStatementFacts): string {
  return [
    `This assessment is a point-in-time, scope-limited, AI-assisted and human-reviewed evaluation of ${appName}, conducted by VibefyCode against published VibefyCode Rubric version ${rubricVersion} on ${assessedOn}.`,
    `"Verified by VibefyCode" means only that the application was assessed against that rubric and met the published threshold on that date.`,
    `It is not a penetration test, a security audit, a code audit, a legal or regulatory compliance certification, or a guarantee of any kind.`,
    `It does not certify that the application is secure, error-free, lawful, or fit for any particular purpose.`,
    `Findings are limited to what was observable within the authorised scope using the methods described in the methodology document.`,
    `Absence of a finding is not evidence of absence of a defect.`,
  ].join(' ');
}

/** Printed on every exported PDF. Reports are for the customer, and for nobody else. */
export const NON_RELIANCE_LEGEND =
  'This report is prepared for the named customer only. No third party — including investors, acquirers, insurers or end users — may rely on it for any purpose. VibefyCode accepts no duty of care to any person other than the named customer.';

export const AI_DISCLOSURE =
  'This assessment was produced with AI assistance and reviewed by a human before publication. AI output may contain errors; the appeals process exists for that reason.';

/**
 * The `alt` text every badge must carry. The mark never travels without stating
 * what it does and does not mean.
 */
export function badgeAltText(facts: ScopeStatementFacts): string {
  return `Verified by VibefyCode — ${facts.appName}, Rubric v${facts.rubricVersion}, assessed ${facts.assessedOn}. Scope-limited assessment, not a security guarantee.`;
}

/**
 * Permitted ways to describe the mark. Anything outside this list is an
 * extension of the certification mark and is rejected by tools/copy-lint.mjs.
 */
export const PERMITTED_MARK_PHRASES = [
  'Verified by VibefyCode',
  'VibefyCode-assessed',
  'VibefyCode Rubric v1.0.0 — score X/100',
] as const;

/**
 * The paid-relationship disclosure.
 *
 * PART 8.1 requires it wherever a rating is displayed — the verification page,
 * the directory listing, and anywhere else a score appears. It lives here, as
 * one constant, because two surfaces wording the same disclosure differently is
 * how the softer wording ends up in the place people actually look.
 */
/**
 * The remediation disclosure.
 *
 * A rating service that also sells repairs has a financial interest in finding
 * faults. That is not an accusation, it is arithmetic — and it is the objection
 * every sceptic will raise, correctly, the moment the service exists.
 *
 * It cannot be answered by promising restraint. It is answered by the score
 * being unreachable from the commercial side (asserted in
 * `tests/independence.test.ts` and `tests/remediation-wall.test.ts`), by the
 * person who did the work being barred from approving the assessment, and by
 * saying so on the face of the result rather than in a policy nobody opens.
 */
export const REMEDIATION_CLIENT_DISCLOSURE =
  'VibefyCode was paid to help fix this application. That work had no part in this assessment: the score is produced by the published rubric from evidence, no one who worked on the application may review it, and there is no path by which any payment can change a finding or a score.';

export const MARKETING_CLIENT_DISCLOSURE =
  'This application’s owner is also a client of our marketing services. That relationship had no part in this assessment: the score is produced by the published rubric from evidence, reviewed by a person, and there is no path by which any payment can change it.';
