// Settings → You & schedule: about you (age, time format, where the schedule lives) and your sleep
// need, insomnia mode and the insomnia programme.
import { router } from 'expo-router';
import { useMemo } from 'react';

import { CBTI_WEEKS, cbtiStatus } from '@/engine/cbti';
import { formatClock, formatDuration } from '@/engine/time';
import { systemClockFormat } from '@/state/clockFormat';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { ListCard, ListRow, Section, Stepper } from '@/ui/components';

import { ChoiceRow } from './parts';
import { Toggle } from './Toggle';

export function AboutYouSection() {
  const profile = useStore((s) => s.profile);
  const clock = useStore((s) => s.settings.clock);
  const setProfile = useStore((s) => s.setProfile);
  const setSettings = useStore((s) => s.setSettings);
  const year = new Date().getFullYear();
  return (
    <Section title="About you">
      <ListCard>
        <Stepper
          label="Birth year"
          sub={`Age ${year - profile.birthYear}. Where your sleep-need estimate starts.`}
          value={String(profile.birthYear)}
          onDec={() => setProfile({ birthYear: profile.birthYear - 1 })}
          onInc={() => setProfile({ birthYear: Math.min(year - 10, profile.birthYear + 1) })}
        />
        <ChoiceRow
          title="Time format"
          value={clock}
          onChange={(c) => setSettings({ clock: c })}
          options={[
            { label: `Phone (${systemClockFormat() === '12h' ? '12h' : '24h'})`, value: 'system' },
            { label: '12-hour', value: '12h' },
            { label: '24-hour', value: '24h' },
          ]}
          hint="How every time in eepy is shown: 7:00 AM or 07:00."
        />
        <ListRow title="Workdays and wake-up times" sub="Plan › Your usual week" onPress={() => router.navigate({ pathname: '/planner', params: { show: 'week' } })} />
      </ListCard>
    </Section>
  );
}

export function SleepNeedSection() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const a = useAnalysis();
  const program = useStore((s) => s.cbti);
  const status = useMemo(() => (a && program?.active ? cbtiStatus(program, a.nights, a.day) : undefined), [a, program]);
  const own = profile.sleepNeedOverrideMin;

  const programmeSub = status
    ? `${status.maintenance ? `Week ${status.week}, maintenance` : `Week ${status.week} of ${CBTI_WEEKS}`} · in bed ${formatClock(status.bedMin)}–${formatClock(status.wakeMin)}`
    : program?.stoppedAt
      ? 'Stopped. Start again any time.'
      : 'Six weeks for trouble sleeping. Not started.';

  return (
    <Section title="Sleep need">
      <ListCard>
        <Toggle label="Set my sleep need myself" sub="Off: eepy learns it from your nights" value={own !== undefined} onChange={(v) => setProfile({ sleepNeedOverrideMin: v ? 480 : undefined })} />
        {own !== undefined ? (
          <Stepper
            label="Sleep need"
            value={formatDuration(own)}
            onDec={() => setProfile({ sleepNeedOverrideMin: Math.max(300, own - 5) })}
            onInc={() => setProfile({ sleepNeedOverrideMin: Math.min(720, own + 5) })}
          />
        ) : null}
        <Toggle
          label="Insomnia mode"
          sub="No naps, no extra time in bed, the same times every day"
          value={profile.insomniaMode}
          onChange={(v) => setProfile({ insomniaMode: v })}
        />
        <ListRow title="Insomnia programme" sub={programmeSub} onPress={() => router.push('/cbti')} />
      </ListCard>
    </Section>
  );
}
