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
import { wakeTargetFor } from '../engine/schedule';
import { atMinutes, dateKey, formatTime, HOUR, MINUTE, minutesOfDay } from '../engine/time';
import { TWO_STEP, twoStepConfig, twoStepFor, twoStepSetting } from '../engine/twoStep';
import type { Profile } from '../engine/types';
import type { AppState, Settings } from '../state/store';

/** Native alarm ids (their own namespace: AlarmManager + notifications tagged "eepy-alarm"). */
export const NAP_ALARM_ID = 'eepy-nap';
export const WAKE_ALARM_ID = 'eepy-wake';
/** A two-step morning's first (routine) alarm; the final alarm is WAKE_ALARM_ID. */
export const WAKE_ROUTINE_ALARM_ID = 'eepy-wake-routine';
/** Where "I'm up" takes you (expo-router routes /nap and /checkin). */
export const NAP_ALARM_LINK = 'eepy://nap';
/** `up=alarm`: the check-in logs the "I'm up" and ends tonight's sleep session (state/inBed.ts). */
export const WAKE_ALARM_LINK = 'eepy://checkin?up=alarm';
/** The routine alarm's "I'm up" opens Today (the routine card), not "How did you sleep?". */
export const ROUTINE_ALARM_LINK = 'eepy://';
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

/**
 * The wake alarm (`prefs.smartAlarm`), shared by the notification planner and the native alarm:
 * cycle-timed — except on a two-step morning, where this is the final alarm and rings at the
 * wake-up itself (the short second stretch has no cycle to time; the routine alarm is the cycle-timed one).
 */
export function wakeAlarmContent(a: Analysis): WakeAlarmContent {
  if (a.tonight.twoStep) return { at: a.tonight.wake, title: 'Good morning ☀️', body: 'Time to get up.' };
  return {
    at: a.alarm.alarm,
    title: 'Good morning ☀️',
    body: a.alarm.onBoundary ? 'Woken at the end of a sleep cycle.' : 'Time to get up.',
  };
}

export const ROUTINE_ALARM_TITLE = 'Routine time 🧴';

export function routineAlarmBody(finalWake: number): string {
  return `Face routine time — keep the lights low, then back to bed until ${formatTime(finalWake)}.`;
}

/** A two-step morning's routine alarm (cycle-timed, before the first wake-up), if tonight has one. */
export function routineAlarmContent(a: Analysis): WakeAlarmContent | undefined {
  const two = a.tonight.twoStep;
  if (!two || a.tonight.noAlarm) return undefined;
  return { at: two.firstAlarm, title: ROUTINE_ALARM_TITLE, body: routineAlarmBody(a.tonight.wake) };
}

/** marks key: first ring (epoch ms) of the wake alarm that is scheduled — see nextWakeAlarm. */
export const WAKE_AT_MARK = 'wake.at';
/** marks key: first ring of a wake alarm already stopped from its watch buzz. */
export const WAKE_DONE_MARK = 'wake.done';
/** marks key: wake date (YYYY-MM-DD) whose alarm the user skipped ("Skip tomorrow's alarm"); both alarms of a two-step morning. */
export const WAKE_SKIP_MARK = 'wake.skip';
/** marks key: first ring of the routine alarm scheduled with WAKE_AT_MARK's final alarm (two-step mornings). */
export const WAKE_ROUTINE_AT_MARK = 'wake.routineAt';
/** marks key: first ring of a routine alarm already stopped from its watch buzz. */
export const WAKE_ROUTINE_DONE_MARK = 'wake.routineDone';
/**
 * marks key: wake date whose *final* alarm was skipped during the routine ("I'm staying up"). Like
 * WAKE_SKIP_MARK for the alarms, but that morning isn't a free one (no "did you wake up on your own?").
 */
export const WAKE_FINAL_SKIP_MARK = 'wake.skipFinal';
/**
 * marks key: wake date whose *routine* alarm was skipped that morning ("Skip it — back to sleep").
 * Only the routine alarm; the final alarm still rings. The morning's record (profile.wakePlan[date]
 * .twoStep = false) is set alongside, so planning and wake-up detection treat it as a one-alarm morning.
 */
export const WAKE_ROUTINE_SKIP_MARK = 'wake.skipRoutine';
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
  /** Two-step morning: the routine alarm that rings before this one, the same morning. */
  routine?: RoutineAlarmPlan;
}

export interface RoutineAlarmPlan extends WakeAlarmContent {
  /** First ring: the watch buzz in watch-first mode, otherwise the phone alarm. */
  base: number;
  wrist: number[];
  /** This morning's, kept with the held final alarm. */
  held: boolean;
  /** Stopped from the watch already, or the morning is skipped / free. */
  done: boolean;
}

