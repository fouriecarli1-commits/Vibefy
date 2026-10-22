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
    // Said as ours rather than as the handset's: nothing came back about this
    // message, so nothing is known about the device. The sender refuses a short
    // reply now, and the sweep defers a batch it has no tickets for, so this is
    // the last line of defence rather than the ordinary path it used to be.
    return {
      delivered: false,
      detail:
        'The push service returned no ticket for this message, so nothing was learnt about the handset.',
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
  /*
   * A ticket for every message, or nothing.
   *
   * This read `payload.data ?? []` and handed the sweep a short array. Expo
   * answers a request-level problem — bad credentials, a malformed body, a
   * rejected request — with HTTP 200 and an `errors` array and no `data` at
   * all, so `response.ok` is true and the sweep got zero tickets for a full
   * batch. It then wrote one `alert_deliveries` row per handset saying the
   * delivery failed, and the pending query excludes any alert that has such a
   * row: a problem on our side of the request became a permanent
   * non-delivery, attributed to the customer's phone, for a notice the Badge
   * Licence obliges us to give. `errors` was discarded, so the one sentence
   * saying what was actually wrong was the one thing not kept.
   *
   * Thrown instead, which is what the sweep's own catch is for: the batch is
   * deferred and tried again, and written down with this detail if it is still
   * failing when it runs out of days.
   */
  const payload = (await response.json()) as {
    data?: PushTicket[];
    errors?: { code?: string; message?: string }[];
  };
  if (!Array.isArray(payload.data) || payload.data.length < messages.length) {
    const said = (payload.errors ?? [])
      .map((entry) => entry.message ?? entry.code ?? 'no reason given')
      .join('; ');
    throw new Error(
      `Expo push service returned ${payload.data?.length ?? 0} tickets for ` +
        `${messages.length} messages${said === '' ? '.' : `: ${said}`}`,
    );
  }
  return payload.data;
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
/**
 * A delete that can be narrowed and then awaited, which is what a filter
 * builder is. Named this way so the one call below can add a second condition
 * without a second shape for the caller to satisfy.
 */
export interface DeviceTokenDelete extends PromiseLike<{ error: { message: string } | null }> {
  eq(column: 'user_id' | 'token', value: string): DeviceTokenDelete;
}

/** The slice of the client this needs. Structural, so the real one satisfies it. */
export interface DeviceTokenStore {
  readonly auth: {
    getUser(): PromiseLike<{ data: { user: { id: string } | null } }>;
  };
  from(table: 'device_tokens'): {
    delete(): DeviceTokenDelete;
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

/**
 * One handset, when we know which one.
 *
 * This deleted every token on the account, while the screen that calls it says
 * "This device will no longer receive alerts" and this file's own comments
 * reason about "this phone" throughout. A customer with a phone and a tablet
 * who turned the switch off on the tablet stopped being pushed to on the
 * phone — including the badge suspension the Badge Licence obliges us to give
 * notice of, and which `setAlertEmailLevel` deliberately refuses to let anyone
 * switch off.
 *
 * `token` is this handset's registration, which the app can read from the OS.
 * Without it the old behaviour is what is left, and the one property worth
 * keeping is the one this function was written for: a handset that has signed
 * out must not go on receiving the previous account's alerts. So it clears the
 * account and says that is what it did, rather than quietly doing it.
 */
export async function removeDeviceTokens(
  store: DeviceTokenStore,
  options: { readonly token?: string } = {},
): Promise<TokenRemoval> {
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

  let deleting = store.from('device_tokens').delete().eq('user_id', user.id);
  if (options.token !== undefined) deleting = deleting.eq('token', options.token);
  const { error } = await deleting;
  if (error) {
    return {
      removed: false,
      reason: `The registration for this device could not be removed (${error.message}). Until it is, this handset may still receive alerts for this account.`,
    };
  }
  if (options.token === undefined) {
    return {
      removed: true,
      reason:
        'This device could not tell us which registration is its own, so alerts are now off for this account on every device. Turn them back on wherever you want them.',
    };
  }
  return { removed: true };
}
