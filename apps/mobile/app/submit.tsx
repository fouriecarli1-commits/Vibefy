import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase.ts';
import { styles, Button } from '@/lib/ui.tsx';

/**
 * Adding an application from a phone.
 *
 * It creates the record and nothing else. Ownership verification — publishing a
 * DNS record or a file, and giving the warranty that you are entitled to
 * authorise testing — happens in the console, and this screen says so before
 * anyone gets halfway. A warranty given by tapping through a small screen on a
 * train is a warranty nobody should rely on, including us.
 */
export default function SubmitScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [organisationId, setOrganisationId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase
      .from('memberships')
      .select('organisation_id, organisations (id, name, is_personal)')
      .then(({ data }) => {
        const rows = (data ?? []) as unknown as {
          organisation_id: string;
          organisations: { name: string; is_personal: boolean } | null;
        }[];
        const personal = rows.find((row) => row.organisations?.is_personal) ?? rows[0];
        setOrganisationId(personal?.organisation_id ?? null);
        setWorkspaceName(personal?.organisations?.name ?? null);
      });
  }, []);

  async function submit() {
    setError(null);
    if (!organisationId) return setError('No workspace found for your account.');
    if (name.trim().length < 2) return setError('Give the application a name.');
    if (!/^https:\/\//i.test(url.trim())) {
      return setError(
        'The URL must start with https://. We do not assess applications over plain HTTP.',
      );
    }

    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const slug = `${name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40)}-${Math.random().toString(36).slice(2, 8)}`;

    const { data, error: cause } = await supabase
      .from('apps')
      .insert({
        organisation_id: organisationId,
        name: name.trim(),
        slug,
        app_type: 'web_url',
        primary_url: url.trim(),
        created_by: user?.id ?? null,
      })
      .select('id')
      .single();
    setBusy(false);

    if (cause) return setError(cause.message);
    router.replace(`/application/${data.id}`);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.h2}>Before anything runs</Text>
        <Text style={styles.muted}>
          Adding an application here records it. Nothing is tested until you prove, in the console
          on a computer, that you control the host and are entitled to authorise testing of it. That
          step is a warranty, and it is not one to give from a phone.
        </Text>
      </View>

      {workspaceName && <Text style={styles.muted}>Adding to {workspaceName}.</Text>}

      <View style={{ gap: 6 }}>
        <Text style={styles.muted}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          accessibilityLabel="Application name"
        />
      </View>

      <View style={{ gap: 6 }}>
        <Text style={styles.muted}>URL</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://"
          accessibilityLabel="Application URL"
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Add application" onPress={submit} busy={busy} />
    </ScrollView>
  );
}
