import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
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

/** Called on sign-out. A token left behind pushes somebody else's alerts to this phone. */
export async function unregisterPush(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('device_tokens').delete().eq('user_id', user.id);
}
