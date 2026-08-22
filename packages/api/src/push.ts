/**
 * Push notifications.
 *
 * Expo's push service takes a batch of messages and returns a ticket per
 * message. This module builds the batch and interprets the result; it does not
 * decide *what* is worth pushing — that is `@vibefy/monitoring`'s job, and the
 * separation matters because a notification is the most intrusive thing this
 * product does to somebody's day.
 *
 * Only `warning` and `critical` alerts are pushed. An informational one is
 * waiting in the app when they open it, which is the correct amount of urgency
 * for "your score went up".
 */
export const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
export const EXPO_PUSH_BATCH_SIZE = 100;

export type PushableSeverity = 'warning' | 'critical';

export interface PushRecipient {
  readonly deviceTokenId: string;
  readonly token: string;
}

export interface PushableAlert {
  readonly alertId: string;
  readonly appId: string | null;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly title: string;
  readonly body: string;
}

export function isPushable(alert: Pick<PushableAlert, 'severity'>): boolean {
  return alert.severity === 'warning' || alert.severity === 'critical';
}

export interface ExpoMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly priority: 'default' | 'high';
  readonly data: { readonly alertId: string; readonly appId: string | null };
}

/** Expo truncates long bodies itself; doing it here keeps what we send predictable. */
function trim(text: string, limit: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= limit ? single : `${single.slice(0, limit - 1)}…`;
}

export function buildMessage(alert: PushableAlert, recipient: PushRecipient): ExpoMessage {
  return {
    to: recipient.token,
    title: trim(alert.title, 100),
    body: trim(alert.body, 240),
    priority: alert.severity === 'critical' ? 'high' : 'default',
    data: { alertId: alert.alertId, appId: alert.appId },
  };
}

export function batch<T>(items: readonly T[], size = EXPO_PUSH_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export interface PushTicket {
  readonly status: 'ok' | 'error';
  readonly id?: string;
  readonly message?: string;
  readonly details?: { readonly error?: string };
}

export interface DeliveryOutcome {
  readonly delivered: boolean;
  readonly detail: string | null;
  /** True when the token is dead and should stop being used. */
  readonly disableToken: boolean;
  readonly disableReason: string | null;
}

/**
 * What a ticket means for us.
 *
 * `DeviceNotRegistered` is the one that matters: the app was uninstalled, and a
 * sender that keeps pushing to dead tokens gets rate-limited, deservedly.
 */
export function interpretTicket(ticket: PushTicket | undefined): DeliveryOutcome {
  if (!ticket) {
    return {
      delivered: false,
      detail: 'No ticket returned for this message.',
      disableToken: false,
      disableReason: null,
    };
  }
  if (ticket.status === 'ok') {
    return { delivered: true, detail: null, disableToken: false, disableReason: null };
  }
  const error = ticket.details?.error ?? 'unknown';
  const dead = error === 'DeviceNotRegistered';
  return {
    delivered: false,
    detail: ticket.message ?? error,
    disableToken: dead,
    disableReason: dead ? 'Expo reported this device as no longer registered.' : null,
  };
}

export type PushSender = (messages: readonly ExpoMessage[]) => Promise<PushTicket[]>;

/** The real sender. Injected everywhere else so tests never reach a network. */
export const expoPushSender: PushSender = async (messages) => {
  const response = await fetch(EXPO_PUSH_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!response.ok) {
    throw new Error(`Expo push service returned ${response.status}.`);
  }
  const payload = (await response.json()) as { data?: PushTicket[] };
  return payload.data ?? [];
};
