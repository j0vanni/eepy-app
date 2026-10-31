/**
 * Bedtime autopilot: the phone's own sleep mode ("eepy sleep", an Android mode) from lights-out or
 * the start of wind-down until the morning alarm. Scheduled natively, so it works while eepy is
 * closed (see notifications/sleepMode.ts and the native module's SleepMode.kt).
 */
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';

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
import { Button, Card, CardTitle, Icon, Note, Row, Section, Segmented } from '../components';
import { confirm, notify } from '../confirm';
import { colors, font, space } from '../theme';
import { Toggle } from './Toggle';

const START_OPTIONS: { label: string; value: SleepModeSettings['startAt'] }[] = [
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
    setBusy(true);
    const ok = await action();
    setBusy(false);
    refresh();
    if (!ok) {
      const latest = await getSleepModeStatus();
      notify(failTitle, latest?.lastError ?? 'Android did not allow it. Check that eepy has Do Not Disturb (Modes) access.');
    }
  };

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
    else if (stoppedTonight) state = 'Stopped for tonight — back tomorrow night';
    else if (onAt !== undefined && offAt !== undefined) state = status.access ? 'Scheduled — switches by itself, even with eepy closed' : 'Waiting for access';
  }

  return (
    <Section title="Bedtime autopilot">
      <Card>
        <CardTitle icon="moon-waning-crescent" title="Sleep mode at bedtime" />
        <Text style={font.small}>
          Turns on "eepy sleep" — your phone's sleep mode — {sleepMode.startAt === 'winddown' ? 'when wind-down starts' : 'at lights-out'} and off when your alarm starts,
          following tonight's plan (and "Adjust tonight"), even while eepy is closed. Alarms and sleep sounds always get through.
        </Text>
        {capability ? <Text style={[font.small, { marginTop: space.sm }]}>{capability}</Text> : null}
        {Platform.OS !== 'android' ? <Note tone="info">Android only — use the eepy APK on your phone.</Note> : null}
        {Platform.OS === 'android' && !available ? <Note tone="info">Needs the latest eepy APK.</Note> : null}

        <Toggle
          label="Bedtime autopilot"
          sub={sleepMode.enabled ? 'On — eepy switches sleep mode by itself' : 'Off — your phone\'s sleep mode is left alone'}
          value={sleepMode.enabled}
          onChange={(v) => {
            toggle(v).catch(() => undefined);
          }}
        />

        {sleepMode.enabled ? (
          <>
            <Text style={[font.body, { marginTop: space.sm, marginBottom: 6 }]}>Switch on</Text>
            <Segmented options={START_OPTIONS} value={sleepMode.startAt} onChange={(startAt) => setSleepMode({ startAt })} />
            <Toggle
              label="Offer sleep sounds"
              sub={`"Sleep mode on 🌙 — play sleep sounds?" (${sleepSoundsLabel(settings.audio)})`}
              value={sleepMode.offerSounds}
              onChange={(offerSounds) => setSleepMode({ offerSounds })}
            />

            {onAt !== undefined && offAt !== undefined ? (
              <Row gap={space.sm} style={{ marginTop: space.sm }}>
                <Icon name={status?.active ? 'moon-waning-crescent' : 'clock-outline'} size={18} color={status?.active ? colors.light : colors.textDim} />
                <View style={{ flex: 1 }}>
                  <Text style={[font.body, { fontVariant: ['tabular-nums'] }]}>
                    Tonight: on {formatTime(onAt)} · off {formatTime(offAt)}
                    {window && !window.offAtAlarm ? ' (wake-up)' : ' (alarm)'}
                  </Text>
                  {state ? <Text style={font.tiny}>{state}</Text> : null}
                </View>
              </Row>
            ) : analysis ? null : (
              <Text style={[font.small, { marginTop: space.sm }]}>Tonight's times appear once eepy has your sleep data.</Text>
            )}

            {status?.supported && !status.access ? (
              <Note tone="warn" icon="shield-lock-outline">
                eepy can't switch sleep mode yet: allow it once under Do Not Disturb (Modes) access.
              </Note>
            ) : null}
            {status?.supported && status.access && !status.exactAlarms ? (
              <Note tone="info">Exact alarms are off for eepy, so sleep mode may switch a few minutes late.</Note>
            ) : null}
            {status?.lastError && status.access ? <Note tone="warn">Last problem: {status.lastError}</Note> : null}

            {available && status?.supported ? (
              <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
                {!status.access ? <Button small icon="shield-check-outline" label="Allow access" onPress={() => askForAccess().catch(() => undefined)} /> : null}
                {status.access && target && status.active ? (
                  <Button small kind="secondary" icon="stop" label="Stop now" disabled={busy} onPress={() => run(() => stopSleepModeNow(target.night), 'Sleep mode')} />
                ) : null}
                {status.access && target && !status.active && canStart ? (
                  <Button small icon="moon-waning-crescent" label="Start now" disabled={busy} onPress={() => run(() => startSleepModeNow(target.night, target.off), 'Sleep mode')} />
                ) : null}
                {status.access ? (
                  <Button
                    small
                    kind="ghost"
                    icon="tune-variant"
                    label={status.deviceEffects ? 'Customise the mode' : 'Do Not Disturb settings'}
                    onPress={() => {
                      openSleepModeSettings()
                        .then((ok) => !ok && notify('Settings', 'Open Settings → Modes (or Do Not Disturb) to change what "eepy sleep" lets through.'))
                        .catch(() => undefined);
                    }}
                  />
                ) : null}
              </Row>
            ) : null}
            {status?.deviceEffects && status.access ? (
              <Text style={[font.tiny, { marginTop: space.sm }]}>
                "eepy sleep" is listed with your phone's modes{status.userManaged ? ' (Settings → Modes)' : ''}: choose there who may still call and which apps may notify you.
              </Text>
            ) : null}
          </>
        ) : null}
      </Card>
    </Section>
  );
}
