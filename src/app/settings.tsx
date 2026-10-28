import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Switch, Text, View } from 'react-native';

import { HALF_LIFE_OPTIONS } from '@/engine/caffeine';
import { QUIZZES, scoreQuiz } from '@/engine/screening';
import { formatClock, formatDuration, normalizeMinutes } from '@/engine/time';
import { exportBackup, pickBackup } from '@/integrations/backup';
import { summarizeOrigins } from '@/integrations/healthConnectMapper';
import { ensureNotificationPermission } from '@/state/notifications';
import { NotificationPrefs, selectDataset, useStore } from '@/state/store';
import { runSync } from '@/state/sync';
import { Button, Card, CardTitle, Chip, ListRow, Note, Row, Screen, Section, Segmented, Stepper } from '@/ui/components';
import { confirm, notify } from '@/ui/confirm';
import { relativeTime } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function Toggle({ label, sub, value, onChange }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row style={{ paddingVertical: space.sm }}>
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Text style={font.body}>{label}</Text>
        {sub ? <Text style={font.small}>{sub}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.border }} thumbColor={colors.text} />
    </Row>
  );
}

export default function SettingsScreen() {
  const profile = useStore((s) => s.profile);
  const settings = useStore((s) => s.settings);
  const sessions = useStore((s) => s.sessions);
  const setProfile = useStore((s) => s.setProfile);
  const setSettings = useStore((s) => s.setSettings);
  const setNotificationPrefs = useStore((s) => s.setNotificationPrefs);
  const loadDemo = useStore((s) => s.loadDemo);
  const resetAll = useStore((s) => s.resetAll);
  const importData = useStore((s) => s.importData);
  const [busy, setBusy] = useState(false);
  const origins = useMemo(() => summarizeOrigins(sessions.filter((s) => s.source === 'health-connect')), [sessions]);
  const year = new Date().getFullYear();

  const setNotif = async (key: keyof NotificationPrefs, value: boolean) => {
    if (value && !(await ensureNotificationPermission())) {
      notify('Notifications are off', 'Allow notifications for eepy in Android settings to get reminders and alarms.');
      return;
    }
    setNotificationPrefs({ [key]: value });
  };

  const sync = async (full: boolean) => {
    setBusy(true);
    const r = await runSync({ full });
    setBusy(false);
    notify(r.ok ? 'Synced' : 'Sync problem', r.message);
  };

  return (
    <Screen>
      <Section title="You">
        <Card>
          <Stepper
            label="Birth year"
            sub={`Age ${year - profile.birthYear} — sets the starting sleep-need estimate`}
            value={String(profile.birthYear)}
            onDec={() => setProfile({ birthYear: profile.birthYear - 1 })}
            onInc={() => setProfile({ birthYear: Math.min(year - 10, profile.birthYear + 1) })}
          />
          <Text style={[font.body, { marginTop: space.sm }]}>Workdays (days with a fixed wake-up)</Text>
          <Row gap={6} style={{ marginTop: space.sm, marginBottom: space.sm }}>
            {DAYS.map((d, i) => (
              <Chip
                key={i}
                label={d}
                selected={profile.workdays.includes(i)}
                onPress={() => setProfile({ workdays: profile.workdays.includes(i) ? profile.workdays.filter((x) => x !== i) : [...profile.workdays, i].sort() })}
              />
            ))}
          </Row>
          <Stepper
            label="Workday wake-up"
            value={formatClock(profile.workWakeMin)}
            onDec={() => setProfile({ workWakeMin: normalizeMinutes(profile.workWakeMin - 15) })}
            onInc={() => setProfile({ workWakeMin: normalizeMinutes(profile.workWakeMin + 15) })}
          />
          <Stepper
            label="Free-day wake-up"
            sub={profile.freeWakeMin === undefined ? 'Auto: at most 1h after workdays' : undefined}
            value={profile.freeWakeMin === undefined ? 'auto' : formatClock(profile.freeWakeMin)}
            onDec={() => setProfile({ freeWakeMin: normalizeMinutes((profile.freeWakeMin ?? profile.workWakeMin + 60) - 15) })}
            onInc={() => setProfile({ freeWakeMin: normalizeMinutes((profile.freeWakeMin ?? profile.workWakeMin + 60) + 15) })}
          />
          {profile.freeWakeMin !== undefined ? <Button small kind="ghost" label="Reset to auto" onPress={() => setProfile({ freeWakeMin: undefined })} /> : null}
        </Card>
      </Section>

      <Section title="Sleep & habits">
        <Card>
          <Toggle
            label="Set my sleep need manually"
            sub="Off = eepy learns it from your data"
            value={profile.sleepNeedOverrideMin !== undefined}
            onChange={(v) => setProfile({ sleepNeedOverrideMin: v ? 480 : undefined })}
          />
          {profile.sleepNeedOverrideMin !== undefined ? (
            <Stepper
              label="Sleep need"
              value={formatDuration(profile.sleepNeedOverrideMin)}
              onDec={() => setProfile({ sleepNeedOverrideMin: Math.max(300, profile.sleepNeedOverrideMin! - 5) })}
              onInc={() => setProfile({ sleepNeedOverrideMin: Math.min(720, profile.sleepNeedOverrideMin! + 5) })}
            />
          ) : null}
          <Stepper
            label="Wind-down routine"
            value={`${profile.windDownMin} min`}
            onDec={() => setProfile({ windDownMin: Math.max(15, profile.windDownMin - 15) })}
            onInc={() => setProfile({ windDownMin: Math.min(120, profile.windDownMin + 15) })}
          />
          <Text style={[font.body, { marginTop: space.sm, marginBottom: space.sm }]}>Caffeine half-life</Text>
          <Segmented value={profile.caffeineHalfLifeH} onChange={(v) => setProfile({ caffeineHalfLifeH: v })} options={HALF_LIFE_OPTIONS.map((o) => ({ label: o.label, value: o.hours }))} />
          <Text style={[font.tiny, { marginTop: 4 }]}>{HALF_LIFE_OPTIONS.find((o) => o.hours === profile.caffeineHalfLifeH)?.hint}</Text>
          <Stepper
            label="Caffeine allowed at bedtime"
            sub="Lower = earlier cut-off"
            value={`${profile.caffeineBedtimeLimitMg} mg`}
            onDec={() => setProfile({ caffeineBedtimeLimitMg: Math.max(10, profile.caffeineBedtimeLimitMg - 10) })}
            onInc={() => setProfile({ caffeineBedtimeLimitMg: Math.min(150, profile.caffeineBedtimeLimitMg + 10) })}
          />
          <Toggle
            label="Insomnia mode"
            sub="CBT-I principles: no naps, no extra time in bed, consistent schedule"
            value={profile.insomniaMode}
            onChange={(v) => setProfile({ insomniaMode: v })}
          />
        </Card>
      </Section>

      <Section title="Data sources">
        <Card>
          <CardTitle icon="watch-variant" title="CMF Watch via Health Connect" />
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
          <Text style={[font.body, { marginVertical: space.sm }]}>History to import on first sync</Text>
          <Segmented
            value={settings.historyDays}
            onChange={(v) => setSettings({ historyDays: v })}
            options={[
              { label: '30d', value: 30 },
              { label: '60d', value: 60 },
              { label: '90d', value: 90 },
              { label: '180d', value: 180 },
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
                right={settings.preferredOrigins[0] === o.origin ? <Text style={[font.tiny, { color: colors.accent }]}>PREFERRED</Text> : undefined}
                onPress={() => setSettings({ preferredOrigins: [o.origin, ...settings.preferredOrigins.filter((x) => x !== o.origin)] })}
              />
            ))}
          </Card>
        ) : null}
      </Section>

      <Section title="Notifications">
        <Card>
          <Toggle label="Wind-down reminder" sub={`${profile.windDownMin} min before lights out`} value={settings.notifications.windDown} onChange={(v) => setNotif('windDown', v)} />
          <Toggle label="Bedtime" value={settings.notifications.bedtime} onChange={(v) => setNotif('bedtime', v)} />
          <Toggle label="Caffeine cut-off" value={settings.notifications.caffeine} onChange={(v) => setNotif('caffeine', v)} />
          <Toggle label="Morning check-in" value={settings.notifications.morningCheckIn} onChange={(v) => setNotif('morningCheckIn', v)} />
          <Toggle label="Wake alarm (cycle-timed)" sub="Rings at the end of a predicted sleep cycle before your wake time" value={settings.notifications.smartAlarm} onChange={(v) => setNotif('smartAlarm', v)} />
        </Card>
      </Section>

      <Section title="Self-checks">
        <Card>
          {Object.values(QUIZZES).map((q) => {
            const r = profile.screenings[q.id];
            const band = r ? scoreQuiz(q.id, r.answers).band : undefined;
            return (
              <ListRow
                key={q.id}
                icon={{ rmeq: 'owl', ess: 'sleep', isi: 'eye-outline', stopbang: 'lungs' }[q.id]}
                title={q.title}
                sub={band ? `${r!.score} · ${band.label} (${r!.date})` : q.subtitle}
                onPress={() => router.push({ pathname: '/quiz/[id]', params: { id: q.id } })}
              />
            );
          })}
        </Card>
      </Section>

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
          <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
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

      <Section title="About">
        <Card>
          <Text style={font.small}>
            eepy {Constants.expoConfig?.version ?? ''} — sleep coaching built on published sleep science (two-process and three-process models, MCTQ chronotype, Sleep
            Regularity Index). It is not a medical device and cannot diagnose sleep disorders. If you snore loudly, stop breathing at night, or are very sleepy despite
            enough sleep, please see a doctor.
          </Text>
        </Card>
      </Section>
    </Screen>
  );
}
