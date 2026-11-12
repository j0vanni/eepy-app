// GitHub sign-in for app updates (eepy-app is private): who is signed in and Sign out, or the two
// ways in — "Sign in with GitHub" (device flow) and pasting a fine-grained token.
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, Linking, Text, TextInput, View } from 'react-native';

import { useStore } from '../../state/store';
import { useNow } from '../../state/useAnalysis';
import { cancelSignIn, deviceSignInSupported, signInSupported, signInWithToken, signOut, startDeviceSignIn, useSignIn } from '../../updates/account';
import { AUTHORIZED_APPS_URL, fineGrainedTokenUrl, TOKEN_STEPS, TOKENS_URL } from '../../updates/githubAuth';
import { AUTH_PROBLEM_MESSAGE } from '../../updates/releases';
import { Button, Card, ListCard, ListRow, Note, Row, Section } from '../components';
import { confirm, notify } from '../confirm';
import { colors, font, space } from '../theme';
import { field, Steps } from './parts';

function openUrl(url: string) {
  Linking.openURL(url).catch(() => notify("Couldn't open the link", url));
}

/** The code to type in on github.com, while eepy waits for GitHub to say yes. */
function DeviceCode({ userCode, verificationUri, expiresAt }: { userCode: string; verificationUri: string; expiresAt: number }) {
  const now = useNow(15_000);
  const minutes = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  const copyAndOpen = async () => {
    await Clipboard.setStringAsync(userCode).catch(() => undefined);
    openUrl(verificationUri);
  };
  return (
    <Card>
      <Text style={[font.label, { textTransform: 'uppercase' }]}>Enter this code on GitHub</Text>
      <Text selectable style={[font.h1, { letterSpacing: 4, fontVariant: ['tabular-nums'], marginTop: space.xs, marginBottom: space.md }]}>
        {userCode}
      </Text>
      <Button icon="content-copy" label="Copy code & open github.com/login/device" onPress={copyAndOpen} />
      <Row gap={space.sm} style={{ marginTop: space.md }}>
        <ActivityIndicator color={colors.accent} />
        <Text style={[font.small, { flex: 1 }]}>Waiting for GitHub. The code expires in {minutes} min.</Text>
      </Row>
      <Text style={[font.tiny, { marginTop: space.sm }]}>Paste the code, tap Continue and Authorize, then come back. eepy notices by itself.</Text>
      <View style={{ alignItems: 'flex-start', marginTop: space.sm }}>
        <Button small kind="ghost" label="Cancel" onPress={cancelSignIn} />
      </View>
    </Card>
  );
}

function TokenForm({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setBusy(true);
    setError(undefined);
    const r = await signInWithToken(value);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setValue('');
    notify('Signed in', r.message);
    onDone();
  };
  return (
    <Card>
      <Steps items={TOKEN_STEPS} />
      <View style={{ alignItems: 'flex-start', marginVertical: space.md }}>
        <Button small kind="secondary" icon="open-in-new" label="Create the token on GitHub" onPress={() => openUrl(fineGrainedTokenUrl())} />
      </View>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder="github_pat_…"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        secureTextEntry
        accessibilityLabel="GitHub token"
        style={field}
      />
      {error ? (
        <View style={{ marginTop: space.sm }}>
          <Note tone="bad">{error}</Note>
        </View>
      ) : null}
      <Row gap={space.sm} style={{ marginTop: space.md }}>
        <Button small kind="secondary" icon="key-variant" label={busy ? 'Checking…' : 'Save token'} disabled={busy || !value.trim()} onPress={save} />
        <Button small kind="ghost" label="Cancel" onPress={onDone} />
      </Row>
      <Text style={[font.tiny, { marginTop: space.sm }]}>The token is kept in Android’s encrypted storage on this phone and only sent to api.github.com.</Text>
    </Card>
  );
}

