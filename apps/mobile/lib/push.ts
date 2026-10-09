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
  return removeDeviceTokens(supabase);
}
