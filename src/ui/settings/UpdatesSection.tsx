// "App updates" settings (also the /updates screen): this build, GitHub sign-in (the repo is
// private), Check now, download + install the newest build with progress, its changelog, and the
// auto-check switch.
import { useEffect } from 'react';
import { Linking, Platform, Text, View } from 'react-native';

import { useStore } from '../../state/store';
import { checkForUpdates } from '../../updates/check';
import { installedBuild } from '../../updates/current';
import { canInstallUpdates, downloadAndInstall, openInstallPermissionSettings } from '../../updates/install';
import { compareBuild, formatBytes, isAuthProblem, RELEASES_PAGE_URL, type ReleaseBuild, UPDATE_CHECK_INTERVAL } from '../../updates/releases';
import { type DownloadState, useUpdateStatus } from '../../updates/status';
import { Button, Card, CardTitle, Meter, Note, Row, Section } from '../components';
import { notify } from '../confirm';
import { relativeTime } from '../format';
import { colors, font, radius, space } from '../theme';
import { GitHubAccount } from './GitHubAccount';
import { Toggle } from './Toggle';

const CHECK_HOURS = Math.round(UPDATE_CHECK_INTERVAL / 3600_000);

function openUrl(url: string) {
  Linking.openURL(url).catch(() => notify("Couldn't open the link", url));
}

function Changes({ release }: { release: ReleaseBuild }) {
  if (release.changes.length === 0) {
    return release.commit ? <Text style={[font.small, { marginTop: space.sm }]}>Built from {release.branch ?? 'the latest code'} @ {release.commit}</Text> : null;
  }
  return (
    <View style={{ marginTop: space.sm, gap: 2 }}>
      {release.changes.map((c, i) => (
        <Row key={i} gap={6} style={{ alignItems: 'flex-start' }}>
          <Text style={font.small}>•</Text>
          <Text style={[font.small, { flex: 1, color: colors.text }]}>{c}</Text>
        </Row>
      ))}
      {release.moreChanges > 0 ? <Text style={font.tiny}>…and {release.moreChanges} more on the release page</Text> : null}
    </View>
  );
}

function progressLabel(d: Extract<DownloadState, { phase: 'downloading' }>): string {
  if (d.total > 0) return `Downloading… ${Math.floor((d.written / d.total) * 100)}% · ${formatBytes(d.written) || '0 KB'} of ${formatBytes(d.total)}`;
  return `Downloading… ${formatBytes(d.written) || '0 KB'}`;
}

/** What Android asks the first time eepy installs an update. */
function InstallPermissionHelp() {
  const open = () => openInstallPermissionSettings().catch((e) => notify('Android settings', e instanceof Error ? e.message : String(e)));
  return (
    <View style={{ marginTop: space.sm }}>
      <Text style={font.tiny}>
        The first time, Android says eepy isn’t allowed to install unknown apps: tap Settings, turn on “Allow from this source”, go back and tap Install. Your sleep data
        stays — the new build installs over this one.
      </Text>
      <View style={{ alignSelf: 'flex-start', marginTop: space.xs }}>
        <Button small kind="ghost" icon="shield-check-outline" label="Allow installs from eepy" onPress={open} />
      </View>
    </View>
  );
}

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

  return (
    <View style={{ marginTop: space.md }}>
      {mine?.phase === 'downloading' ? (
        <View style={{ gap: space.xs }}>
          <Meter value={mine.total > 0 ? mine.written : 0} max={mine.total > 0 ? mine.total : 1} />
          <Text style={font.small}>{progressLabel(mine)}</Text>
        </View>
      ) : mine?.phase === 'installing' ? (
        <Note tone="info" icon="package-down">
          Android’s installer is open — tap Install (or Update). If it says eepy isn’t allowed to install apps, follow its Settings button, then come back.
        </Note>
      ) : (
        <>
          {mine?.phase === 'error' ? <Note tone="bad">{mine.message}</Note> : null}
          {mine?.phase === 'ready' ? <Text style={[font.small, { marginBottom: space.sm }]}>Downloaded. The installer closed before updating — open it again when you’re ready.</Text> : null}
          <View style={{ alignSelf: 'flex-start' }}>
            <Button
              icon={mine?.phase === 'ready' ? 'package-down' : 'download'}
              label={mine?.phase === 'ready' ? `Install build ${release.build}` : mine?.phase === 'error' ? 'Try again' : `Update to build ${release.build}${size ? ` (${size})` : ''}`}
              disabled={busyElsewhere}
              onPress={start}
            />
          </View>
        </>
      )}
      <InstallPermissionHelp />
    </View>
  );
}

