import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createVibefyCodeClient } from '@vibefycode/api';

/**
 * The phone's client.
 *
 * Anon key only, exactly as in the browser. It is public by design and
 * row-level security is the guard — a mobile build is a file anybody can
 * unzip, so anything secret in one is already leaked.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey ?? '';

if (!url || !anonKey) {
  // Loud, on first import, rather than a confusing empty screen later.
  console.warn(
    'VibefyCode: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are not set. See apps/mobile/README.md.',
  );
}

export const supabase = createVibefyCodeClient({ url, anonKey, storage: AsyncStorage });
