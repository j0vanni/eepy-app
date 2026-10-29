/**
 * Full-screen lock-screen alarms through the local native module (modules/eepy-alarm, Android).
 * Builds without it (iOS, web, Jest, Expo Go, older APKs) fall back to expo-notifications alarms.
 *
 * Keep this module free of imports from ./channels, ./features or ./napTimer: napTimer.ts and the
 * reminders feature import it, and channels.ts imports every feature (see imports.test.ts).
 * OWNER: background & notifications workstream.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import EepyAlarm from '../../modules/eepy-alarm';
import type { Analysis } from '../engine/analysis';
import { MINUTE } from '../engine/time';
import type { AppState } from '../state/store';

/** Native alarm ids (their own namespace: AlarmManager + notifications tagged "eepy-alarm"). */
export const NAP_ALARM_ID = 'eepy-nap';
export const WAKE_ALARM_ID = 'eepy-wake';
/** Where "I'm up" takes you (expo-router routes /nap and /checkin). */
export const NAP_ALARM_LINK = 'eepy://nap';
export const WAKE_ALARM_LINK = 'eepy://checkin';
/** Mirrors AlarmSpec.SNOOZE_MINUTES in the native module. */
export const SNOOZE_MIN = 9;
/** Like the notification scheduler: don't (re)schedule anything due in the next 30 s. */
const MIN_LEAD_MS = 30_000;

/**
 * Java's String.hashCode(), which the native side uses as the PendingIntent request code and
 * notification id for an alarm id (stable across launches, so cancel finds what schedule made).
 */
export function alarmRequestCode(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h;
}

/** When a snoozed alarm rings again (the native Snooze button does the same sum). */
export function snoozeUntil(now: number): number {
  return now + SNOOZE_MIN * MINUTE;
}

/** True when this build has the native full-screen alarm. */
export function hasFullScreenAlarm(): boolean {
  return EepyAlarm !== undefined;
}

/** Schedules (or replaces) native alarm `id`. False when unavailable or refused — fall back then. */
export async function scheduleFullScreenAlarm(id: string, at: number, title: string, body: string, link: string): Promise<boolean> {
  if (!EepyAlarm) return false;
  try {
    return await EepyAlarm.scheduleAlarm(id, at, title, body, link);
  } catch (e) {
    console.warn('full-screen alarm failed', id, e);
    return false;
  }
}

/** Cancels native alarm `id` and its snooze, and stops it if it's ringing. */
export async function cancelFullScreenAlarm(id: string): Promise<void> {
  if (!EepyAlarm) return;
  await EepyAlarm.cancelAlarm(id).catch(() => undefined);
}

/** 'blocked' = Android 14+ and the user hasn't allowed full-screen notifications for eepy. */
export type FullScreenAlarmStatus = 'allowed' | 'blocked' | 'unavailable';

export async function getFullScreenAlarmStatus(): Promise<FullScreenAlarmStatus> {
  if (!EepyAlarm) return 'unavailable';
  try {
    return (await EepyAlarm.canUseFullScreenIntent()) ? 'allowed' : 'blocked';
  } catch {
    return 'unavailable';
  }
}

export async function openFullScreenAlarmSettings(): Promise<void> {
  await EepyAlarm?.openFullScreenIntentSettings();
}

export interface WakeAlarmContent {
  at: number;
  title: string;
  body: string;
}

/** The cycle-timed wake alarm (`prefs.smartAlarm`), shared by the notification planner and the native alarm. */
export function wakeAlarmContent(a: Analysis): WakeAlarmContent {
  return {
    at: a.alarm.alarm,
    title: 'Good morning ☀️',
    body: a.alarm.onBoundary ? 'Woken at the end of a sleep cycle.' : 'Time to get up.',
  };
}

/**
 * What the native wake alarm should do: 'cancel' (alarm off), 'keep' (it's due now or already
 * rang — it may be ringing or snoozed, so leave it alone) or 'set' this alarm.
 */
export function planNativeWakeAlarm(
  a: Analysis | undefined,
  smartAlarm: boolean,
  now: number,
): { action: 'cancel' } | { action: 'keep' } | { action: 'set'; alarm: WakeAlarmContent } {
  if (!smartAlarm) return { action: 'cancel' };
  if (!a) return { action: 'keep' };
  const alarm = wakeAlarmContent(a);
  if (alarm.at <= now + MIN_LEAD_MS) return { action: 'keep' };
  return { action: 'set', alarm };
}

/** What this process last told the native side about the wake alarm: undefined = nothing yet, null = cancelled. */
let lastWake: string | null | undefined;

/** Tests only: forget what was scheduled in this process. */
export function resetWakeAlarmMemo(): void {
  lastWake = undefined;
}

/**
 * Side effect that goes with `replanNotifications`: keeps the native wake alarm ('eepy-wake') in
 * line with `prefs.smartAlarm` and tonight's cycle-timed alarm. With the native module present the
 * reminders planner leaves the wake alarm out, so this must run wherever notifications are re-planned.
 * No-op without the native module. Never throws.
 */
export async function syncWakeAlarm(analysis: Analysis | undefined, state: AppState, now = Date.now()): Promise<void> {
  if (!EepyAlarm || Platform.OS === 'web') return;
  try {
    let smartAlarm = state.settings.notifications.smartAlarm;
    // Without notification permission the alarm couldn't show, so treat it as off.
    if (smartAlarm && !(await Notifications.getPermissionsAsync()).granted) smartAlarm = false;
    const plan = planNativeWakeAlarm(analysis, smartAlarm, now);
    if (plan.action === 'cancel') {
      if (lastWake !== null) {
        await cancelFullScreenAlarm(WAKE_ALARM_ID);
        lastWake = null;
      }
      return;
    }
    if (plan.action === 'keep') return;
    const { at, title, body } = plan.alarm;
    const key = `${at}|${title}|${body}`;
    if (key === lastWake) return;
    if (await scheduleFullScreenAlarm(WAKE_ALARM_ID, at, title, body, WAKE_ALARM_LINK)) lastWake = key;
  } catch (e) {
    console.warn('wake alarm sync failed', e);
  }
}