function ReleaseDetails({ release, installed }: { release: ReleaseBuild; installed?: number }) {
  const state = compareBuild(installed, release);
  const meta = [
    release.version ? `eepy ${release.version}` : undefined,
    release.publishedAt ? `published ${relativeTime(release.publishedAt)}` : undefined,
    release.branch && release.branch !== 'main' ? `from ${release.branch}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  if (state === 'up-to-date') {
    return (
      <View style={{ marginTop: space.md }}>
        <Note tone="good">
          You have the newest build{installed !== undefined && installed > release.build ? ` (GitHub’s newest is build ${release.build})` : ''}.
        </Note>
        {installed === release.build && release.changes.length > 0 ? (
          <>
            <Text style={[font.tiny, { textTransform: 'uppercase', fontWeight: '600' }]}>In this build</Text>
            <Changes release={release} />
          </>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}>
      <Text style={font.h3}>{state === 'update-available' ? `Build ${release.build} is ready` : `Newest on GitHub: build ${release.build}`}</Text>
      {meta ? <Text style={font.small}>{meta}</Text> : null}
      <Changes release={release} />
      {state === 'unknown-build' && canInstallUpdates() ? (
        <Text style={[font.tiny, { marginTop: space.sm }]}>This is a development build, so eepy can’t tell whether it’s older. Installing replaces it with the release APK.</Text>
      ) : null}
      <InstallControls release={release} />
    </View>
  );
}

export function UpdatesSection({ title = 'App updates' }: { title?: string }) {
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

  const buildLabel = installed.build !== undefined ? `build ${installed.build}` : Platform.OS === 'web' ? 'web preview' : 'development build';
  const lastChecked = checking ? 'Checking GitHub…' : updates.lastCheck ? `Last checked ${relativeTime(updates.lastCheck)}` : 'Not checked yet';

  return (
    <Section title={title}>
      <Card>
        <CardTitle icon="cellphone-arrow-down" title="Updates from GitHub" />
        <Text style={font.body}>
          eepy {installed.version} · {buildLabel}
        </Text>
        <Text style={font.small}>{lastChecked}</Text>
        <GitHubAccount />
        {/* Sign-in problems are explained by GitHubAccount. */}
        {error && !checking && !isAuthProblem(error.kind) ? <Note tone="warn">{error.message}</Note> : null}
        {latest ? (
          <ReleaseDetails release={latest} installed={installed.build} />
        ) : pendingBuild !== undefined ? (
          <Note tone="info" icon="cellphone-arrow-down">
            Build {pendingBuild} is available. Tap Check now to load it.
          </Note>
        ) : null}
        <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
          <Button small kind="secondary" icon="refresh" label={checking ? 'Checking…' : 'Check now'} disabled={checking} onPress={() => checkForUpdates('manual').catch(() => undefined)} />
          <Button small kind="ghost" icon="open-in-new" label="Release page" onPress={() => openUrl(latest?.pageUrl ?? RELEASES_PAGE_URL)} />
        </Row>
        <Toggle
          label="Check automatically"
          sub={`When eepy opens and during background sync, at most every ${CHECK_HOURS} h. One notification per new build.`}
          value={updates.autoCheck}
          onChange={(v) => setUpdates({ autoCheck: v })}
        />
        <Text style={font.tiny}>
          {installed.build === undefined
            ? 'Development builds don’t know their build number, so eepy never prompts here — Check now still shows the newest release. '
            : ''}
          eepy only asks GitHub (api.github.com) for the list of builds and the APK; nothing about you or your sleep is sent.
        </Text>
      </Card>
    </Section>
  );
}
