import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { listApps, type AppSummary } from '@vibefycode/api';
import { supabase } from '@/lib/supabase.ts';
import { palette, scoreColour, spacing } from '@/lib/theme.ts';
import { Button, Empty, Loading, styles } from '@/lib/ui.tsx';

const BADGE_LABEL: Record<string, string> = {
  active: 'Badge live',
  suspended: 'Badge suspended',
  expired: 'Badge expired',
  revoked: 'Badge revoked',
};

/**
 * Everything you own, newest state first.
 *
 * Reloaded whenever the screen comes into focus rather than cached. A phone
 * showing a score from last week — after the badge behind it was suspended — is
 * the one thing this app must not do.
 */
export default function ApplicationsScreen() {
  const router = useRouter();
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setApps(await listApps(supabase));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (apps === null && !error) return <Loading />;

  return (
    <View style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.content}
        data={apps ?? []}
        keyExtractor={(item) => item.appId}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={palette.accent}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.sm }}>
            {error && <Text style={styles.error}>{error}</Text>}
            <Button label="Add an application" onPress={() => router.push('/submit')} />
          </View>
        }
        ListEmptyComponent={
          <Empty
            title="Nothing here yet"
            body="Add an application to get started. Ownership verification happens in the console on a computer — it is a warranty, and a phone is the wrong place to give one."
          />
        }
        renderItem={({ item }) => (
          <Link href={`/application/${item.appId}`} asChild>
            <View accessibilityRole="button" style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.h2}>{item.name}</Text>
                <Text style={[styles.score, { color: scoreColour(item.latestScore) }]}>
                  {item.latestScore === null ? '—' : item.latestScore.toFixed(1)}
                </Text>
              </View>
              <Text style={styles.muted}>{item.primaryUrl}</Text>
              <Text style={styles.muted}>
                {item.assessedOn ? `Assessed ${item.assessedOn}` : 'Not assessed yet'}
                {item.badgeStatus ? ` · ${BADGE_LABEL[item.badgeStatus] ?? item.badgeStatus}` : ''}
                {item.monitoringEnabled ? ' · monitored' : ''}
              </Text>
              {item.unreadAlerts > 0 && (
                <Text style={{ color: palette.warning, fontSize: 14 }}>
                  {item.unreadAlerts} unread {item.unreadAlerts === 1 ? 'alert' : 'alerts'}
                </Text>
              )}
            </View>
          </Link>
        )}
      />
    </View>
  );
}
