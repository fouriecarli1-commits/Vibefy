import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { removeDeviceTokens, type TokenRemoval } from '@vibefycode/api';
import { supabase } from './supabase.ts';

/**
 * Registering this handset for alerts.
 *
 * Permission is asked for once, and a refusal is respected — the app works
 * without it, because everything a push would have told you is in the alerts
 * tab anyway. The token is stored against the signed-in user and nothing else;
 * it addresses a device, not a person.
 */
export async function registerForPush(): Promise<{ registered: boolean; reason?: string }> {
  if (!Device.isDevice) {
    return { registered: false, reason: 'Push notifications need a real device, not a simulator.' };
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') {
    return {
      registered: false,
      reason: 'Notifications are off. Alerts still appear in the app whenever you open it.',
    };
  }

  const token = await Notifications.getExpoPushTokenAsync();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { registered: false, reason: 'Sign in first.' };

  const { error } = await supabase.from('device_tokens').upsert(
    {
      user_id: user.id,
      token: token.data,
      platform: Device.osName?.toLowerCase().includes('android') ? 'android' : 'ios',
      last_seen_at: new Date().toISOString(),
      disabled_at: null,
      disabled_reason: null,
    },
    { onConflict: 'token' },
  );
  if (error) return { registered: false, reason: error.message };
  return { registered: true };
}

/**
 * Called on sign-out, and when the push toggle is turned off.
 *
 * A token left behind pushes somebody else's alerts to this phone, which is why
 * the outcome is returned rather than swallowed: on sign-out the session is gone
 * a line later and cannot be retried, and on the toggle the screen used to
 * promise the push had stopped whatever happened. `@vibefycode/api` holds the work and
 * says why it lives there.
 */
export async function unregisterPush(): Promise<TokenRemoval> {
  const token = await thisDeviceToken();
  return removeDeviceTokens(supabase, token === null ? {} : { token });
}

/**
 * This handset's registration, or null when the OS will not give one.
 *
 * Read rather than remembered: the token is the only device-shaped thing either
 * side has, and storing a copy of it would be a second answer to "which phone
 * is this" that can disagree with the first.
 */
export async function thisDeviceToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return null;
    return (await Notifications.getExpoPushTokenAsync()).data;
  } catch {
    // A revoked permission, a device with no network, an Expo outage. All of
    // them mean the same thing here — we cannot name this handset — and the
    // caller decides what to do about it. Nothing is logged because this runs
    // on somebody's phone and the answer is the log.
    return null;
  }
}

/**
 * Whether **this** handset is on the list.
 *
 * The account screen asked whether the account had any enabled token at all,
 * and drew a switch labelled "Push notifications" beside copy that says "This
 * device will receive alerts". On a second handset that switch read on before
 * the handset had ever registered, so the one person who could have fixed it
 * was shown the state of a different phone.
 *
 * A revoked OS permission reads as off, which is what it is: no push arrives,
 * whatever row is in the table.
 */
export async function pushIsOnForThisDevice(): Promise<boolean> {
  const token = await thisDeviceToken();
  if (token === null) return false;
  const { data } = await supabase
    .from('device_tokens')
    .select('id')
    .eq('token', token)
    .is('disabled_at', null)
    .limit(1);
  return (data ?? []).length > 0;
}
