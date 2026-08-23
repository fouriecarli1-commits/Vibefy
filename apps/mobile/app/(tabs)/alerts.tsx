import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { listAlerts, markAlertRead, type AlertSummary } from '@vibefycode/api';
import { supabase } from '@/lib/supabase.ts';
import { palette } from '@/lib/theme.ts';
import { Empty, Loading, styles } from '@/lib/ui.tsx';

const TONE: Record<AlertSummary['severity'], string> = {
  info: palette.textMuted,
  warning: palette.warning,
  critical: palette.danger,
};

const SEVERITY_LABEL: Record<AlertSummary['severity'], string> = {
  info: 'For information',
  warning: 'Worth a look',
  critical: 'Needs action',
};

/**
 * The alert inbox, same rows as the console.
 *
 * Tapping one marks it read — `read_at` is the only column a customer may write
 * on an alert, and the grant is column-level, so this screen could not change
 * the wording of one even if it tried.
 */
export default function AlertsScreen() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<AlertSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setAlerts(await listAlerts(supabase));
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

  if (alerts === null && !error) return <Loading />;

  return (
    <View style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.content}
        data={alerts ?? []}
        keyExtractor={(item) => item.alertId}
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
        ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
        ListEmptyComponent={
          <Empty
            title="No alerts"
            body="We tell you when a re-assessment finds something different, when an application stops answering, and before a badge expires."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${SEVERITY_LABEL[item.severity]}. ${item.readAt ? 'Read' : 'Unread'}.`}
            onPress={async () => {
              if (!item.readAt) {
                await markAlertRead(supabase, item.alertId).catch(() => undefined);
                await load();
              }
              if (item.assessmentId) router.push(`/report/${item.assessmentId}`);
              else if (item.appId) router.push(`/application/${item.appId}`);
            }}
            style={[
              styles.card,
              !item.readAt && { borderColor: palette.borderInteractive, borderWidth: 2 },
            ]}
          >
            <View style={styles.row}>
              <Text style={styles.h2}>{item.title}</Text>
              <Text style={{ color: TONE[item.severity], fontSize: 13 }}>
                {SEVERITY_LABEL[item.severity]}
              </Text>
            </View>
            <Text style={styles.muted}>{new Date(item.createdAt).toDateString()}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
