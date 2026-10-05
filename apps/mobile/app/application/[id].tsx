import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  listAssessments,
  listRequests,
  requestReTest,
  type AssessmentSummary,
  type RequestSummary,
} from '@vibefycode/api';
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
  /*
   * `undefined` is "not read yet", `null` is "not there", and a failure is its
   * own state. Three outcomes need three states: with only `null` for all of
   * them, `if (!app) return <Loading />` showed a spinner for ever to anybody
   * whose read failed, and showed the same spinner for an application that is
   * genuinely not theirs.
   */
  const [app, setApp] = useState<AppRow | null | undefined>(undefined);
  const [appError, setAppError] = useState<string | null>(null);
  const [history, setHistory] = useState<AssessmentSummary[]>([]);
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  /*
   * Why the two lists are missing, where they are.
   *
   * They used to be read through `.catch(() => [])`, so a failure printed "No
   * approved assessments yet" on an application that has been assessed, and
   * offered a paid re-test while one was already queued — because the queued
   * one was in the list that failed to load. One state for both, because they
   * are one load and the screen has one thing to say about it.
   */
  const [listsError, setListsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const { data, error: cause } = await supabase
      .from('apps')
      .select('id, organisation_id, name, primary_url, monitoring_enabled, last_seen_at')
      .eq('id', id)
      .maybeSingle();
    // A read that failed is not an application that does not exist.
    setAppError(cause ? cause.message : null);
    setApp(cause ? undefined : ((data as AppRow | null) ?? null));

    try {
      setHistory(await listAssessments(supabase, id));
      setRequests(await listRequests(supabase, id));
      setListsError(null);
    } catch (listCause) {
      setListsError(listCause instanceof Error ? listCause.message : String(listCause));
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (appError !== null) {
    return (
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.h2}>We could not load this application</Text>
          <Text style={styles.muted}>
            That is a fault on our side, not a change to your application. Pull down to try again.
          </Text>
          <Text style={styles.error}>{appError}</Text>
          <View style={{ marginTop: spacing.sm }}>
            <Button label="Try again" onPress={() => void load()} />
          </View>
        </View>
      </View>
    );
  }
  if (app === undefined) return <Loading />;
  if (app === null) {
    return (
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.h2}>Not found</Text>
          <Text style={styles.muted}>
            That application is not on this account, or it has been removed.
          </Text>
        </View>
      </View>
    );
  }

  const live = requests.find((request) => ['queued', 'claimed'].includes(request.status));
  // Not the first of an unordered twenty: `listAssessments` orders before it
  // limits, so this is the newest assessment and the figure below is current.
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
        {listsError !== null ? (
          // A dash here would read as "not scored". This application may well
          // be scored; we could not read it.
          <Text style={styles.muted}>Score could not be read just now.</Text>
        ) : (
          latest && (
            <Text style={[styles.score, { color: scoreColour(latest.score) }]}>
              {latest.score === null ? '—' : `${latest.score.toFixed(1)} / 100`}
            </Text>
          )
        )}
        <Text style={styles.muted}>
          {app.monitoring_enabled ? 'Monitored' : 'Not monitored'}
          {app.last_seen_at ? ` · last answered ${new Date(app.last_seen_at).toDateString()}` : ''}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Re-assessment</Text>
        {listsError !== null ? (
          // Offering a re-test here would be offering one without knowing
          // whether one is already running, which is the state this card
          // exists to show.
          <Text style={styles.muted}>
            We could not tell whether an assessment is already running, so this is not offered. Pull
            down to try again.
          </Text>
        ) : live ? (
          <Text style={styles.muted}>
            An assessment is {live.status}. A human reviews the result before you see it — nothing
            is published before that.
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
        {listsError !== null ? (
          <Text style={styles.error}>
            The history could not be loaded, so this list is not empty — it is unknown. (
            {listsError})
          </Text>
        ) : history.length === 0 ? (
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
                  {assessment.score === null
                    ? 'Not scored'
                    : `${assessment.score.toFixed(1)} / 100`}
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
