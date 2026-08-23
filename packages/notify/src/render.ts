/**
 * The alert email.
 *
 * Deliberately plain: a table, inline styles, no images, no web fonts, no
 * tracking pixel. Every one of those is a deliverability risk, a privacy
 * question, or both — and a notice that lands in a spam folder is not a notice.
 *
 * The wording is the same wording the console shows, from the same alert row.
 * An email that softens what the console says would be the more-read half of a
 * pair of inconsistent notices.
 */
import { NON_RELIANCE_LEGEND } from '@vibefycode/shared';
import type { EmailMessage } from './provider.ts';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertEmailInput {
  readonly alertId: string;
  readonly kind: string;
  readonly severity: AlertSeverity;
  readonly title: string;
  readonly body: string;
  readonly appName: string | null;
  readonly consoleUrl: string;
  readonly recipientEmail: string;
  /** Where the alert links, when it is about a specific thing. */
  readonly deepLink?: string | null;
}

const INK = '#16205A';
const MUTED = '#4A5578';
const LINE = '#D5DEEF';
const SURFACE = '#F4F7FC';

const TONE: Readonly<Record<AlertSeverity, string>> = {
  info: MUTED,
  warning: '#8A4B08',
  critical: '#7A1912',
};

/**
 * Subjects say what happened, not how alarmed to be.
 *
 * "Action required" on something that is not actionable is how a sender teaches
 * people to ignore the ones that are.
 */
export function subjectFor(input: Pick<AlertEmailInput, 'title'>): string {
  return input.title;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Why this arrived and how to receive less of it.
 *
 * There is no unsubscribe link because there is no list: these are notices about
 * a customer's own application under an agreement they accepted. What there is
 * instead is a control in the console, and this says where.
 */
function footerText(input: AlertEmailInput): string {
  return [
    `You are receiving this because you are a member of the workspace this application belongs to.`,
    `Choose which alerts reach you at ${input.consoleUrl}/console/privacy.`,
    `A badge suspension is a notice we are required to give, and is always sent.`,
  ].join(' ');
}

export function renderAlertEmail(input: AlertEmailInput): EmailMessage {
  const link = input.deepLink ?? `${input.consoleUrl}/console/alerts`;
  const heading = input.appName ? `${input.appName} — ${input.title}` : input.title;

  const text = [
    heading,
    '',
    input.body,
    '',
    `Open it: ${link}`,
    '',
    NON_RELIANCE_LEGEND,
    '',
    '—',
    footerText(input),
  ].join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:24px;background:${SURFACE};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid ${LINE};border-radius:12px">
    <tr><td style="padding:28px 28px 8px">
      <p style="margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${TONE[input.severity]}">${escapeHtml(input.kind.replace(/_/g, ' '))}</p>
      <h1 style="margin:0;font-size:21px;line-height:1.3">${escapeHtml(heading)}</h1>
    </td></tr>
    <tr><td style="padding:12px 28px 0">
      <p style="margin:0;font-size:15px;line-height:1.6;white-space:pre-line">${escapeHtml(input.body)}</p>
    </td></tr>
    <tr><td style="padding:24px 28px 4px">
      <a href="${escapeHtml(link)}" style="display:inline-block;background:${INK};color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px">Open it in the console</a>
    </td></tr>
    <tr><td style="padding:24px 28px 0">
      <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};border-top:1px solid ${LINE};padding-top:16px">${escapeHtml(NON_RELIANCE_LEGEND)}</p>
    </td></tr>
    <tr><td style="padding:16px 28px 28px">
      <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED}">${escapeHtml(footerText(input))}</p>
    </td></tr>
  </table>
</body></html>`;

  return {
    to: input.recipientEmail,
    subject: subjectFor(input),
    text,
    html,
    headers: {
      // Threads the notices about one application together rather than stacking
      // them as unrelated messages.
      'X-Entity-Ref-ID': input.alertId,
    },
  };
}

export interface InvitationEmailInput {
  readonly workspaceName: string;
  readonly invitedByName: string | null;
  readonly role: string;
  readonly acceptUrl: string;
  readonly expiresOn: string;
  readonly recipientEmail: string;
}

/**
 * The invitation.
 *
 * The link is the credential, so this is the only place it ever exists outside
 * the sender's screen — we store its hash and nothing else. It says who invited
 * them and to what, because an unexplained link asking someone to sign in is
 * indistinguishable from a phishing attempt, and this one has to be believed.
 */
export function renderInvitationEmail(input: InvitationEmailInput): EmailMessage {
  const by = input.invitedByName
    ? `${input.invitedByName} has`
    : 'Someone at your organisation has';
  const heading = `${by} invited you to ${input.workspaceName} on VibefyCode`;

  const text = [
    heading,
    '',
    `You have been invited as a ${input.role}. The invitation is valid until ${input.expiresOn}.`,
    '',
    `Accept it: ${input.acceptUrl}`,
    '',
    'The link works only for this address, and only once. If you were not expecting it, ignore it — nothing happens until you accept, and it expires on its own.',
    '',
    '—',
    'VibefyCode assesses applications against a published rubric. Joining a workspace lets you see the assessments of the applications in it.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:24px;background:${SURFACE};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid ${LINE};border-radius:12px">
    <tr><td style="padding:28px 28px 8px">
      <h1 style="margin:0;font-size:21px;line-height:1.35">${escapeHtml(heading)}</h1>
    </td></tr>
    <tr><td style="padding:12px 28px 0">
      <p style="margin:0;font-size:15px;line-height:1.6">You have been invited as a ${escapeHtml(input.role)}. The invitation is valid until ${escapeHtml(input.expiresOn)}.</p>
    </td></tr>
    <tr><td style="padding:24px 28px 4px">
      <a href="${escapeHtml(input.acceptUrl)}" style="display:inline-block;background:${INK};color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px">Accept the invitation</a>
    </td></tr>
    <tr><td style="padding:24px 28px 28px">
      <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};border-top:1px solid ${LINE};padding-top:16px">The link works only for this address, and only once. If you were not expecting it, ignore it — nothing happens until you accept, and it expires on its own.</p>
    </td></tr>
  </table>
</body></html>`;

  return { to: input.recipientEmail, subject: heading, text, html };
}
