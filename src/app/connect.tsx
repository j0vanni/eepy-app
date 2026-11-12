/**
 * Connect the watch: whether eepy is getting your nights, the one next step as the button, and the
 * whole path (Health Connect → Nothing X sharing → eepy's permission → the first import) as a
 * short list. Problems show as a banner at the top.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Text } from 'react-native';

import { getPermissionState, healthConnectStatus, HCStatus, openHealthSettings, PermissionState, requestHealthPermissions } from '@/integrations/healthConnect';
import { summarizeOrigins } from '@/integrations/healthConnectMapper';
import { useStore } from '@/state/store';
import { runSync } from '@/state/sync';
import { Banner, Button, Card, Fold, Hero, ListCard, ListRow, Screen, Section } from '@/ui/components';
import { relativeTime } from '@/ui/format';
import { errorText, Para, Steps } from '@/ui/settings/parts';
import { font, space } from '@/ui/theme';

const HEALTH_CONNECT = 'com.google.android.apps.healthdata';

function openHealthConnectInStore() {
  Linking.openURL(`market://details?id=${HEALTH_CONNECT}`).catch(() => Linking.openURL(`https://play.google.com/store/apps/details?id=${HEALTH_CONNECT}`));
}

export default function ConnectScreen() {
  const exitDemo = useStore((s) => s.exitDemo);
  const dataMode = useStore((s) => s.settings.dataMode);
  const lastSync = useStore((s) => s.settings.lastSync);
  const sessions = useStore((s) => s.sessions);
  const origins = useMemo(() => summarizeOrigins(sessions.filter((s) => s.source === 'health-connect')), [sessions]);
  const watchSource = origins.find((o) => o.likelyWatch);
  const [status, setStatus] = useState<HCStatus>();
  const [perms, setPerms] = useState<PermissionState>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();

  const refresh = useCallback(async () => {
    const s = await healthConnectStatus();
    setStatus(s);
    if (s === 'available') setPerms(await getPermissionState().catch(() => undefined));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const grant = async () => {
    setBusy(true);
    try {
      setPerms(await requestHealthPermissions());
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    }
    setBusy(false);
  };

  const sync = async () => {
    setBusy(true);
    if (dataMode === 'demo') exitDemo();
    const r = await runSync({ full: true });
    setMessage({ ok: r.ok, text: r.message });
    setBusy(false);
  };

  if (Platform.OS !== 'android') {
    return (
      <Screen>
        <Hero label="Your watch" value="Android only" caption="Health Connect, where Nothing X stores your watch's sleep, only exists on Android phones. Use the eepy APK there." />
      </Screen>
    );
  }

  const available = status === 'available';
  const imported = !!lastSync && dataMode === 'live';
  const connected = available && !!perms?.sleep && imported;

  // The one thing to do next.
  const next = !status
    ? undefined
    : !available
      ? { label: status === 'update-required' ? 'Update Health Connect' : 'Get Health Connect', icon: 'google-play', onPress: openHealthConnectInStore }
      : !perms?.sleep
        ? { label: 'Let eepy read your data', icon: 'shield-check-outline', onPress: grant }
        : !imported
          ? { label: 'Import my nights', icon: 'sync', onPress: sync }
          : message?.ok
            ? { label: 'Go to Today', icon: 'check', onPress: () => router.replace('/') }
            : { label: 'Sync now', icon: 'sync', onPress: sync };

  const noWatchSleep = imported && !watchSource;
  const banner = message ? (
    <Banner tone={message.ok ? 'good' : 'warn'} text={message.text} />
  ) : noWatchSleep ? (
    <Banner
      tone="warn"
      text={origins.length ? `Synced, but no sleep from Nothing X yet. Only from ${origins.map((o) => o.label).join(', ')}.` : 'Synced, but Health Connect has no sleep from Nothing X yet.'}
    />
  ) : status === 'update-required' ? (
    <Banner tone="warn" text="Health Connect needs an update." />
  ) : null;

  const caption = connected
    ? `Last synced ${relativeTime(lastSync!)}${watchSource ? ` · ${watchSource.sessions} night${watchSource.sessions === 1 ? '' : 's'} from ${watchSource.label}${watchSource.staged ? ', with sleep stages' : ''}` : ''}`
    : 'Your watch talks to Nothing X, Nothing X shares with Health Connect, and eepy reads from there. No extra pairing.';

  return (
    <Screen>
      {banner}
      <Hero label="Your watch" value={connected ? 'Connected' : status ? 'Not connected' : 'Checking…'} caption={caption} />
      {next ? <Button label={busy ? 'Working…' : next.label} icon={next.icon} disabled={busy} onPress={next.onPress} /> : null}

      <Section title="Steps">
        <Card>
          <Steps
            items={[
              { text: status === 'not-installed' ? 'Health Connect on this phone. It is built into Android 14 and newer; on older phones, get it from the Play Store.' : 'Health Connect on this phone', done: available },
              {
                text: 'In Nothing X, open your CMF Watch 3 Pro and switch on Health Connect sharing for Sleep, Heart rate, Heart rate variability, Blood oxygen, Respiratory rate and Steps',
                done: !!watchSource,
              },
              { text: 'Let eepy read your data', done: !!perms?.sleep },
              { text: dataMode === 'demo' ? 'Import your nights. This replaces the demo data.' : 'Import your nights', done: imported },
            ]}
          />
          <Text style={[font.small, { marginTop: space.md }]}>Heart rate and steps matter during the day too: eepy uses them for your energy.</Text>
        </Card>
      </Section>

      <Section title="If something is missing">
        <ListCard>
          {perms?.sleep && !perms.all ? (
            <ListRow icon="shield-check-outline" title="Allow the rest" sub="Sleep is allowed. Allow the others too: heart rate, HRV, blood oxygen, breathing and steps." onPress={busy ? undefined : grant} />
          ) : null}
          <ListRow icon="open-in-new" title="Open Health Connect" sub="App permissions → Nothing X should be allowed to write" onPress={openHealthSettings} />
          {status && !available ? <ListRow icon="refresh" title="Check again" onPress={refresh} /> : null}
          <Fold bare title="Last night is missing?">
            <Para first>Open Nothing X and let it sync the watch. Sleep reaches Health Connect only after that. Then tap Sync now.</Para>
            <Para>Take Nothing X out of battery optimisation so it can sync in the background.</Para>
            <Para>Sleep tracking must be on in the watch. Wear it snugly: a loose fit hurts heart-rate and stage accuracy.</Para>
            <Para>Several apps writing sleep? Pick Nothing X under Settings → Watch and data → Which app's sleep to trust.</Para>
          </Fold>
          <Fold bare title="What eepy does with it">
            <Para first>eepy only reads. It writes nothing unless you log sleep by hand and choose to save it.</Para>
            <Para>The first import brings in your history (how far back: Settings → Watch and data). After that eepy syncs every time you open it.</Para>
          </Fold>
        </ListCard>
      </Section>
    </Screen>
  );
}
