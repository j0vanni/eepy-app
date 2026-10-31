/**
 * Bedtime autopilot on Today's evening countdown: when sleep mode switches on and off tonight,
 * with Start now / Stop. Only in builds that can switch the phone's sleep mode (Android APK).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { formatTime, HOUR } from '@/engine/time';
import { activeSleepWindow, hasSleepMode, sleepModeWindow, startSleepModeNow, stopSleepModeNow } from '@/notifications/sleepMode';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { useSleepModeStatus } from '@/state/useSleepMode';
import { Button, Icon, Row } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

/** "Start now" is offered from this long before tonight's switch-on time. */
const START_EARLY_H = 3;

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
      <Row gap={space.sm} style={{ marginTop: space.md }}>
        <Icon name="moon-waning-crescent" size={18} color={colors.textFaint} />
        <Text style={[font.small, { flex: 1 }]}>Let eepy switch your phone to sleep mode at {settings.sleepMode.startAt === 'winddown' ? 'wind-down' : 'lights-out'}?</Text>
        <Button small kind="secondary" label="Set up" onPress={() => router.push('/settings')} />
      </Row>
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

  let text: string;
  let sub: string;
  if (!status.access) {
    text = 'Sleep mode needs your OK once';
    sub = 'Allow eepy under Do Not Disturb (Modes) access';
  } else if (status.active) {
    text = `Sleep mode on · off at ${formatTime(offAt)}`;
    sub = status.deviceEffects ? 'Grayscale, dimmed wallpaper, notifications silenced' : 'Notifications silenced';
  } else if (status.stoppedNight === target.night) {
    text = 'Sleep mode off for tonight';
    sub = 'Back tomorrow night';
  } else {
    text = `Sleep mode ${formatTime(onAt)} – ${formatTime(offAt)}`;
    sub = 'Switches by itself, even with eepy closed';
  }

  const canStart = status.access && !status.active && (live !== undefined || now >= onAt - START_EARLY_H * HOUR);
  return (
    <Row gap={space.sm} style={{ marginTop: space.md }}>
      <Icon name="moon-waning-crescent" size={18} color={status.active ? colors.light : colors.textDim} />
      <View style={{ flex: 1 }}>
        <Text style={[font.body, { fontVariant: ['tabular-nums'] }]}>{text}</Text>
        <Text style={font.tiny}>{sub}</Text>
      </View>
      {!status.access ? <Button small kind="secondary" label="Fix" onPress={() => router.push('/settings')} /> : null}
      {status.access && status.active ? <Button small kind="secondary" icon="stop" label="Stop" disabled={busy} onPress={() => run(() => stopSleepModeNow(target.night))} /> : null}
      {canStart ? <Button small kind="secondary" icon="moon-waning-crescent" label="Start now" disabled={busy} onPress={() => run(() => startSleepModeNow(target.night, target.off))} /> : null}
    </Row>
  );
}
