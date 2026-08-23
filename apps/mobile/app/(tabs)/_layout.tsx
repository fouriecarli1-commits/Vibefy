import { useEffect, useState } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { palette } from '@/lib/theme.ts';
import { supabase } from '@/lib/supabase.ts';
import { Loading } from '@/lib/ui.tsx';

export default function TabsLayout() {
  const [session, setSession] = useState<'loading' | 'in' | 'out'>('loading');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ? 'in' : 'out'));
    const { data } = supabase.auth.onAuthStateChange((_event, next) =>
      setSession(next ? 'in' : 'out'),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === 'loading') return <Loading />;
  if (session === 'out') return <Redirect href="/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
        sceneStyle: { backgroundColor: palette.surface },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Applications' }} />
      <Tabs.Screen name="alerts" options={{ title: 'Alerts' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  );
}
