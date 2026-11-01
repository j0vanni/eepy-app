// Settings → You & schedule: about you (age, time format), your sleep need and insomnia mode.
import { router } from 'expo-router';
import { Text } from 'react-native';

import { formatDuration } from '@/engine/time';
import { systemClockFormat } from '@/state/clockFormat';
import { useStore } from '@/state/store';
import { Card, ListRow, Section, Segmented, Stepper } from '@/ui/components';
import { font, space } from '@/ui/theme';

import { Toggle } from './Toggle';

export function AboutYouSection() {
  const profile = useStore((s) => s.profile);
  const clock = useStore((s) => s.settings.clock);
  const setProfile = useStore((s) => s.setProfile);
  const setSettings = useStore((s) => s.setSettings);
  const year = new Date().getFullYear();
  return (
    <Section title="You">
      <Card>
        <Stepper
          label="Birth year"
          sub={`Age ${year - profile.birthYear} — sets the starting sleep-need estimate`}
          value={String(profile.birthYear)}
          onDec={() => setProfile({ birthYear: profile.birthYear - 1 })}
          onInc={() => setProfile({ birthYear: Math.min(year - 10, profile.birthYear + 1) })}
        />
        <Text style={[font.body, { marginTop: space.md, marginBottom: 6 }]}>Time format</Text>
        <Segmented
          value={clock}
          onChange={(c) => setSettings({ clock: c })}
          options={[
            { label: `Phone (${systemClockFormat() === '12h' ? '12h' : '24h'})`, value: 'system' },
            { label: '12-hour', value: '12h' },
            { label: '24-hour', value: '24h' },
          ]}
        />
        <Text style={[font.tiny, { marginTop: 4 }]}>How every time in eepy is shown — 7:00 AM or 07:00.</Text>
        <ListRow
          icon="calendar-week"
          title="Workdays & wake-up times"
          sub="Moved to Planner → Your usual week"
          onPress={() => router.navigate({ pathname: '/planner', params: { show: 'week' } })}
        />
      </Card>
    </Section>
  );
}

export function SleepNeedSection() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  return (
    <Section title="Sleep">
      <Card>
        <Toggle
          label="Set my sleep need myself"
          sub="Off = eepy learns how much sleep you need from your nights"
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
        <Toggle
          label="Insomnia mode"
          sub="For trouble sleeping (CBT-I rules): no naps, no extra time in bed, the same times every day"
          value={profile.insomniaMode}
          onChange={(v) => setProfile({ insomniaMode: v })}
        />
      </Card>
    </Section>
  );
}
