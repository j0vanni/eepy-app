/**
 * Settings → Wind-down & phone light → Bedtime autopilot: the phone's own sleep mode ("eepy sleep",
 * an Android mode) from lights-out or the start of wind-down until the morning alarm. Scheduled
 * natively, so it works while eepy is closed (notifications/sleepMode.ts, the native SleepMode.kt).
 */
import { useState } from 'react';
import { Platform, Text } from 'react-native';

import { formatTime, HOUR } from '../../engine/time';
import {
  activeSleepWindow,
  getSleepModeStatus,
  hasSleepMode,
  openSleepModeAccessSettings,
  openSleepModeSettings,
  sleepModeWindow,
  sleepSoundsLabel,
  startSleepModeNow,
  stopSleepModeNow,
} from '../../notifications/sleepMode';
import { SleepModeSettings, useStore } from '../../state/store';
import { useAnalysis, useNow } from '../../state/useAnalysis';
import { useSleepModeStatus } from '../../state/useSleepMode';
import { Fold, ListCard, ListRow, Note, Section } from '../components';
import { confirm, notify } from '../confirm';
import { colors, font, space } from '../theme';
import { Choice, ChoiceRow, Para } from './parts';
import { Toggle } from './Toggle';

const START_OPTIONS: Choice<SleepModeSettings['startAt']>[] = [
  { label: 'At lights-out', value: 'lightsout' },
  { label: 'At wind-down', value: 'winddown' },
];
/** "Start now" is offered from this long before tonight's switch-on time. */
const START_EARLY_H = 3;