/**
 * The wake alarm that should ring next. `at` is the phone alarm (a backup `backupMin` after the
 * first buzz in watch-first mode). On a two-step morning that's the final alarm, and `routine` is
 * the routine alarm before it.
 *
 * After 4am the analysis plans the *next* night, so its alarm is tomorrow's — while this morning's
 * may not have rung yet. The alarm last scheduled (WAKE_AT_MARK) is therefore held until it has
 * rung (plus its backup and snoozes) instead of being moved to tomorrow by a re-plan. On a two-step
 * morning WAKE_AT_MARK is the *final* alarm, so the hold lasts until that one has rung, and the
 * routine alarm scheduled with it (WAKE_ROUTINE_AT_MARK) is held alongside.
 */
export function nextWakeAlarm(a: Analysis, settings: WakeSettings, now: number): WakeAlarmPlan {
  const planned = wakeAlarmContent(a);
  const plannedRoutine = routineAlarmContent(a);
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
  const skippedByUser = settings.marks[WAKE_SKIP_MARK] === dateKey(base) || settings.marks[WAKE_FINAL_SKIP_MARK] === dateKey(base);
  const calendarFree = !!a.tonight.noAlarm && dateKey(base) === a.tonight.wakeDate;
  const buzzes = (t: number) => (wristMode ? WRIST_BUZZ_OFFSETS_MIN.map((m) => t + m * MINUTE) : []);
  // This morning's routine alarm goes with the held final alarm; otherwise tonight's plan has it (or not).
  const heldRoutine = settings.marks[WAKE_ROUTINE_AT_MARK];
  const routineBase = holding
    ? typeof heldRoutine === 'number' && heldRoutine < held && held - heldRoutine <= (TWO_STEP.maxGapMin + 30) * MINUTE
      ? heldRoutine
      : undefined
    : plannedRoutine?.at;
  const routine: RoutineAlarmPlan | undefined =
    routineBase === undefined
      ? undefined
      : {
          title: ROUTINE_ALARM_TITLE,
          body: routineAlarmBody(base),
          base: routineBase,
          at: routineBase + backupMs,
          wrist: buzzes(routineBase),
          held: holding,
          done: routineBase === settings.marks[WAKE_ROUTINE_DONE_MARK] || settings.marks[WAKE_ROUTINE_SKIP_MARK] === dateKey(base) || skippedByUser || calendarFree,
        };
  return {
    title: planned.title,
    body: holding ? 'Time to get up.' : planned.body,
    base,
    at: base + backupMs,
    wrist: buzzes(base),
    held: holding,
    skipped: skippedByUser || calendarFree,
    calendarFree,
    done: base === done || skippedByUser || calendarFree,
    ...(routine ? { routine } : {}),
  };
}

/** A two-step morning in progress: between the routine alarm and the final one. */
export interface RoutineNow {
  /** When the routine alarm rang (first ring), or the planned first wake-up without eepy's alarm. */
  routineAt: number;
  /** Back in bed by then (routine alarm + routine length). */
  backToBedBy: number;
  /** The final alarm's first ring and its phone alarm (the same unless watch-first). */
  finalAt: number;
  finalPhoneAt: number;
  /** The morning (YYYY-MM-DD): the WAKE_FINAL_SKIP_MARK value that skips the final alarm. */
  date: string;
  /** The final alarm is skipped ("I'm staying up"). */
  skipped: boolean;
  /** The routine is skipped this morning ("Skip it — back to sleep", WAKE_ROUTINE_SKIP_MARK). */
  routineSkipped: boolean;
  /** eepy rings these alarms (otherwise the times come from the plan, with nothing to skip). */
  eepyAlarm: boolean;
}

/**
 * During a two-step morning's routine — from `leadMin` (default 5) before the routine alarm until the
 * final alarm rings — the times that matter; undefined at any other time. With eepy's alarm on these
 * are the alarms actually scheduled (this morning's, held after 4am); otherwise this morning's plan.
 * A routine skipped this morning still counts (so it can be undone), even once the plan has dropped it.
 */