export function GitHubAccount() {
  const updates = useStore((s) => s.settings.updates);
  const signIn = useSignIn((s) => s.state);
  const [tokenForm, setTokenForm] = useState(false);

  if (!signInSupported()) {
    // The browser can't keep a token safely; say so only once GitHub has said the repo is private.
    if (updates.authProblem !== 'private') return null;
    return (
      <Section title="GitHub account">
        <Note tone="info" icon="github">
          eepy-app is private on GitHub. Sign in from the Android app (Settings → App updates) to check for and install new builds.
        </Note>
      </Section>
    );
  }

  if (updates.login) {
    const device = updates.authMethod === 'device';
    const revokeUrl = device ? AUTHORIZED_APPS_URL : TOKENS_URL;
    const out = async () => {
      if (!(await confirm('Sign out of GitHub?', 'eepy forgets the token on this phone and can’t check for updates of the private repo until you sign in again.', 'Sign out', true))) return;
      await signOut();
      notify(
        'Signed out',
        device
          ? 'To revoke eepy’s access completely, open github.com/settings/applications → Authorized GitHub Apps → eepy → Revoke.'
          : 'To revoke the token completely, delete it at github.com/settings/personal-access-tokens.',
      );
    };
    const problem = updates.authProblem === 'auth' || updates.authProblem === 'no-access' ? updates.authProblem : undefined;
    return (
      <Section title="GitHub account">
        {problem ? <Note tone="warn">{AUTH_PROBLEM_MESSAGE[problem]}</Note> : null}
        {signIn.phase === 'done' ? <Note tone="good">{signIn.message}</Note> : null}
        <ListCard>
          <ListRow icon="github" title={`@${updates.login}`} sub={device ? 'Signed in with the eepy GitHub App' : 'Using a personal access token'} value="Sign out" onPress={out} />
          {problem === 'auth' ? <ListRow icon="login" title="Sign in again" onPress={() => signOut().catch(() => undefined)} /> : null}
          <ListRow icon="open-in-new" title="Revoke access on GitHub" sub={revokeUrl.replace('https://', '')} onPress={() => openUrl(revokeUrl)} />
        </ListCard>
      </Section>
    );
  }

  const device = deviceSignInSupported();
  const waiting = signIn.phase === 'starting' || signIn.phase === 'verifying';
  return (
    <Section title="GitHub account">
      <Text style={[font.small, { marginBottom: space.md, paddingHorizontal: space.xs }]}>
        {updates.authProblem === 'private' ? AUTH_PROBLEM_MESSAGE.private : 'eepy-app is private on GitHub, so eepy needs read-only access to see new builds and download them.'}
      </Text>
      {signIn.phase === 'waiting' ? (
        <DeviceCode userCode={signIn.userCode} verificationUri={signIn.verificationUri} expiresAt={signIn.expiresAt} />
      ) : waiting ? (
        <Row gap={space.sm} style={{ marginBottom: space.md }}>
          <ActivityIndicator color={colors.accent} />
          <Text style={font.small}>{signIn.phase === 'starting' ? 'Asking GitHub for a code…' : 'Signed in. Checking access to eepy-app…'}</Text>
        </Row>
      ) : (
        <>
          {signIn.phase === 'error' ? <Note tone="bad">{signIn.message}</Note> : null}
          {signIn.phase === 'done' ? <Note tone="good">{signIn.message}</Note> : null}
          <View style={{ gap: space.sm, marginBottom: space.md }}>
            {device ? <Button icon="github" label="Sign in with GitHub" onPress={() => startDeviceSignIn()} /> : null}
            {!tokenForm ? <Button kind={device ? 'ghost' : 'primary'} icon="key-variant" label={device ? 'Use a token instead' : 'Paste a GitHub token'} onPress={() => setTokenForm(true)} /> : null}
          </View>
          {!device ? (
            <Text style={[font.tiny, { marginBottom: space.md, paddingHorizontal: space.xs }]}>
              “Sign in with GitHub” appears once the eepy GitHub App’s client ID is in app.json (expo.extra.githubClientId). Until then, use a fine-grained token.
            </Text>
          ) : null}
          {tokenForm ? <TokenForm onDone={() => setTokenForm(false)} /> : null}
        </>
      )}
    </Section>
  );
}