/** Android version name for an API level (29 → 10 … 35 → 15). */
function androidVersion(sdk: number): string {
  if (sdk >= 36) return String(sdk - 20);
  return ({ 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15' } as Record<number, string>)[sdk] ?? `API ${sdk}`;
}

export function SleepModeSection() {
  const settings = useStore((s) => s.settings);
  const sleepMode = settings.sleepMode;
  const setSleepMode = useStore((s) => s.setSleepModeSettings);
  const analysis = useAnalysis();
  const now = useNow(30_000);
  const { status, refresh } = useSleepModeStatus();
  const [busy, setBusy] = useState(false);
  const available = hasSleepMode();

  const window = analysis ? sleepModeWindow(analysis, settings, now) : undefined;
  const live = activeSleepWindow(status, now);
  // What's actually planned natively for tonight (it may have been started early), else eepy's plan.
  const planned = window ? status?.windows.find((w) => w.night === window.night) : undefined;
  const onAt = planned?.onAt ?? window?.on;
  const offAt = planned?.offAt ?? window?.off;
  const target = live ? { night: live.night, off: live.offAt } : window ? { night: window.night, off: window.off } : undefined;
  const stoppedTonight = !!target && status?.stoppedNight === target.night && !status?.active;
  const canStart = !!target && (live !== undefined || (onAt !== undefined && now >= onAt - START_EARLY_H * HOUR));

  const askForAccess = async () => {
    const go = await confirm(
      'Allow eepy to switch sleep mode',
      'Android asks once. On the next screen find eepy and allow "Do Not Disturb" (or "Modes") access. eepy only switches its own "eepy sleep" mode.',
      'Open settings',
    );
    if (go && !(await openSleepModeAccessSettings())) notify('Settings', 'Open Settings → Notifications → Do Not Disturb access (or Modes) and allow eepy.');
  };

  const toggle = async (enabled: boolean) => {
    setSleepMode({ enabled });
    if (enabled && status && status.supported && !status.access) await askForAccess();
  };

  const run = async (action: () => Promise<boolean>, failTitle: string) => {
    if (busy) return;
    setBusy(true);
    const ok = await action();
    setBusy(false);
    refresh();
    if (!ok) {
      const latest = await getSleepModeStatus();
      notify(failTitle, latest?.lastError ?? 'Android did not allow it. Check that eepy has Do Not Disturb (Modes) access.');
    }
  };

  const customise = () => {
    openSleepModeSettings()
      .then((ok) => !ok && notify('Settings', 'Open Settings → Modes (or Do Not Disturb) to change what "eepy sleep" lets through.'))
      .catch(() => undefined);
  };

  // What the mode does on this phone.
  let capability: string | undefined;
  if (!status) capability = undefined;
  else if (!status.supported) capability = `Needs Android 10 or newer (this phone runs Android ${androidVersion(status.sdk)}).`;
  else if (status.deviceEffects) {
    capability = `Android ${androidVersion(status.sdk)}: the phone's own sleep mode — grayscale screen, dimmed wallpaper, dark theme and no always-on display, with notifications silenced.`;
  } else {
    capability = `On Android ${androidVersion(status.sdk)} this only silences notifications (a Do Not Disturb rule). Grayscale, dimmed wallpaper and dark theme need Android 15.`;
  }

  let state: string | undefined;
  if (sleepMode.enabled && status?.supported) {
    if (status.active) state = live ? `On now · off at ${formatTime(live.offAt)}` : 'On now';
    else if (stoppedTonight) state = 'Stopped for tonight. Back tomorrow night.';
    else if (onAt !== undefined && offAt !== undefined) state = status.access ? 'Scheduled. Switches by itself, even with eepy closed.' : 'Waiting for access';
  }

  const on = sleepMode.enabled;
  const ready = on && available && !!status?.supported;
  const access = !!status?.access;

  return (
    <Section title="Sleep mode at bedtime">
      {Platform.OS !== 'android' ? <Note tone="info">Android only. Use the eepy APK on your phone.</Note> : null}
      {Platform.OS === 'android' && !available ? <Note tone="info">Needs the latest eepy APK.</Note> : null}
      {on && status?.supported && !access ? (
        <Note tone="warn" icon="shield-lock-outline">
          eepy can't switch sleep mode yet: allow it once under Do Not Disturb (Modes) access.
        </Note>
      ) : null}
      {on && status?.lastError && access ? <Note tone="warn">Last problem: {status.lastError}</Note> : null}
      {on && status?.supported && access && !status.exactAlarms ? <Note tone="info">Exact alarms are off for eepy, so sleep mode may switch a few minutes late.</Note> : null}
      <ListCard>
        <Toggle
          label="Bedtime autopilot"
          sub="Your phone's sleep mode switches on at bedtime and off at your alarm"
          value={on}
          onChange={(v) => {
            toggle(v).catch(() => undefined);
          }}
        />
        {on ? <ChoiceRow title="Switch on" value={sleepMode.startAt} options={START_OPTIONS} onChange={(startAt) => setSleepMode({ startAt })} /> : null}
        {on ? (
          <Toggle label="Offer sleep sounds" sub={`A notification asks to play ${sleepSoundsLabel(settings.audio)}`} value={sleepMode.offerSounds} onChange={(offerSounds) => setSleepMode({ offerSounds })} />
        ) : null}
        {on && onAt !== undefined && offAt !== undefined ? (
          <ListRow
            icon={status?.active ? 'moon-waning-crescent' : 'clock-outline'}
            iconColor={status?.active ? colors.sleep : undefined}
            title={`Tonight: on ${formatTime(onAt)} · off ${formatTime(offAt)}${window && !window.offAtAlarm ? ' (wake-up)' : ' (alarm)'}`}
            sub={state}
          />
        ) : on && !analysis ? (
          <ListRow icon="clock-outline" title="Tonight's times" sub="They appear once eepy has your sleep data" />
        ) : null}
        {ready && !access ? <ListRow icon="shield-check-outline" title="Allow access" onPress={() => askForAccess().catch(() => undefined)} /> : null}
        {ready && access && target && status?.active ? <ListRow icon="stop" title="Stop now" onPress={() => run(() => stopSleepModeNow(target.night), 'Sleep mode')} /> : null}
        {ready && access && target && !status?.active && canStart ? (
          <ListRow icon="moon-waning-crescent" title="Start now" onPress={() => run(() => startSleepModeNow(target.night, target.off), 'Sleep mode')} />
        ) : null}
        {ready && access ? <ListRow icon="tune-variant" title={status?.deviceEffects ? 'Customise the mode' : 'Do Not Disturb settings'} onPress={customise} /> : null}
        <Fold bare title="How it works">
          <Para first>
            "eepy sleep" turns on {sleepMode.startAt === 'winddown' ? 'when wind-down starts' : 'at lights-out'} and off when your alarm starts. It follows tonight's plan (and "Adjust tonight"), even while eepy
            is closed. Alarms and sleep sounds always get through.
          </Para>
          {status?.deviceEffects && access ? (
            <Para>"eepy sleep" is listed with your phone's modes{status.userManaged ? ' (Settings → Modes)' : ''}: choose there who may still call and which apps may notify you.</Para>
          ) : null}
        </Fold>
      </ListCard>
      {capability ? <Text style={[font.small, { paddingHorizontal: space.xs }]}>{capability}</Text> : null}
    </Section>
  );
}
