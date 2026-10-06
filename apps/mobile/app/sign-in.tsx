import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SSO_ROUTING_UNKNOWN, ssoRoutingFor } from '@vibefycode/shared';
import { supabase } from '@/lib/supabase.ts';
import { registerForPush } from '@/lib/push.ts';
import { styles } from '@/lib/ui.tsx';
import { Button } from '@/lib/ui.tsx';

/**
 * Sign-in.
 *
 * Password only, and no account creation: an account is created on the web,
 * where the Terms and the Privacy Policy are shown in full and acceptance is
 * recorded with the version and hash of what was actually agreed to. A phone
 * sign-up flow that skipped that would make the consent record a lie.
 */
export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);

    /*
     * The same domain-routing check the web sign-in makes. A workspace that has
     * enforced single sign-on has done so precisely so a password is not
     * another way in — including from a phone.
     *
     * Through `ssoRoutingFor`, which is where that sentence became true. Both
     * forms used to discard the lookup's error, so a failed call returned no
     * data, the branch was skipped, and the password was accepted: the control
     * was off exactly when the database could not answer.
     */
    const routing = await ssoRoutingFor(supabase, email);
    if (routing.kind === 'unknown') {
      setBusy(false);
      return setError(SSO_ROUTING_UNKNOWN);
    }
    if (routing.kind === 'required') {
      setBusy(false);
      return setError(
        `${routing.domain} signs in through your organisation’s identity provider. Open the console in a browser to sign in.`,
      );
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) return setError(signInError.message);
    await registerForPush().catch(() => undefined);
    router.replace('/');
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Sign in to VibefyCode</Text>
      <Text style={styles.muted}>
        Use the account you created on the web. New accounts are made there, where the Terms and the
        Privacy Policy are shown in full and your acceptance is recorded against the exact wording.
      </Text>

      <View style={{ gap: 6 }}>
        <Text style={styles.muted}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          accessibilityLabel="Email address"
        />
      </View>

      <View style={{ gap: 6 }}>
        <Text style={styles.muted}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          accessibilityLabel="Password"
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Sign in" onPress={submit} busy={busy} />
    </ScrollView>
  );
}
