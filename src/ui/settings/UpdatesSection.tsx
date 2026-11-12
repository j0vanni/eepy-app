// App updates (Settings → App updates and the /updates screen): whether a newer build is waiting,
// the one button that downloads and installs it (with progress), what is in it, then checking,
// the auto-check switch and the GitHub sign-in (the repo is private).
import { useEffect } from 'react';
import { Linking, Platform, Text, View } from 'react-native';

import { useStore } from '../../state/store';
import { signInSupported } from '../../updates/account';
import { checkForUpdates } from '../../updates/check';
import { installedBuild } from '../../updates/current';
import { canInstallUpdates, downloadAndInstall, openInstallPermissionSettings } from '../../updates/install';
import { compareBuild, formatBytes, isAuthProblem, RELEASES_PAGE_URL, type ReleaseBuild, UPDATE_CHECK_INTERVAL } from '../../updates/releases';
import { type DownloadState, useUpdateStatus } from '../../updates/status';
import { Button, Card, Fold, Hero, ListCard, ListRow, Meter, Note, Section } from '../components';
import { notify } from '../confirm';
import { relativeTime } from '../format';
import { colors, font, space } from '../theme';
import { GitHubAccount } from './GitHubAccount';
import { errorText, Para } from './parts';
import { Toggle } from './Toggle';

const CHECK_HOURS = Math.round(UPDATE_CHECK_INTERVAL / 3600_000);

function openUrl(url: string) {
  Linking.openURL(url).catch(() => notify("Couldn't open the link", url));
}

/** What changed in a build, one line each. */
function Changes({ release }: { release: ReleaseBuild }) {
  if (release.changes.length === 0) {
    return release.commit ? (
      <Card>
        <Text style={font.small}>
          Built from {release.branch ?? 'the latest code'} @ {release.commit}
        </Text>
      </Card>
    ) : null;
  }
  return (
    <Card>
      <View style={{ gap: space.sm }}>
        {release.changes.map((c, i) => (
          <Text key={i} style={[font.small, { color: colors.text }]}>
            {c}
          </Text>
        ))}
      </View>
      {release.moreChanges > 0 ? <Text style={[font.tiny, { marginTop: space.sm }]}>…and {release.moreChanges} more on the release page</Text> : null}
    </Card>
  );
}

function progressLabel(d: Extract<DownloadState, { phase: 'downloading' }>): string {
  if (d.total > 0) return `Downloading… ${Math.floor((d.written / d.total) * 100)}% · ${formatBytes(d.written) || '0 KB'} of ${formatBytes(d.total)}`;
  return `Downloading… ${formatBytes(d.written) || '0 KB'}`;
}

/** The one action: download and install this build, with progress and what Android will ask. */
function InstallControls({ release }: { release: ReleaseBuild }) {
  const download = useUpdateStatus((s) => s.download);
  if (!canInstallUpdates()) {
    return (
      <Note tone="info" icon="cellphone">
        Updates install from the Android app. Open the release page on your phone to download the APK.
      </Note>
    );
  }
  const mine = download.phase !== 'idle' && download.build === release.build ? download : undefined;
  const busyElsewhere = download.phase === 'downloading' || download.phase === 'installing' ? !mine : false;
  const start = () => {
    downloadAndInstall(release).catch(() => undefined);
  };
  const size = formatBytes(release.apk.size);

  if (mine?.phase === 'downloading') {
    return (
      <Card>
        <Meter value={mine.total > 0 ? mine.written : 0} max={mine.total > 0 ? mine.total : 1} />
        <Text style={[font.small, { marginTop: space.sm }]}>{progressLabel(mine)}</Text>
      </Card>
    );
  }
  if (mine?.phase === 'installing') {
    return (
      <Note tone="info" icon="package-down">
        Android’s installer is open: tap Install (or Update). If it says eepy isn’t allowed to install apps, follow its Settings button, then come back.
      </Note>
    );
  }
  return (
    <View style={{ marginBottom: space.md }}>
      {mine?.phase === 'error' ? <Note tone="bad">{mine.message}</Note> : null}
      {mine?.phase === 'ready' ? <Note tone="info">Downloaded. The installer closed before updating. Open it again when you’re ready.</Note> : null}
      <Button
        icon={mine?.phase === 'ready' ? 'package-down' : 'download'}
        label={mine?.phase === 'ready' ? `Install build ${release.build}` : mine?.phase === 'error' ? 'Try again' : `Update to build ${release.build}${size ? ` (${size})` : ''}`}
        disabled={busyElsewhere}
        onPress={start}
      />
    </View>
  );
}

