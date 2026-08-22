import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing } from './theme.ts';

/**
 * The handful of pieces every screen uses.
 *
 * Deliberately small. The brief says read-and-monitor first and not to rebuild
 * the console on a phone, so there is no form kit here — the only writes the app
 * makes are "add an application", "request a re-test" and "mark read".
 */
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface },
  content: { padding: spacing.md, gap: spacing.md },
  card: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  h1: { fontSize: 26, fontWeight: '700', color: palette.text },
  h2: { fontSize: 18, fontWeight: '600', color: palette.text },
  body: { fontSize: 15, color: palette.text, lineHeight: 22 },
  muted: { fontSize: 14, color: palette.textMuted, lineHeight: 20 },
  score: { fontSize: 30, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  button: {
    backgroundColor: palette.accent,
    borderRadius: radii.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  buttonText: { color: palette.onAccent, fontWeight: '600', fontSize: 16 },
  input: {
    borderWidth: 1,
    borderColor: palette.borderInteractive,
    borderRadius: radii.sm,
    padding: 12,
    fontSize: 16,
    color: palette.text,
    backgroundColor: palette.surface,
  },
  error: { color: palette.danger, fontSize: 14 },
  ok: { color: palette.success, fontSize: 14 },
});

export function Button({
  label,
  onPress,
  busy = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={[styles.button, (disabled || busy) && { opacity: 0.6 }]}
    >
      {busy ? (
        <ActivityIndicator color={palette.onAccent} />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Loading() {
  return (
    <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
      <ActivityIndicator accessibilityLabel="Loading" color={palette.accent} />
    </View>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.h2}>{title}</Text>
      <Text style={styles.muted}>{body}</Text>
    </View>
  );
}
