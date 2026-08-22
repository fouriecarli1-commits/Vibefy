import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  listAssessments,
  listRequests,
  requestReTest,
  type AssessmentSummary,
  type RequestSummary,
} from '@vibefy/api';
import { supabase } from '@/lib/supabase.ts';
import { palette, scoreColour, spacing } from '@/lib/theme.ts';
import { Button, Loading, styles } from '@/lib/ui.tsx';

interface AppRow {
  id: string;
  organisation_id: string;
  name: string;
  primary_url: string | null;
  monitoring_enabled: boolean;
  last_seen_at: string | null;
}

/**
 * One application: its history, its state, and the one write that spends money.
 *
 * Requesting a re-test checks the authorisation gate before it queues anything,
 * so the refusal a customer sees is the real reason rather than a job that fails
 * silently ten minutes later. The database checks it again on insert, and the
 * worker checks it a third time before it runs.
 */
export default function ApplicationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [app, setApp] = useState<AppRow | null>(null);
  const [history, setHistory] = useState<AssessmentSummary[]>([]);
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('apps')
      .select('id, organisation_id, name, primary_url, monitoring_enabled, last_seen_at')
      .eq('id', id)
      .maybeSingle();
    setApp((data as AppRow | null) ?? null);
    setHistory(await listAssessments(supabase, id).catch(() => []));
    setRequests(await listRequests(supabase, id).catch(() => []));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!app) return <Loading />;

  const live = requests.find((request) => ['queued', 'claimed'].includes(request.status));
  const latest = history[0];

  async function approveReTest() {
    if (!app) return;
    setBusy(true);
    setNotice(null);
    setError(null);

    const { data: plan } = await supabase
      .from('subscriptions')
      .select('plan')
      .eq('organisation_id', app.organisation_id)
      .in('status', ['active', 'trialing'])
      .limit(1)
      .maybeSingle();

    const result = await requestReTest(supabase, {
      appId: app.id,
      organisationId: app.organisation_id,
      userId: (await supabase.auth.getUser()).data.user?.id ?? '',
      depth: plan?.plan === 'free' || !plan ? 'limited' : 'continuous',
      plan: (plan?.plan as string) ?? 'free',
      maxRunCostUsd: plan?.plan === 'free' || !plan ? 1.5 : 12,
    });
    setBusy(false);

    if ('refused' in result) setError(result.reason);
    else {
      setNotice('Queued. You will get an alert when a reviewer has approved the result.');
      await load();
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.h1}>{app.name}</Text>
        <Text style={styles.muted}>{app.primary_url}</Text>
        {latest && (
          <Text style={[styles.score, { color: scoreColour(latest.score) }]}>
            {latest.score === null ? '—' : `${latest.score.toFixed(1)} / 100`}
          </Text>
        )}
        <Text style={styles.muted}>
          {app.monitoring_enabled ? 'Monitored' : 'Not monitored'}
          {app.last_seen_at
            ? ` · last answered ${new Date(app.last_seen_at).toDateString()}`
            : ''}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Re-assessment</Text>
        {live ? (
          <Text style={styles.muted}>
            An assessment is {live.status}. A human reviews the result before you see it — nothing is
            published before that.
          </Text>
        ) : (
          <>
            <Text style={styles.muted}>
              Runs against the scope you already authorised, and nothing else. What it costs and how
              deep it goes depends on your plan; what it scores does not.
            </Text>
            <View style={{ marginTop: spacing.sm }}>
              <Button label="Request a re-assessment" onPress={approveReTest} busy={busy} />
            </View>
          </>
        )}
        {notice && <Text style={styles.ok}>{notice}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>History</Text>
        {history.length === 0 ? (
          <Text style={styles.muted}>No approved assessments yet.</Text>
        ) : (
          history.map((assessment) => (
            <View key={assessment.assessmentId} style={{ paddingVertical: spacing.xs }}>
              <View style={styles.row}>
                <Text
                  accessibilityRole="link"
                  onPress={() => router.push(`/report/${assessment.assessmentId}`)}
                  style={{ color: palette.link, fontSize: 16 }}
                >
                  {assessment.score === null ? 'Not scored' : `${assessment.score.toFixed(1)} / 100`}
                </Text>
                <Text style={styles.muted}>{assessment.assessedOn}</Text>
              </View>
              <Text style={styles.muted}>
                Rubric v{assessment.rubricVersion}
                {assessment.scoreDelta !== null && assessment.scoreDelta !== 0
                  ? ` · ${assessment.scoreDelta > 0 ? '+' : ''}${assessment.scoreDelta.toFixed(1)} since the previous one`
                  : ''}
                {assessment.materialRegression ? ' · material change' : ''}
              </Text>
            </View>
          ))
        )}
      </View>

      {requests.some((request) => request.status === 'refused') && (
        <View style={styles.card}>
          <Text style={styles.h2}>Last refusal</Text>
          <Text style={styles.muted}>
            {requests.find((request) => request.status === 'refused')?.refusalMessage}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