export function routineNow(
  a: Analysis,
  settings: WakeSettings & Pick<Settings, 'notifications'>,
  profile: Profile,
  now: number,
  opts: { leadMin?: number } = {},
): RoutineNow | undefined {
  const leadMin = opts.leadMin ?? 5;
  const routineMin = twoStepSetting(profile).routineMin;
  const skipMark = settings.marks[WAKE_ROUTINE_SKIP_MARK];
  if (settings.notifications.smartAlarm) {
    const w = nextWakeAlarm(a, settings, now);
    const date = dateKey(w.base);
    const routineSkipped = skipMark === date;
    let routineAt = w.routine?.base;
    // Skipped before 4am: tonight's plan no longer has the routine — place it from the setting's gap.
    if (routineAt === undefined && routineSkipped) {
      const c = twoStepConfig({ ...profile, twoStepMorning: { ...twoStepSetting(profile), enabled: true } });
      if (c) routineAt = w.base - c.gapMin * MINUTE;
    }
    if (routineAt === undefined || w.calendarFree || now < routineAt - leadMin * MINUTE || now >= w.base) return undefined;
    return { routineAt, backToBedBy: routineAt + routineMin * MINUTE, finalAt: w.base, finalPhoneAt: w.at, date, skipped: w.skipped, routineSkipped, eepyAlarm: true };
  }
  // Your own alarms: this morning's planned times (mornings only).
  if (minutesOfDay(now) >= 12 * 60) return undefined;
  const date = dateKey(now);
  const routineSkipped = skipMark === date;
  // A skip also set this morning's routine off in the calendar: read the plan without it.
  const asPlanned = routineSkipped && profile.wakePlan?.[date] ? { ...profile, wakePlan: { ...profile.wakePlan, [date]: { ...profile.wakePlan[date], twoStep: undefined } } } : profile;
  const target = wakeTargetFor(asPlanned, date);
  const c = twoStepFor(asPlanned, date, target);
  if (!c) return undefined;
  const finalAt = atMinutes(date, target.wakeMin);
  const first = finalAt - c.gapMin * MINUTE;
  if (now < first - Math.max(30, leadMin) * MINUTE || now >= finalAt) return undefined;
  return { routineAt: first, backToBedBy: first + c.routineMin * MINUTE, finalAt, finalPhoneAt: finalAt, date, skipped: false, routineSkipped, eepyAlarm: false };
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

export type NativeAlarmPlan = ReturnType<typeof planNativeWakeAlarm>;

/** The same for a two-step morning's routine alarm ('eepy-wake-routine'): 'cancel' when there is none. */
export function planNativeRoutineAlarm(
  a: Analysis | undefined,
  smartAlarm: boolean,
  now: number,
  settings: WakeSettings = { marks: {}, watch: { napAlarm: 'phone', wakeAlarm: 'phone', backupMin: 5 } },
): NativeAlarmPlan {
  if (!smartAlarm) return { action: 'cancel' };
  if (!a) return { action: 'keep' };
  const r = nextWakeAlarm(a, settings, now).routine;
  if (!r || r.done) return { action: 'cancel' };
  if (r.held || r.at <= now + MIN_LEAD_MS) return { action: 'keep' };
  return { action: 'set', alarm: { at: r.at, title: r.title, body: r.body } };
}

/** What this process last told the native side about each wake alarm: undefined = nothing yet, null = cancelled. */
let lastWake: string | null | undefined;
let lastRoutine: string | null | undefined;

/** Tests only: forget what was scheduled in this process. */
export function resetWakeAlarmMemo(): void {
  lastWake = undefined;
  lastRoutine = undefined;
}

/** Applies a native plan for alarm `id`; returns what is now scheduled (the memo). */
async function applyNativePlan(id: string, link: string, plan: NativeAlarmPlan, last: string | null | undefined): Promise<string | null | undefined> {
  if (plan.action === 'keep') return last;
  if (plan.action === 'cancel') {
    if (last === null) return last;
    await cancelFullScreenAlarm(id);
    return null;
  }
  const { at, title, body } = plan.alarm;
  const key = `${at}|${title}|${body}`;
  if (key === last) return last;
  return (await scheduleFullScreenAlarm(id, at, title, body, link)) ? key : last;
}

/**
 * Side effect that goes with `replanNotifications`: remembers which wake alarm is scheduled (so it
 * survives the 4am switch to tomorrow's plan) and keeps the native wake alarm ('eepy-wake') — and on
 * two-step mornings the routine alarm ('eepy-wake-routine') — in line with `prefs.smartAlarm` and
 * tonight's plan. With the native module present the reminders planner leaves the phone alarms out,
 * so this must run wherever notifications are re-planned, right after them. Never throws.
 */
export async function syncWakeAlarm(analysis: Analysis | undefined, state: AppState, now = Date.now()): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const { settings } = state;
    // A routine alarm may be pending natively if one was recorded (or scheduled by this process).
    const routineMaybeSet = typeof settings.marks[WAKE_ROUTINE_AT_MARK] === 'number' || typeof lastRoutine === 'string';
    if (analysis) {
      const next = settings.notifications.smartAlarm ? nextWakeAlarm(analysis, settings, now) : undefined;
      if (settings.marks[WAKE_AT_MARK] !== next?.base) state.setMark(WAKE_AT_MARK, next?.base);
      if (settings.marks[WAKE_ROUTINE_AT_MARK] !== next?.routine?.base) state.setMark(WAKE_ROUTINE_AT_MARK, next?.routine?.base);
    }
    if (!EepyAlarm) return;
    let smartAlarm = settings.notifications.smartAlarm;
    // Without notification permission the alarm couldn't show, so treat it as off.
    if (smartAlarm && !(await Notifications.getPermissionsAsync()).granted) smartAlarm = false;
    lastWake = await applyNativePlan(WAKE_ALARM_ID, WAKE_ALARM_LINK, planNativeWakeAlarm(analysis, smartAlarm, now, settings), lastWake);
    const routine = planNativeRoutineAlarm(analysis, smartAlarm, now, settings);
    if (routine.action !== 'cancel' || routineMaybeSet) {
      lastRoutine = await applyNativePlan(WAKE_ROUTINE_ALARM_ID, ROUTINE_ALARM_LINK, routine, lastRoutine);
    }
  } catch (e) {
    console.warn('wake alarm sync failed', e);
  }
}
