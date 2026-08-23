import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MOBILE_CAPABILITIES } from '@vibefycode/api';
import { NON_RELIANCE_LEGEND } from '@vibefycode/shared';
import { supabase } from '@/lib/supabase.ts';
import { registerForPush, unregisterPush } from '@/lib/push.ts';
import { palette, spacing } from '@/lib/theme.ts';
import { Button, styles } from '@/lib/ui.tsx';

const CONSOLE_ONLY = [
  'Proving you own an application',
  'Accepting the badge licence',
  'Billing, plans and seats',
  'Workspace, policy and single sign-on settings',
];

/**
 * Account, notifications, and an honest list of what this app deliberately
 * cannot do.
 *
 * Each item on that list is a decision with a legal or financial consequence.
 * The brief says read-and-monitor first; showing the boundary is better than
 * letting someone discover it halfway through giving a warranty on a train.
 */
export default function AccountScreen() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [pushOn, setPushOn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    void supabase
      .from('device_tokens')
      .select('id')
      .is('disabled_at', null)
      .limit(1)
      .then(({ data }) => setPushOn((data ?? []).length > 0));
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.h2}>Signed in</Text>
        <Text style={styles.muted}>{email ?? '—'}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.h2}>Push notifications</Text>
          <Switch
            value={pushOn}
            disabled={busy}
            accessibilityLabel="Push notifications"
            onValueChange={async (next) => {
              setBusy(true);
              if (next) {
                const result = await registerForPush();
                setPushOn(result.registered);
                setNotice(result.reason ?? 'This device will receive alerts.');
              } else {
                await unregisterPush();
                setPushOn(false);
                setNotice('This device will no longer receive alerts. They still appear here.');
              }
              setBusy(false);
            }}
          />
        </View>
        <Text style={styles.muted}>
          We push the ones that need action — a material change, an application that stopped
          answering, a badge about to expire. Score improvements wait for you to open the app.
        </Text>
        {notice && <Text style={styles.muted}>{notice}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>What you do on a computer</Text>
        <Text style={styles.muted}>
          These are decisions with a legal or financial consequence, so they live in the console
          rather than here.
        </Text>
        <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
          {CONSOLE_ONLY.map((item) => (
            <Text key={item} style={styles.muted}>
              • {item}
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>What a VibefyCode assessment is not</Text>
        <Text style={styles.muted}>{NON_RELIANCE_LEGEND}</Text>
      </View>

      <Button
        label="Sign out"
        onPress={async () => {
          setBusy(true);
          // The token goes before the session does. One left behind would push
          // the next person's alerts to this handset.
          await unregisterPush().catch(() => undefined);
          await supabase.auth.signOut();
          setBusy(false);
          router.replace('/sign-in');
        }}
        busy={busy}
      />

      <Text style={[styles.muted, { color: palette.textMuted }]}>
        {MOBILE_CAPABILITIES.canApproveReTest
          ? 'You can request a re-assessment from here for an application that is already authorised.'
          : ''}
      </Text>
    </ScrollView>
  );
}
