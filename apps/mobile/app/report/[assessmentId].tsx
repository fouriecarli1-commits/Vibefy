import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { AI_DISCLOSURE } from '@vibefy/shared';
import { supabase } from '@/lib/supabase.ts';
import { scoreColour, spacing } from '@/lib/theme.ts';
import { Loading, styles } from '@/lib/ui.tsx';

interface AssessmentRow {
  id: string;
  overall_score: string | null;
  rubric_version: string;
  certification_eligible: boolean;
  gate_failures: string[] | null;
  scope_statement: string | null;
  dimension_scores: { dimension: string; score: number; band?: string }[] | null;
  completed_at: string | null;
  created_at: string;
}

interface FindingRow {
  id: string;
  title: string;
  severity: string;
  dimension: string;
  description: string;
}

/**
 * Reading a report on a phone.
 *
 * The same rows the console renders, in the same order, with the scope statement
 * above the score rather than below it. That ordering is not a layout
 * preference — the brief requires the limitations to be read before the number,
 * and a small screen is exactly where a number gets read on its own.
 *
 * Remediation and evidence are not shown here. They are the paid tier's, and the
 * redaction that decides which is which lives in `packages/report`; rather than
 * reimplement it on a phone, this screen shows what every tier is entitled to
 * and sends people to the console for the rest.
 */
export default function ReportScreen() {
  const { assessmentId } = useLocalSearchParams<{ assessmentId: string }>();
  const [assessment, setAssessment] = useState<AssessmentRow | null>(null);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assessmentId) return;
    void (async () => {
      const { data, error: cause } = await supabase
        .from('assessments')
        .select(
          'id, overall_score, rubric_version, certification_eligible, gate_failures, scope_statement, dimension_scores, completed_at, created_at',
        )
        .eq('id', assessmentId)
        .maybeSingle();
      if (cause) setError(cause.message);
      setAssessment((data as AssessmentRow | null) ?? null);

      const { data: rows } = await supabase
        .from('findings')
        .select('id, title, severity, dimension, description')
        .eq('assessment_id', assessmentId)
        .eq('is_published', true);
      setFindings((rows ?? []) as FindingRow[]);
    })();
  }, [assessmentId]);

  if (!assessment && !error) return <Loading />;
  if (!assessment) {
    return (
      <View style={styles.content}>
        <Text style={styles.error}>{error ?? 'That report is not available to you.'}</Text>
      </View>
    );
  }

  const score = assessment.overall_score === null ? null : Number(assessment.overall_score);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.h2}>What this assessment is, and is not</Text>
        <Text style={styles.muted}>{assessment.scope_statement}</Text>
        <Text style={styles.muted}>{AI_DISCLOSURE}</Text>
      </View>

      <View style={styles.card}>
        <Text style={[styles.score, { color: scoreColour(score) }]}>
          {score === null ? '—' : `${score.toFixed(1)} / 100`}
        </Text>
        <Text style={styles.muted}>
          Rubric v{assessment.rubric_version} · assessed{' '}
          {new Date(assessment.completed_at ?? assessment.created_at).toDateString()}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>By dimension</Text>
        {(assessment.dimension_scores ?? []).map((dimension) => (
          <View key={dimension.dimension} style={styles.row}>
            <Text style={styles.body}>{dimension.dimension.replace(/_/g, ' ')}</Text>
            <Text style={[styles.body, { color: scoreColour(Number(dimension.score)) }]}>
              {Number(dimension.score).toFixed(1)}
            </Text>
          </View>
        ))}
      </View>

      {(assessment.gate_failures ?? []).length > 0 && (
        <View style={styles.card}>
          <Text style={styles.h2}>Why this did not reach the certification threshold</Text>
          {(assessment.gate_failures ?? []).map((failure) => (
            <Text key={failure} style={styles.muted}>
              • {failure}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.h2}>Findings ({findings.length})</Text>
        {findings.map((finding) => (
          <View key={finding.id} style={{ paddingVertical: spacing.xs }}>
            <Text style={styles.body}>{finding.title}</Text>
            <Text style={styles.muted}>
              {finding.severity} · {finding.dimension.replace(/_/g, ' ')}
            </Text>
            <Text style={styles.muted}>{finding.description}</Text>
          </View>
        ))}
        <Text style={[styles.muted, { marginTop: spacing.sm }]}>
          Remediation steps, evidence and the PDF are in the console. Your score is the same number
          wherever you read it.
        </Text>
      </View>
    </ScrollView>
  );
}
