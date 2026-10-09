/**
 * Push notifications.
 *
 * Expo's push service takes a batch of messages and returns a ticket per
 * message. This module builds the batch and interprets the result; it does not
 * decide *what* is worth pushing — that is `@vibefycode/monitoring`'s job, and the
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

// ---------------------------------------------------------------------------
// Taking a handset off the list
// ---------------------------------------------------------------------------

/**
 * `apps/mobile` had this as four lines inside `unregisterPush`, which returned
 * `void` and discarded the delete's `error`. That function's own docstring
 * names the harm which makes the error worth looking at — "A token left behind
 * pushes somebody else's alerts to this phone" — and nothing looked at it.
 *
 * Two consequences, measured on 2026-10-09. On sign-out the session is gone a
 * line later, so a failed delete cannot be retried and the handset keeps
 * receiving the previous account's alerts: app names, finding titles, badge
 * suspensions. And on the push toggle the screen said "This device will no
 * longer receive alerts" whatever happened — a sentence about something that
 * did not occur, told to the one person who could have fixed it.
 *
 * It lives in this package rather than in the app because this is where the
 * push domain lives and both sides already import it, and because `apps/mobile`
 * cannot be read by the test suite: `expo-device` pulls in `react-native`,
 * which is written in Flow and will not parse. The client arrives as an
 * argument and only its shape is named here, so nothing device-specific is
 * dragged along.
 */
/** The slice of the client this needs. Structural, so the real one satisfies it. */
export interface DeviceTokenStore {
  readonly auth: {
    getUser(): PromiseLike<{ data: { user: { id: string } | null } }>;
  };
  from(table: 'device_tokens'): {
    delete(): {
      eq(column: 'user_id', value: string): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

export interface TokenRemoval {
  /** True only when this handset will not be pushed to again. */
  readonly removed: boolean;
  /**
   * Why not, in words for the person holding the phone.
   *
   * They are the only one who can act: nobody else knows this handset was
   * signed out, and after a sign-out there is no session left to retry under.
   */
  readonly reason?: string;
}

export async function removeDeviceTokens(store: DeviceTokenStore): Promise<TokenRemoval> {
  const {
    data: { user },
  } = await store.auth.getUser();
  if (!user) {
    // The old code returned here as though it had succeeded. A session that has
    // already gone leaves the row behind with the previous user on it, which is
    // the state this function exists to prevent.
    return {
      removed: false,
      reason:
        'There is no longer a session on this device, so the registration could not be removed. Sign in again and turn push notifications off, or remove the app.',
    };
  }

  const { error } = await store.from('device_tokens').delete().eq('user_id', user.id);
  if (error) {
    return {
      removed: false,
      reason: `The registration for this device could not be removed (${error.message}). Until it is, this handset may still receive alerts for this account.`,
    };
  }
  return { removed: true };
}