export function UpdatesSection() {
  const updates = useStore((s) => s.settings.updates);
  const setUpdates = useStore((s) => s.setUpdateSettings);
  const checking = useUpdateStatus((s) => s.checking);
  const latest = useUpdateStatus((s) => s.latest);
  const error = useUpdateStatus((s) => s.error);
  const installed = installedBuild();
  const pendingBuild = installed.build !== undefined && updates.latestBuild !== undefined && updates.latestBuild > installed.build ? updates.latestBuild : undefined;

  // First time here this session: refresh, so the changelog and download link are at hand.
  useEffect(() => {
    const status = useUpdateStatus.getState();
    if (status.lastAttempt !== undefined || status.checking) return;
    const { build } = installedBuild();
    const u = useStore.getState().settings.updates;
    const waiting = build !== undefined && u.latestBuild !== undefined && u.latestBuild > build;
    if (u.autoCheck || waiting) checkForUpdates('manual').catch(() => undefined);
  }, []);

  const check = () => {
    checkForUpdates('manual').catch(() => undefined);
  };
  const buildLabel = installed.build !== undefined ? `build ${installed.build}` : Platform.OS === 'web' ? 'web preview' : 'development build';
  const lastChecked = checking ? 'Checking GitHub…' : updates.lastCheck ? `Checked ${relativeTime(updates.lastCheck)}` : 'Not checked yet';
  const state = latest ? compareBuild(installed.build, latest) : undefined;
  const offer = latest && state !== 'up-to-date' ? latest : undefined;
  const signedOut = !updates.login && signInSupported();

  const meta = latest
    ? [latest.version ? `eepy ${latest.version}` : undefined, latest.publishedAt ? `published ${relativeTime(latest.publishedAt)}` : undefined, latest.branch && latest.branch !== 'main' ? `from ${latest.branch}` : undefined]
        .filter(Boolean)
        .join(' · ')
    : '';

  let headline: string;
  let caption = lastChecked;
  if (latest && state === 'update-available') {
    headline = `Build ${latest.build} is ready`;
    caption = meta || lastChecked;
  } else if (latest && state === 'up-to-date') {
    headline = 'Up to date';
    caption = `${lastChecked}${installed.build !== undefined && installed.build > latest.build ? ` · GitHub’s newest is build ${latest.build}` : ''}`;
  } else if (latest) {
    headline = `Newest: build ${latest.build}`;
    caption = meta || lastChecked;
  } else if (pendingBuild !== undefined) headline = `Build ${pendingBuild} is available`;
  else if (checking) headline = 'Checking…';
  else if (signedOut) headline = 'Sign in to get updates';
  else headline = updates.lastCheck ? 'No newer build found' : 'Not checked yet';

  const account = <GitHubAccount />;

  return (
    <>
      <Hero label={`This phone: eepy ${installed.version} · ${buildLabel}`} value={headline} caption={caption} color={state === 'update-available' ? colors.accent : undefined} />
      {/* Sign-in problems are explained by GitHubAccount. */}
      {error && !checking && !isAuthProblem(error.kind) ? <Note tone="warn">{error.message}</Note> : null}

      {offer ? (
        <>
          <InstallControls release={offer} />
          {state === 'unknown-build' && canInstallUpdates() ? <Note tone="info">This is a development build, so eepy can’t tell whether it’s older. Installing replaces it with the release APK.</Note> : null}
        </>
      ) : !latest && pendingBuild !== undefined ? (
        <Button kind="secondary" icon="refresh" label={checking ? 'Checking…' : `Load build ${pendingBuild}`} disabled={checking} onPress={check} style={{ marginBottom: space.md }} />
      ) : null}

      {signedOut ? account : null}

      {latest && (offer || (installed.build === latest.build && latest.changes.length > 0)) ? (
        <Section title={offer ? `In build ${latest.build}` : 'In this build'}>
          <Changes release={latest} />
        </Section>
      ) : null}

      <Section title="Checking for updates">
        <ListCard>
          <ListRow icon="refresh" title={checking ? 'Checking…' : 'Check now'} sub={lastChecked} onPress={checking ? undefined : check} />
          <Toggle label="Check automatically" sub={`When eepy opens and in the background, at most every ${CHECK_HOURS} h`} value={updates.autoCheck} onChange={(v) => setUpdates({ autoCheck: v })} />
          <ListRow icon="open-in-new" title="Release page" sub="Every build, on GitHub" onPress={() => openUrl(latest?.pageUrl ?? RELEASES_PAGE_URL)} />
          {canInstallUpdates() ? (
            <Fold bare title="The first install on this phone">
              <Para first>Android says eepy isn’t allowed to install unknown apps: tap Settings, turn on “Allow from this source”, go back and tap Install.</Para>
              <Para>Your sleep data stays. The new build installs over this one.</Para>
              <View style={{ alignItems: 'flex-start', marginTop: space.sm }}>
                <Button small kind="secondary" icon="shield-check-outline" label="Allow installs from eepy" onPress={() => openInstallPermissionSettings().catch((e) => notify('Android settings', errorText(e)))} />
              </View>
            </Fold>
          ) : null}
          <Fold bare title="What eepy sends">
            <Para first>eepy only asks GitHub (api.github.com) for the list of builds and the APK. Nothing about you or your sleep is sent.</Para>
            <Para>You get one notification per new build.</Para>
            {installed.build === undefined ? <Para>Development builds don’t know their build number, so eepy never prompts here. Check now still shows the newest release.</Para> : null}
          </Fold>
        </ListCard>
      </Section>

      {signedOut ? null : account}
    </>
  );
}
