// GitHub sign-in for app updates (eepy-app is private): signed-in state + sign out, or the two
// ways in — "Sign in with GitHub" (device flow) and pasting a fine-grained token.
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, Linking, Text, TextInput, View } from 'react-native';

import { useStore } from '../../state/store';
import { cancelSignIn, deviceSignInSupported, signInSupported, signInWithToken, signOut, startDeviceSignIn, useSignIn } from '../../updates/account';
import { AUTHORIZED_APPS_URL, fineGrainedTokenUrl, TOKEN_STEPS, TOKENS_URL } from '../../updates/githubAuth';
import { AUTH_PROBLEM_MESSAGE } from '../../updates/releases';
import { useNow } from '../../state/useAnalysis';
import { Button, Note, Row } from '../components';
import { confirm, notify } from '../confirm';
import { colors, font, radius, space } from '../theme';

function openUrl(url: string) {
  Linking.openURL(url).catch(() => notify("Couldn't open the link", url));
}

function DeviceCodeBox({ userCode, verificationUri, expiresAt }: { userCode: string; verificationUri: string; expiresAt: number }) {
  const now = useNow(15_000);
  const minutes = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  const copyAndOpen = async () => {
    await Clipboard.setStringAsync(userCode).catch(() => undefined);
    openUrl(verificationUri);
  };
  return (
    <View style={{ marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', gap: space.sm }}>
      <Text style={font.small}>Enter this code on GitHub</Text>
      <Text selectable style={{ color: colors.text, fontSize: 34, fontWeight: '700', letterSpacing: 4, fontVariant: ['tabular-nums'] }}>
        {userCode}
      </Text>
      <Button icon="content-copy" label="Copy code & open github.com/login/device" onPress={copyAndOpen} />
      <Row gap={space.sm}>
        <ActivityIndicator color={colors.accent} />
        <Text style={font.small}>Waiting for GitHub… the code expires in {minutes} min</Text>
      </Row>
      <Text style={[font.tiny, { textAlign: 'center' }]}>Paste the code, tap Continue and Authorize, then come back — eepy notices by itself.</Text>
      <Button small kind="ghost" label="Cancel" onPress={cancelSignIn} />
    </View>
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
    <View style={{ marginTop: space.md, gap: space.sm }}>
      {TOKEN_STEPS.map((step, i) => (
        <Row key={i} gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <Text style={[font.small, { color: colors.accent, fontWeight: '700' }]}>{i + 1}.</Text>
          <Text style={[font.small, { flex: 1, color: colors.text }]}>{step}</Text>
        </Row>
      ))}
      <View style={{ alignSelf: 'flex-start' }}>
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
        style={{ color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, fontSize: 15 }}
      />
      {error ? <Note tone="bad">{error}</Note> : null}
      <Row gap={space.sm}>
        <Button small icon="key-variant" label={busy ? 'Checking…' : 'Save token'} disabled={busy || !value.trim()} onPress={save} />
        <Button small kind="ghost" label="Cancel" onPress={onDone} />
      </Row>
      <Text style={font.tiny}>The token is kept in Android’s encrypted storage on this phone and only sent to api.github.com.</Text>
    </View>
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
      <Note tone="info" icon="github">
        eepy-app is private on GitHub. Sign in from the Android app (Settings → App updates) to check for and install new builds.
      </Note>
    );
  }

  if (updates.login) {
    const revokeUrl = updates.authMethod === 'device' ? AUTHORIZED_APPS_URL : TOKENS_URL;
    const out = async () => {
      if (!(await confirm('Sign out of GitHub?', 'eepy forgets the token on this phone and can’t check for updates of the private repo until you sign in again.', 'Sign out', true))) return;
      await signOut();
      notify(
        'Signed out',
        updates.authMethod === 'device'
          ? 'To revoke eepy’s access completely, open github.com/settings/applications → Authorized GitHub Apps → eepy → Revoke.'
          : 'To revoke the token completely, delete it at github.com/settings/personal-access-tokens.',
      );
    };
    return (
      <View style={{ marginTop: space.sm }}>
        <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
          <Text style={[font.body, { flex: 1 }]}>
            Signed in to GitHub as <Text style={{ fontWeight: '700' }}>@{updates.login}</Text>
          </Text>
          <Button small kind="ghost" icon="logout" label="Sign out" onPress={out} />
        </Row>
        {signIn.phase === 'done' ? <Note tone="good">{signIn.message}</Note> : null}
        <Text style={font.tiny}>
          {updates.authMethod === 'device' ? 'Signed in with the eepy GitHub App' : 'Using a personal access token'} — revoke it any time at{' '}
          <Text style={{ color: colors.accent }} onPress={() => openUrl(revokeUrl)}>
            {revokeUrl.replace('https://', '')}
          </Text>
          .
        </Text>
        {updates.authProblem === 'auth' || updates.authProblem === 'no-access' ? (
          <View style={{ marginTop: space.sm }}>
            <Note tone="warn">{AUTH_PROBLEM_MESSAGE[updates.authProblem]}</Note>
            {updates.authProblem === 'auth' ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <Button small icon="github" label="Sign in again" onPress={() => signOut().catch(() => undefined)} />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  const device = deviceSignInSupported();
  return (
    <View style={{ marginTop: space.md }}>
      <Text style={font.small}>
        {updates.authProblem === 'private'
          ? AUTH_PROBLEM_MESSAGE.private
          : 'eepy-app is private on GitHub, so eepy needs read-only access to see new builds and download them.'}
      </Text>
      {signIn.phase === 'waiting' ? (
        <DeviceCodeBox userCode={signIn.userCode} verificationUri={signIn.verificationUri} expiresAt={signIn.expiresAt} />
      ) : signIn.phase === 'starting' || signIn.phase === 'verifying' ? (
        <Row gap={space.sm} style={{ marginTop: space.md }}>
          <ActivityIndicator color={colors.accent} />
          <Text style={font.small}>{signIn.phase === 'starting' ? 'Asking GitHub for a code…' : 'Signed in — checking access to eepy-app…'}</Text>
        </Row>
      ) : (
        <>
          {signIn.phase === 'error' ? <Note tone="bad">{signIn.message}</Note> : null}
          {signIn.phase === 'done' ? <Note tone="good">{signIn.message}</Note> : null}
          <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
            {device ? <Button small icon="github" label="Sign in with GitHub" onPress={() => startDeviceSignIn()} /> : null}
            {!tokenForm ? <Button small kind={device ? 'ghost' : 'secondary'} icon="key-variant" label={device ? 'Use a token instead' : 'Paste a GitHub token'} onPress={() => setTokenForm(true)} /> : null}
          </Row>
          {!device ? (
            <Text style={[font.tiny, { marginTop: space.xs }]}>
              “Sign in with GitHub” appears once the eepy GitHub App’s client ID is in app.json (expo.extra.githubClientId). Until then, use a fine-grained token.
            </Text>
          ) : null}
          {tokenForm ? <TokenForm onDone={() => setTokenForm(false)} /> : null}
        </>
      )}
    </View>
  );
}
