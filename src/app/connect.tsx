import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Text, View } from 'react-native';

import { getPermissionState, healthConnectStatus, HCStatus, openHealthSettings, PermissionState, requestHealthPermissions } from '@/integrations/healthConnect';
import { summarizeOrigins } from '@/integrations/healthConnectMapper';
import { useStore } from '@/state/store';
import { runSync } from '@/state/sync';
import { Button, Card, CardTitle, Icon, Note, Row, Screen, Section } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <Card accent={done ? colors.good : undefined}>
      <Row gap={space.sm} style={{ marginBottom: space.sm }}>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: done ? colors.good : colors.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {done ? <Icon name="check" size={16} color={colors.bg} /> : <Text style={[font.small, { color: colors.text, fontWeight: '700' }]}>{n}</Text>}
        </View>
        <Text style={[font.h3, { flex: 1 }]}>{title}</Text>
      </Row>
      {children}
    </Card>
  );
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
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
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
        <Note tone="info">
          Connecting the CMF Watch works in the Android app (APK). Health Connect — where Nothing X stores your watch's sleep — only exists on Android phones.
        </Note>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Text style={font.body}>
          Your CMF Watch 3 Pro talks Bluetooth to the <Text style={{ fontWeight: '700' }}>Nothing X</Text> app, which shares sleep stages, heart rate, HRV, blood oxygen and steps
          with <Text style={{ fontWeight: '700' }}>Health Connect</Text>. eepy reads them from there — no extra pairing needed.
        </Text>
        <Row gap={space.sm} style={{ marginTop: space.md, justifyContent: 'center' }}>
          <Icon name="watch-variant" color={colors.accent} size={26} />
          <Icon name="arrow-right" color={colors.textFaint} />
          <Icon name="cellphone" color={colors.accent} size={26} />
          <Icon name="arrow-right" color={colors.textFaint} />
          <Icon name="heart-plus-outline" color={colors.good} size={26} />
          <Icon name="arrow-right" color={colors.textFaint} />
          <Icon name="weather-night" color={colors.energy} size={26} />
        </Row>
      </Card>

      <Step n={1} title="Health Connect on this phone" done={status === 'available'}>
        {status === undefined ? <ActivityIndicator color={colors.accent} /> : null}
        {status === 'available' ? <Text style={font.small}>Health Connect is ready.</Text> : null}
        {status === 'not-installed' || status === 'update-required' ? (
          <>
            <Text style={[font.small, { marginBottom: space.sm }]}>
              {status === 'update-required' ? 'Health Connect needs an update.' : 'Health Connect is built into Android 14+. On older Android, install it from the Play Store.'}
            </Text>
            <Button
              small
              icon="google-play"
              label={status === 'update-required' ? 'Update Health Connect' : 'Get Health Connect'}
              onPress={() => Linking.openURL('market://details?id=com.google.android.apps.healthdata').catch(() => Linking.openURL('https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata'))}
            />
            <View style={{ height: space.sm }} />
            <Button small kind="ghost" label="Check again" onPress={refresh} />
          </>
        ) : null}
      </Step>

      <Step n={2} title="Nothing X shares your watch data" done={!!watchSource}>
        {watchSource ? (
          <Text style={font.small}>
            Found {watchSource.sessions} sleep session{watchSource.sessions === 1 ? '' : 's'} from {watchSource.label}
            {watchSource.staged ? ', with sleep stages' : ''}.
          </Text>
        ) : (
          <>
            {lastSync && dataMode === 'live' ? (
              <Note tone="warn">
                {origins.length
                  ? `Synced, but no sleep from Nothing X yet — only from ${origins.map((o) => o.label).join(', ')}.`
                  : 'Synced, but Health Connect has no sleep from Nothing X yet.'}
              </Note>
            ) : null}
            <Text style={font.small}>
              In Nothing X, open your CMF Watch 3 Pro and make sure Health Connect sharing is on for Sleep, Heart rate, Heart rate variability, Blood oxygen, Respiratory
              rate and Steps. To double-check, Health Connect → App permissions → Nothing X should be allowed to write them.
            </Text>
            <Text style={[font.tiny, { marginTop: space.sm }]}>
              Sleep reaches Health Connect only after Nothing X syncs with the watch: open Nothing X, let it finish syncing, then tap Sync now below.
            </Text>
          </>
        )}
        <View style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
          <Button small kind="secondary" icon="open-in-new" label="Open Health Connect" onPress={openHealthSettings} />
        </View>
      </Step>

      <Step n={3} title="Let eepy read your data" done={!!perms?.sleep}>
        {perms?.sleep ? (
          <Text style={font.small}>{perms.all ? 'All permissions granted.' : 'Sleep access granted. Grant the rest for HRV, SpO₂ and readiness insights.'}</Text>
        ) : (
          <Text style={[font.small, { marginBottom: space.sm }]}>eepy only reads. It writes nothing unless you log sleep manually and choose to save it.</Text>
        )}
        {!perms?.all ? (
          <View style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
            <Button small icon="shield-check-outline" label="Grant permissions" disabled={status !== 'available' || busy} onPress={grant} />
          </View>
        ) : null}
      </Step>

      <Step n={4} title="Import your nights" done={!!lastSync && dataMode === 'live'}>
        <Text style={[font.small, { marginBottom: space.sm }]}>
          Pulls your history (Settings → history length) and keeps syncing every time you open eepy.{dataMode === 'demo' ? ' This replaces the demo data.' : ''}
        </Text>
        {busy ? <ActivityIndicator color={colors.accent} /> : <Button small icon="sync" label="Sync now" disabled={!perms?.sleep} onPress={sync} />}
        {message ? (
          <Note tone={message.ok ? 'good' : 'warn'}>
            {message.text}
          </Note>
        ) : null}
        {message?.ok ? (
          <View style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
            <Button small kind="secondary" label="Go to Today" onPress={() => router.replace('/')} />
          </View>
        ) : null}
      </Step>

      <Section title="Troubleshooting">
        <Card>
          <CardTitle icon="lifebuoy" title="Last night is missing?" />
          <Text style={font.small}>
            • Open Nothing X and let it sync the watch — sleep reaches Health Connect only after the watch syncs.{'\n'}• Exclude Nothing X from battery optimisation so it
            can sync in the background.{'\n'}• Sleep tracking must be enabled on the watch (it records automatically when worn).{'\n'}• Wear the watch snugly
            — loose fit hurts heart-rate and stage accuracy.{'\n'}• Several apps writing sleep (e.g. a phone sleep tracker)? Pick Nothing X under Settings → "Which app's sleep
            to trust".
          </Text>
        </Card>
      </Section>
    </Screen>
  );
}
