// Settings → Watch and data: syncing the watch, re-reading the history, which app's sleep to trust,
// backup (save to a folder, share, restore), demo data and erasing. What an action did is shown on
// the page, not in an alert that can be missed.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';

import { pickBackup, saveBackup, shareBackup } from '@/integrations/backup';
import { summarizeOrigins } from '@/integrations/healthConnectMapper';
import { selectDataset, useStore } from '@/state/store';
import { HOURLY_BACKFILL_MARK, runSync } from '@/state/sync';
import { Banner, Button, Icon, ListCard, ListRow, Note, Section } from '@/ui/components';
import { confirm } from '@/ui/confirm';
import { relativeTime } from '@/ui/format';
import { colors, iconSize, space } from '@/ui/theme';

import { ChoiceRow, errorText, Outcome, OutcomeState } from './parts';
import { Toggle } from './Toggle';

/** The watch: sync status, Sync now, re-reading the whole history, and what syncing does. */
export function DataSourcesSection() {
  const settings = useStore((s) => s.settings);
  const sessions = useStore((s) => s.sessions);
  const setSettings = useStore((s) => s.setSettings);
  const detectWake = useStore((s) => s.wakeLog.detect);
  const updateWakeLog = useStore((s) => s.updateWakeLog);
  const [busy, setBusy] = useState<'sync' | 'full'>();
  const [result, setResult] = useState<OutcomeState>();
  const origins = useMemo(() => summarizeOrigins(sessions.filter((s) => s.source === 'health-connect')), [sessions]);
  const live = settings.dataMode === 'live';
  const counts = settings.lastSyncCounts;
  const reRead = !!settings.marks[HOURLY_BACKFILL_MARK];

  const sync = async (full: boolean) => {
    if (busy) return;
    setBusy(full ? 'full' : 'sync');
    setResult(undefined);
    const r = await runSync({ full });
    setBusy(undefined);
    // A failure is usually kept in settings.lastSyncError, which the banner shows.
    if (r.ok) setResult({ tone: 'good', text: r.message });
    else if (useStore.getState().settings.lastSyncError !== r.message) setResult({ tone: 'bad', text: r.message });
  };

  return (
    <>
      <Section title="Your watch">
        {settings.lastSyncError ? <Banner tone="warn" text={settings.lastSyncError} action="Fix" onAction={() => router.push('/connect')} /> : null}
        {Platform.OS !== 'android' ? <Note tone="info">Health Connect is Android only. Use the APK on your phone to sync your watch.</Note> : null}
        {settings.dataMode === 'demo' ? <Note tone="info">You're looking at demo data. Connecting your watch replaces it.</Note> : null}
        <ListCard>
          <ListRow
            icon="watch-variant"
            title={settings.lastSync ? `Synced ${relativeTime(settings.lastSync)}` : 'Not synced yet'}
            sub={
              settings.lastSync && counts
                ? `${counts.sessions} nights · ${counts.heartRate.toLocaleString()} heart-rate, ${counts.hrv} HRV and ${counts.spo2} blood-oxygen readings`
                : 'CMF Watch → Nothing X → Health Connect → eepy'
            }
          />
          {live ? <ListRow icon="sync" title={busy === 'sync' ? 'Syncing…' : 'Sync now'} onPress={() => sync(false)} /> : null}
          {live ? (
            <ListRow
              icon="history"
              title={busy === 'full' ? 'Reading your history…' : 'Re-read my whole history'}
              sub={reRead ? 'Reads every day again, with heart rate and steps per hour' : 'Do this once: eepy needs your daytime heart rate and steps per hour'}
              onPress={() => sync(true)}
            />
          ) : null}
          <ListRow icon="link-variant" title="Connection and permissions" onPress={() => router.push('/connect')} />
        </ListCard>
        <Outcome status={result} />
      </Section>

      <Section title="Syncing">
        <ListCard>
          <Toggle label="Sync automatically" sub="When you open eepy, at most every 15 min" value={settings.autoSync} onChange={(v) => setSettings({ autoSync: v })} />
          <Toggle
            label="Detect when I'm actually up"
            sub="Ends the night when you open eepy, stop the alarm or walk around, even if the watch kept recording"
            value={detectWake}
            onChange={(v) => updateWakeLog((log) => ({ ...log, detect: v }))}
          />
          <ChoiceRow
            title="History length"
            sub="How far back the first sync and a re-read go"
            value={settings.historyDays}
            onChange={(v) => setSettings({ historyDays: v })}
            options={[30, 60, 90, 180].map((d) => ({ label: `${d} days`, value: d }))}
          />
        </ListCard>
      </Section>

      {origins.length > 0 ? (
        <Section title="Which app's sleep to trust">
          <ListCard>
            {origins.map((o) => {
              const preferred = settings.preferredOrigins[0] === o.origin;
              return (
                <ListRow
                  key={o.origin}
                  icon={o.likelyWatch ? 'watch' : 'cellphone'}
                  title={o.label}
                  sub={`${o.sessions} nights · ${o.staged ? 'with sleep stages' : 'no stages'} · ${o.origin}`}
                  right={<Icon name={preferred ? 'radiobox-marked' : 'radiobox-blank'} size={iconSize.lg} color={preferred ? colors.accent : colors.textFaint} />}
                  onPress={() => setSettings({ preferredOrigins: [o.origin, ...settings.preferredOrigins.filter((x) => x !== o.origin)] })}
                />
              );
            })}
          </ListCard>
          <Note tone="info">When several apps write sleep to Health Connect and nights overlap, eepy uses the one you pick.</Note>
        </Section>
      ) : null}
    </>
  );
}

/** Backup (save, share, restore), reports, demo data and erasing. */
export function YourDataSection() {
  const loadDemo = useStore((s) => s.loadDemo);
  const resetAll = useStore((s) => s.resetAll);
  const importData = useStore((s) => s.importData);
  const [busy, setBusy] = useState<'save' | 'share' | 'restore'>();
  const [status, setStatus] = useState<OutcomeState>();
  const web = Platform.OS === 'web';

  const backup = async (how: 'save' | 'share') => {
    setBusy(how);
    setStatus(undefined);
    try {
      const data = selectDataset(useStore.getState());
      const outcome = await (how === 'save' ? saveBackup(data) : shareBackup(data));
      setStatus(
        outcome === 'cancelled'
          ? { tone: 'info', text: 'Cancelled. Nothing was saved.' }
          : outcome === 'shared'
            ? { tone: 'info', text: 'The share sheet was opened. If no app there took the file, use "Save backup to a folder".' }
            : { tone: 'good', text: web ? 'Backup downloaded.' : 'Backup saved to the folder you picked.' },
      );
    } catch (e) {
      setStatus({ tone: 'bad', text: `Couldn't ${how} the backup. ${errorText(e)}` });
    } finally {
      setBusy(undefined);
    }
  };

  const restore = async () => {
    setBusy('restore');
    setStatus(undefined);
    try {
      const data = await pickBackup();
      if (!data) setStatus({ tone: 'info', text: 'Cancelled. Nothing was restored.' });
      else if (await confirm('Restore backup?', `This replaces everything with ${data.sessions.length} sessions from the backup.`, 'Restore', true)) {
        importData(data);
        setStatus({ tone: 'good', text: `Restored ${data.sessions.length} sessions from the backup.` });
      } else setStatus({ tone: 'info', text: 'Cancelled. Nothing was restored.' });
    } catch (e) {
      setStatus({ tone: 'bad', text: `Couldn't restore. ${errorText(e)}` });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <Section title="Backup">
        <View style={{ gap: space.sm, marginBottom: space.md }}>
          <Button
            label={busy === 'save' ? 'Saving…' : web ? 'Download backup' : 'Save backup to a folder'}
            icon={web ? 'download' : 'folder-download-outline'}
            onPress={() => backup('save')}
            disabled={!!busy}
          />
          {web ? null : <Button kind="secondary" label={busy === 'share' ? 'Opening…' : 'Share backup'} icon="share-variant-outline" onPress={() => backup('share')} disabled={!!busy} />}
        </View>
        <Outcome status={status} />
        <ListCard>
          <ListRow icon="backup-restore" title={busy === 'restore' ? 'Restoring…' : 'Restore a backup'} sub="Replaces everything on this phone with the file" onPress={busy ? undefined : restore} />
          <ListRow icon="file-chart-outline" title="Reports" sub="A PDF for you or your doctor, a CSV of every night" onPress={() => router.push('/export')} />
        </ListCard>
        <Note tone="info">Everything stays on this phone. Save a backup before you switch phones.</Note>
      </Section>

      <Section title="Start over">
        <ListCard>
          <ListRow
            icon="flask-outline"
            title="Load demo data"
            sub="Replaces your data with 9 weeks of made-up nights"
            onPress={async () => {
              if (await confirm('Load demo data?', 'This replaces your data with 9 weeks of simulated nights.', 'Load demo', true)) loadDemo();
            }}
          />
          <ListRow
            icon="delete-outline"
            iconColor={colors.bad}
            title="Erase everything"
            sub="Sleep, journal, caffeine and settings on this phone"
            onPress={async () => {
              if (await confirm('Erase all data?', 'Sleep, journal, caffeine and settings will be deleted from this phone. Health Connect data is not touched.', 'Erase', true)) {
                resetAll();
                router.replace('/onboarding');
              }
            }}
          />
        </ListCard>
      </Section>
    </>
  );
}
