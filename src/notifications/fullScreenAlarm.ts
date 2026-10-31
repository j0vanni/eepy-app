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
import { dateKey, HOUR, MINUTE } from '../engine/time';
import type { AppState, Settings } from '../state/store';

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

/** marks key: first ring (epoch ms) of the wake alarm that is scheduled — see nextWakeAlarm. */
export const WAKE_AT_MARK = 'wake.at';
/** marks key: first ring of a wake alarm already stopped from its watch buzz. */
export const WAKE_DONE_MARK = 'wake.done';
/** marks key: wake date (YYYY-MM-DD) whose alarm the user skipped ("Skip tomorrow's alarm"). */
export const WAKE_SKIP_MARK = 'wake.skip';
/** Watch-first alarms buzz the wrist at these offsets (min) before the phone alarm takes over. */
export const WRIST_BUZZ_OFFSETS_MIN = [0, 1, 2];
/** A wake alarm that has rung stays current this long (it may be ringing or snoozed). */
const RINGING_GRACE_MIN = 30;

export type WakeSettings = Pick<Settings, 'marks' | 'watch'>;

export interface WakeAlarmPlan extends WakeAlarmContent {
  /** First ring: the watch buzz in watch-first mode, otherwise the phone alarm itself. */
  base: number;
  /** Watch buzz times (empty unless the wake alarm is watch-first). */
  wrist: number[];
  /** This morning's alarm, kept although "tonight" has moved on to tomorrow. */
  held: boolean;
  /** Skipped for that morning by the user ("Skip") or a free day in the calendar. */
  skipped: boolean;
  /** The calendar marks that morning as a free day (no alarm). */
  calendarFree: boolean;
  /** Nothing left to ring: stopped from the watch already, or skipped. */
  done: boolean;
}

/**
 * The wake alarm that should ring next. `at` is the phone alarm (a backup `backupMin` after the
 * first buzz in watch-first mode).
 *
 * After 4am the analysis plans the *next* night, so its alarm is tomorrow's — while this morning's
 * may not have rung yet. The alarm last scheduled (WAKE_AT_MARK) is therefore held until it has
 * rung (plus its backup and snoozes) instead of being moved to tomorrow by a re-plan.
 */
export function nextWakeAlarm(a: Analysis, settings: WakeSettings, now: number): WakeAlarmPlan {
  const planned = wakeAlarmContent(a);
  const wristMode = settings.watch.wakeAlarm === 'wrist';
  const backupMs = wristMode ? settings.watch.backupMin * MINUTE : 0;
  const held = settings.marks[WAKE_AT_MARK];
  const done = settings.marks[WAKE_DONE_MARK];
  const holding =
    typeof held === 'number' &&
    held !== done &&
    held < planned.at &&
    dateKey(held) !== dateKey(planned.at) &&
    held > now - 24 * HOUR &&
    now < held + backupMs + RINGING_GRACE_MIN * MINUTE;
  const base = holding ? held : planned.at;
  const skippedByUser = settings.marks[WAKE_SKIP_MARK] === dateKey(base);
  const calendarFree = !!a.tonight.noAlarm && dateKey(base) === a.tonight.wakeDate;
  return {
    title: planned.title,
    body: holding ? 'Time to get up.' : planned.body,
    base,
    at: base + backupMs,
    wrist: wristMode ? WRIST_BUZZ_OFFSETS_MIN.map((m) => base + m * MINUTE) : [],
    held: holding,
    skipped: skippedByUser || calendarFree,
    calendarFree,
    done: base === done || skippedByUser || calendarFree,
  };
}

/**
 * What the native wake alarm should do: 'cancel' (alarm off or already stopped from the watch),
 * 'keep' (it's due now, already rang — it may be ringing or snoozed — or it's this morning's alarm,
 * scheduled before 4am) or 'set' this alarm.
 */
export function planNativeWakeAlarm(
  a: Analysis | undefined,
  smartAlarm: boolean,
  now: number,
  settings: WakeSettings = { marks: {}, watch: { napAlarm: 'phone', wakeAlarm: 'phone', backupMin: 5 } },
): { action: 'cancel' } | { action: 'keep' } | { action: 'set'; alarm: WakeAlarmContent } {
  if (!smartAlarm) return { action: 'cancel' };
  if (!a) return { action: 'keep' };
  const next = nextWakeAlarm(a, settings, now);
  if (next.done) return { action: 'cancel' };
  if (next.held || next.at <= now + MIN_LEAD_MS) return { action: 'keep' };
  return { action: 'set', alarm: { at: next.at, title: next.title, body: next.body } };
}

/** What this process last told the native side about the wake alarm: undefined = nothing yet, null = cancelled. */
let lastWake: string | null | undefined;

/** Tests only: forget what was scheduled in this process. */
export function resetWakeAlarmMemo(): void {
  lastWake = undefined;
}

/**
 * Side effect that goes with `replanNotifications`: remembers which wake alarm is scheduled (so it
 * survives the 4am switch to tomorrow's plan) and keeps the native wake alarm ('eepy-wake') in
 * line with `prefs.smartAlarm` and the cycle-timed alarm. With the native module present the
 * reminders planner leaves the phone wake alarm out, so this must run wherever notifications are
 * re-planned, right after them. Never throws.
 */
export async function syncWakeAlarm(analysis: Analysis | undefined, state: AppState, now = Date.now()): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const { settings } = state;
    if (analysis) {
      const mark = settings.notifications.smartAlarm ? nextWakeAlarm(analysis, settings, now).base : undefined;
      if (settings.marks[WAKE_AT_MARK] !== mark) state.setMark(WAKE_AT_MARK, mark);
    }
    if (!EepyAlarm) return;
    let smartAlarm = settings.notifications.smartAlarm;
    // Without notification permission the alarm couldn't show, so treat it as off.
    if (smartAlarm && !(await Notifications.getPermissionsAsync()).granted) smartAlarm = false;
    const plan = planNativeWakeAlarm(analysis, smartAlarm, now, settings);
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
