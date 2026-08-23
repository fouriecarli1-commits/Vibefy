/**
 * Resend, over its HTTP API.
 *
 * No SDK: the request is one POST with a JSON body, and a dependency that wraps
 * that is a dependency with a supply chain. `DATA_MAP.md` records Resend or
 * Postmark as the sub-processor; swapping is a new file implementing the same
 * interface, and nothing above it changes.
 *
 * The API key never leaves this module and never reaches the browser or the
 * phone — email is sent by the worker only.
 */
import type { EmailMessage, EmailProvider, SendResult } from './provider.ts';

const ENDPOINT = 'https://api.resend.com/emails';

/**
 * Resend reports a bad address at send time for some failures and by webhook for
 * the rest. These are the ones it tells us about immediately.
 */
function classify(status: number, body: string): SendResult {
  if (status === 422 && /invalid.*(email|recipient)/i.test(body)) {
    return { sent: false, kind: 'hard_bounce', detail: body.slice(0, 300) };
  }
  if (status === 429 || status >= 500) {
    return { sent: false, kind: 'provider_error', detail: `${status}: ${body.slice(0, 200)}` };
  }
  return { sent: false, kind: 'refused', detail: `${status}: ${body.slice(0, 300)}` };
}

export interface ResendOptions {
  readonly apiKey: string;
  /** Must be a domain with SPF, DKIM and DMARC in place — see the runbook. */
  readonly from: string;
  readonly replyTo?: string;
  readonly fetchImpl?: typeof fetch;
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(private readonly options: ResendOptions) {}

  async send(message: EmailMessage): Promise<SendResult> {
    const send = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await send(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(this.options.replyTo ? { reply_to: this.options.replyTo } : {}),
          ...(message.headers ? { headers: message.headers } : {}),
        }),
      });
    } catch (error) {
      // A network failure is the provider's problem, not the address's.
      return {
        sent: false,
        kind: 'provider_error',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const body = await response.text();
    if (!response.ok) return classify(response.status, body);

    let providerId: string | null = null;
    try {
      providerId = (JSON.parse(body) as { id?: string }).id ?? null;
    } catch {
      providerId = null;
    }
    return { sent: true, providerId };
  }
}

/**
 * The provider the worker uses, or null when it is not configured.
 *
 * Null rather than a throw: a deployment that runs assessments and does not send
 * email is a legitimate deployment, and it should say so once in the log rather
 * than fail a sweep every five minutes.
 */
export function resendFromEnvironment(
  env: Record<string, string | undefined> = process.env,
): EmailProvider | null {
  const apiKey = env.RESEND_API_KEY;
  const from = env.ALERT_EMAIL_FROM;
  if (!apiKey || !from) return null;
  return new ResendEmailProvider({
    apiKey,
    from,
    ...(env.ALERT_EMAIL_REPLY_TO ? { replyTo: env.ALERT_EMAIL_REPLY_TO } : {}),
  });
}
