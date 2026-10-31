/**
 * Bedtime autopilot: the phone's own sleep mode ("eepy sleep", an Android mode — AutomaticZenRule —
 * owned by the native module) switched on at lights-out (or the start of wind-down) of tonight's
 * plan and off when the morning alarm starts, even while eepy is closed.
 *
 * `syncSleepMode` is the side effect that goes with `replanNotifications`, like `syncWakeAlarm`: it
 * runs wherever notifications are re-planned (root layout and the background task) and hands the
 * native side one night at a time. The native side owns the night-by-night state: it switches on
 * once per night, keeps a night off after the user stopped it, and lets a night in progress keep
 * its own "off" when eepy re-plans after 4am.
 *
 * Keep this module free of imports from ./channels, ./features or ./napTimer (see imports.test.ts).
 * OWNER: background & notifications workstream.
 */
import { Platform } from 'react-native';

import EepyAlarm, { type NativeSleepModeStatus } from '../../modules/eepy-alarm';
import { soundInfo } from '../audio/sounds';
import type { Analysis } from '../engine/analysis';
import { formatDuration } from '../engine/time';
import type { AppState, AudioSettings, Settings } from '../state/store';
import { nextWakeAlarm, WAKE_AT_MARK } from './fullScreenAlarm';

export type SleepModeSettingsView = Pick<Settings, 'sleepMode' | 'notifications' | 'marks' | 'watch' | 'audio'>;

export interface SleepModeWindow {
  /** The night's wake-up date (analysis.tonight.wakeDate): one switch-on per night. */
  night: string;
  on: number;
  off: number;
  /** Off when the morning alarm starts; otherwise at the planned wake-up (alarm off or skipped). */
  offAtAlarm: boolean;
}

/**
 * Tonight's sleep-mode window. On: wind-down start or lights-out of `analysis.tonight` (which
 * already follows "Adjust tonight"). Off: the first ring of tonight's alarm (`nextWakeAlarm` — in
 * watch-first mode the first wrist buzz, so the buzzes aren't held back), or the planned wake-up
 * when eepy's alarm is off, skipped or already stopped. Undefined when that night is over.
 */
export function sleepModeWindow(a: Analysis, settings: SleepModeSettingsView, now: number): SleepModeWindow | undefined {
  const t = a.tonight;
  const on = settings.sleepMode.startAt === 'winddown' ? t.windDownStart : t.bedtime;
  let off = t.wake;
  let offAtAlarm = false;
  if (settings.notifications.smartAlarm) {
    // Tonight's own alarm, not a held this-morning one (that night's window is already with the native side).
    const alarm = nextWakeAlarm(a, { marks: { ...settings.marks, [WAKE_AT_MARK]: undefined }, watch: settings.watch }, now);
    if (!alarm.done && alarm.base > on) {
      off = alarm.base;
      offAtAlarm = true;
    }
  }
  if (!(off > on) || off <= now) return undefined;
  return { night: t.wakeDate, on, off, offAtAlarm };
}

/** "Brown noise · 45 min", "Rain · until you stop it" — what the "play sleep sounds?" prompt offers. */
export function sleepSoundsLabel(audio: AudioSettings): string {
  const name = audio.sound === 'rain' ? 'Rain' : `${soundInfo(audio.sound).label} noise`;
  if (audio.timerMin <= 0) return `${name} · until you stop it`;
  return `${name} · ${audio.timerMin < 60 ? `${audio.timerMin} min` : formatDuration(audio.timerMin)}`;
}

export type SleepModePlan = { action: 'cancel' } | { action: 'keep' } | { action: 'set'; window: SleepModeWindow; sounds: string | null };

/** What the native sleep mode should do: 'cancel' (autopilot off), 'keep' (nothing new to plan) or 'set' this night. */
export function planSleepMode(a: Analysis | undefined, settings: SleepModeSettingsView, now: number): SleepModePlan {
  if (!settings.sleepMode.enabled) return { action: 'cancel' };
  if (!a) return { action: 'keep' };
  const window = sleepModeWindow(a, settings, now);
  if (!window) return { action: 'keep' };
  return { action: 'set', window, sounds: settings.sleepMode.offerSounds ? sleepSoundsLabel(settings.audio) : null };
}

/** What this process last told the native side: undefined = nothing yet, null = cancelled. */
let lastSleep: string | null | undefined;

/** Forget what was sent (tests; and after the user grants access, so the next sync reaches native again). */
export function resetSleepModeMemo(): void {
  lastSleep = undefined;
}

/** True when this build can switch the phone's sleep mode (the native module, Android). */
export function hasSleepMode(): boolean {
  return Platform.OS === 'android' && typeof EepyAlarm?.scheduleSleepMode === 'function';
}

/**
 * Keeps the native sleep-mode plan in line with tonight's plan and the autopilot settings. Only
 * calls native when the night, its times or the sounds offer change. Never throws.
 */
export async function syncSleepMode(analysis: Analysis | undefined, state: AppState, now = Date.now()): Promise<void> {
  if (Platform.OS === 'web' || !EepyAlarm || typeof EepyAlarm.scheduleSleepMode !== 'function') return;
  try {
    const plan = planSleepMode(analysis, state.settings, now);
    if (plan.action === 'keep') return;
    if (plan.action === 'cancel') {
      if (lastSleep !== null) {
        await EepyAlarm.cancelSleepMode();
        lastSleep = null;
      }
      return;
    }
    const { window, sounds } = plan;
    const key = `${window.night}|${window.on}|${window.off}|${sounds ?? ''}`;
    if (key === lastSleep) return;
    await EepyAlarm.scheduleSleepMode(window.night, window.on, window.off, sounds);
    lastSleep = key;
  } catch (e) {
    console.warn('sleep mode sync failed', e);
  }
}

/** The native module when this build has sleep mode (Android, latest APK). */
function native() {
  return hasSleepMode() ? EepyAlarm : undefined;
}

export async function getSleepModeStatus(): Promise<NativeSleepModeStatus | undefined> {
  try {
    return await native()?.getSleepModeStatus();
  } catch {
    return undefined;
  }
}

/** "Start now" until `off`. False if Android didn't allow it (status.lastError says why). */
export async function startSleepModeNow(night: string, off: number): Promise<boolean> {
  return (await native()?.startSleepModeNow(night, off).catch(() => false)) ?? false;
}

/** "Stop now": off, and it stays off for the rest of `night`. */
export async function stopSleepModeNow(night: string): Promise<boolean> {
  return (await native()?.stopSleepModeNow(night).catch(() => false)) ?? false;
}

/** Removes the "Sleep mode on — play sleep sounds?" notification (the sounds were started). */
export async function dismissSleepModePrompt(): Promise<void> {
  await native()?.dismissSleepModePrompt().catch(() => undefined);
}

export async function openSleepModeAccessSettings(): Promise<boolean> {
  return (await native()?.openSleepModeAccessSettings().catch(() => false)) ?? false;
}

export async function openSleepModeSettings(): Promise<boolean> {
  return (await native()?.openSleepModeSettings().catch(() => false)) ?? false;
}

/** The night in progress (on ≤ now < off) per the native plan, if any. */
export function activeSleepWindow(status: NativeSleepModeStatus | undefined, now: number): { night: string; onAt: number; offAt: number } | undefined {
  return status?.windows.find((w) => w.onAt <= now && now < w.offAt);
}
