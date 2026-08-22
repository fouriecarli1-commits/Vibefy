import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { palette } from '@/lib/theme.ts';
import { supabase } from '@/lib/supabase.ts';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

/**
 * The shell.
 *
 * The session is the only global state the app keeps. Everything else is read
 * from the database on the screen that needs it — a phone that caches an
 * assessment is a phone that can show a score after the badge behind it was
 * suspended.
 */
export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(() => setReady(true));
    const { data } = supabase.auth.onAuthStateChange(() => setReady(true));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.surface },
          headerTintColor: palette.text,
          contentStyle: { backgroundColor: palette.surface },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
        <Stack.Screen name="submit" options={{ title: 'Add an application' }} />
        <Stack.Screen name="application/[id]" options={{ title: 'Application' }} />
        <Stack.Screen name="report/[assessmentId]" options={{ title: 'Report' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
