/**
 * Bedtime autopilot on Today's evening countdown: when sleep mode switches on and off tonight,
 * with Start now / Stop. Only in builds that can switch the phone's sleep mode (Android APK).
 * A plain row with no panel of its own: it sits under the alarm row inside one Card, so it draws
 * the hairline between the two.
 */
import { router } from 'expo-router';
import { useState } from 'react';

import type { Analysis } from '@/engine/analysis';
import { formatTime, HOUR } from '@/engine/time';
import { activeSleepWindow, hasSleepMode, sleepModeWindow, startSleepModeNow, stopSleepModeNow } from '@/notifications/sleepMode';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { useSleepModeStatus } from '@/state/useSleepMode';
import { Button, Divider, ListRow } from '@/ui/components';
import { colors } from '@/ui/theme';

/** "Start now" is offered from this long before tonight's switch-on time. */
const START_EARLY_H = 3;

const openSetup = () => router.push({ pathname: '/settings/[section]', params: { section: 'winddown' } });

export function SleepModeLine({ a }: { a: Analysis }) {
  if (!hasSleepMode()) return null;
  return <SleepModeLineInner a={a} />;
}

function SleepModeLineInner({ a }: { a: Analysis }) {
  const now = useNow(30_000);
  const settings = useStore((s) => s.settings);
  const { status, refresh } = useSleepModeStatus();
  const [busy, setBusy] = useState(false);

  if (!settings.sleepMode.enabled) {
    return (
      <>
        <Divider spacing={0} />
        <ListRow
          icon="moon-waning-crescent"
          iconColor={colors.textFaint}
          title="Sleep mode"
          sub={`Let eepy switch your phone to it at ${settings.sleepMode.startAt === 'winddown' ? 'wind-down' : 'lights-out'}.`}
          right={<Button small kind="secondary" label="Set up" onPress={openSetup} />}
        />
      </>
    );
  }

  const window = sleepModeWindow(a, settings, now);
  const live = activeSleepWindow(status, now);
  const planned = window ? status?.windows.find((w) => w.night === window.night) : undefined;
  const onAt = planned?.onAt ?? window?.on;
  const offAt = live?.offAt ?? planned?.offAt ?? window?.off;
  const target = live ? { night: live.night, off: live.offAt } : window ? { night: window.night, off: window.off } : undefined;
  if (!status || onAt === undefined || offAt === undefined || !target) return null;

  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    await action();
    setBusy(false);
    refresh();
  };

  let title: string;
  let sub: string;
  if (!status.access) {
    title = 'Sleep mode needs your OK once';
    sub = 'Allow eepy under Do Not Disturb (Modes) access.';
  } else if (status.active) {
    title = `Sleep mode on · off at ${formatTime(offAt)}`;
    sub = status.deviceEffects ? 'Grayscale, dimmed wallpaper, notifications silenced.' : 'Notifications silenced.';
  } else if (status.stoppedNight === target.night) {
    title = 'Sleep mode off for tonight';
    sub = 'Back tomorrow night.';
  } else {
    title = `Sleep mode ${formatTime(onAt)} – ${formatTime(offAt)}`;
    sub = 'Switches by itself, even with eepy closed.';
  }

  const canStart = status.access && !status.active && (live !== undefined || now >= onAt - START_EARLY_H * HOUR);
  // At most one of these applies at a time.
  const action = !status.access ? (
    <Button small kind="secondary" label="Fix" onPress={openSetup} />
  ) : status.active ? (
    <Button small kind="secondary" icon="stop" label="Stop" disabled={busy} onPress={() => run(() => stopSleepModeNow(target.night))} />
  ) : canStart ? (
    <Button small kind="secondary" icon="moon-waning-crescent" label="Start now" disabled={busy} onPress={() => run(() => startSleepModeNow(target.night, target.off))} />
  ) : undefined;
  return (
    <>
      <Divider spacing={0} />
      <ListRow icon="moon-waning-crescent" iconColor={status.active ? colors.sleep : colors.textDim} title={title} sub={sub} right={action} />
    </>
  );
}
