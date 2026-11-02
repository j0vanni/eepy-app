// Settings → Health Connect & data: syncing the watch, which app's sleep to trust, backup, demo data and erasing.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Text } from 'react-native';

import { exportBackup, pickBackup } from '@/integrations/backup';
import { summarizeOrigins } from '@/integrations/healthConnectMapper';
import { selectDataset, useStore } from '@/state/store';
import { runSync } from '@/state/sync';
import { Button, Card, CardTitle, ListRow, Note, Row, Section, Segmented } from '@/ui/components';
import { confirm, notify } from '@/ui/confirm';
import { relativeTime } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

import { Toggle } from './Toggle';

export function DataSourcesSection() {
  const settings = useStore((s) => s.settings);
  const sessions = useStore((s) => s.sessions);
  const setSettings = useStore((s) => s.setSettings);
  const detectWake = useStore((s) => s.wakeLog.detect);
  const updateWakeLog = useStore((s) => s.updateWakeLog);
  const [busy, setBusy] = useState(false);
  const origins = useMemo(() => summarizeOrigins(sessions.filter((s) => s.source === 'health-connect')), [sessions]);

  const sync = async (full: boolean) => {
    setBusy(true);
    const r = await runSync({ full });
    setBusy(false);
    notify(r.ok ? 'Synced' : 'Sync problem', r.message);
  };

  return (
    <Section title="Data sources">
      <Card>
        <CardTitle icon="watch-variant" title="CMF Watch via Nothing X → Health Connect" />
        {Platform.OS !== 'android' ? <Note tone="info">Health Connect is Android-only. Use the APK on your phone to sync your watch.</Note> : null}
        {settings.dataMode === 'demo' ? <Note tone="info">You're in demo mode. Connecting your watch replaces the demo data.</Note> : null}
        <Text style={font.small}>
          {settings.lastSync
            ? `Last sync ${relativeTime(settings.lastSync)}${settings.lastSyncCounts ? ` · ${settings.lastSyncCounts.sessions} nights, ${settings.lastSyncCounts.heartRate.toLocaleString()} HR, ${settings.lastSyncCounts.spo2} SpO₂, ${settings.lastSyncCounts.hrv} HRV readings` : ''}`
            : 'Not synced yet.'}
        </Text>
        {settings.lastSyncError ? <Note tone="warn">{settings.lastSyncError}</Note> : null}
        <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
          <Button small icon="link-variant" label="Connect / permissions" onPress={() => router.push('/connect')} />
          {settings.dataMode === 'live' ? <Button small kind="secondary" icon="sync" label={busy ? 'Syncing…' : 'Sync now'} disabled={busy} onPress={() => sync(false)} /> : null}
          {settings.dataMode === 'live' ? <Button small kind="ghost" label="Full re-sync" disabled={busy} onPress={() => sync(true)} /> : null}
        </Row>
        <Toggle label="Sync automatically" sub="When you open the app (at most every 15 min)" value={settings.autoSync} onChange={(v) => setSettings({ autoSync: v })} />
        <Toggle
          label="Detect when I'm actually up"
          sub="Ends the night when you open eepy, stop the alarm or walk around — even if the watch kept recording"
          value={detectWake}
          onChange={(v) => updateWakeLog((log) => ({ ...log, detect: v }))}
        />
        <Text style={[font.body, { marginTop: space.sm }]}>History to import on first sync</Text>
        <Text style={[font.small, { marginBottom: space.sm }]}>How many past days to bring in from Health Connect.</Text>
        <Segmented
          value={settings.historyDays}
          onChange={(v) => setSettings({ historyDays: v })}
          options={[
            { label: '30 days', value: 30 },
            { label: '60', value: 60 },
            { label: '90', value: 90 },
            { label: '180', value: 180 },
          ]}
        />
      </Card>
      {origins.length > 0 ? (
        <Card>
          <CardTitle icon="source-branch" title="Which app's sleep to trust" />
          <Text style={[font.small, { marginBottom: space.sm }]}>If several apps write sleep to Health Connect, eepy prefers this one when nights overlap.</Text>
          {origins.map((o) => (
            <ListRow
              key={o.origin}
              icon={o.likelyWatch ? 'watch' : 'cellphone'}
              title={o.label}
              sub={`${o.sessions} sessions${o.staged ? ' · with sleep stages' : ' · no stages'} · ${o.origin}`}
              right={settings.preferredOrigins[0] === o.origin ? <Text style={[font.label, { color: colors.accent }]}>PREFERRED</Text> : undefined}
              onPress={() => setSettings({ preferredOrigins: [o.origin, ...settings.preferredOrigins.filter((x) => x !== o.origin)] })}
            />
          ))}
        </Card>
      ) : null}
    </Section>
  );
}

export function YourDataSection() {
  const loadDemo = useStore((s) => s.loadDemo);
  const resetAll = useStore((s) => s.resetAll);
  const importData = useStore((s) => s.importData);
  return (
    <Section title="Your data">
      <Card>
        <Text style={[font.small, { marginBottom: space.md }]}>Everything stays on this phone. Back it up before switching phones.</Text>
        <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
          <Button small icon="export" kind="secondary" label="Export backup" onPress={() => exportBackup(selectDataset(useStore.getState())).catch((e) => notify('Export failed', String(e)))} />
          <Button
            small
            icon="import"
            kind="secondary"
            label="Restore backup"
            onPress={async () => {
              try {
                const data = await pickBackup();
                if (data && (await confirm('Restore backup?', `This replaces everything with ${data.sessions.length} sessions from the backup.`, 'Restore', true))) importData(data);
              } catch (e) {
                notify('Restore failed', e instanceof Error ? e.message : String(e));
              }
            }}
          />
        </Row>
        <ListRow icon="file-chart-outline" title="Reports & export" sub="PDF report for you or your doctor · CSV of every night" onPress={() => router.push('/export')} />
        <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
          <Button
            small
            kind="ghost"
            icon="flask-outline"
            label="Load demo data"
            onPress={async () => {
              if (await confirm('Load demo data?', 'This replaces your data with 9 weeks of simulated nights.', 'Load demo', true)) loadDemo();
            }}
          />
          <Button
            small
            kind="danger"
            icon="delete-outline"
            label="Erase everything"
            onPress={async () => {
              if (await confirm('Erase all data?', 'Sleep, journal, caffeine and settings will be deleted from this phone. Health Connect data is not touched.', 'Erase', true)) {
                resetAll();
                router.replace('/onboarding');
              }
            }}
          />
        </Row>
      </Card>
    </Section>
  );
}
