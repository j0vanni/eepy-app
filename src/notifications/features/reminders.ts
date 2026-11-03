/**
 * Core daily reminders: wind-down, bedtime, caffeine cut-off, morning check-in, cycle-timed wake alarm
 * (and on a two-step morning the routine alarm before it — engine/twoStep.ts).
 *
 * With `adaptiveReminders` on they react to the day (see `planReminders`): a nap nudge when nap
 * need is high, the caffeine last call only after you've logged caffeine, nothing while a nap
 * timer is running, lights-out moved after a long nap, and copy that mentions late caffeine,
 * naps or high debt. Capped at DAILY_REMINDER_CAP per day so it stays quiet.
 * Once you've tapped "I'm in bed" (engine/inBed.ts), tonight's wind-down and lights-out stay quiet.
 * Also routes taps on the nap-timer notifications (see ../napTimer.ts).
 * OWNER: background & notifications workstream.
 */
import * as Notifications from 'expo-notifications';
import type { Href } from 'expo-router';
import { Platform } from 'react-native';

import type { Analysis } from '../../engine/analysis';
import { inBedTonight } from '../../engine/inBed';
import { logUp } from '../../engine/wakeDetect';
import { dateKey, formatDuration, formatTime, HOUR, MINUTE, weekdayOfKey } from '../../engine/time';
import { skipRoutine } from '../../state/routineSkip';
import type { AppState } from '../../state/store';
import {
  cancelFullScreenAlarm,
  hasFullScreenAlarm,
  nextWakeAlarm,
  WAKE_ALARM_ID,
  WAKE_DONE_MARK,
  WAKE_ROUTINE_ALARM_ID,
  WAKE_ROUTINE_DONE_MARK,
  WRIST_BUZZ_OFFSETS_MIN,
} from '../fullScreenAlarm';
import { IN_BED_ACTION, IN_BED_LINK, plannedId, RUNNING_LATE_ACTION, RUNNING_LATE_CATEGORY } from '../ids';
import { markResponseHandled, openFromNotification } from '../navigate';
import { NAP_ALARM_CATEGORY, NAP_TIMER_CATEGORY, NAP_TIMER_KIND, stopNapTimer } from '../napTimer';
import type { NotificationFeature, PlannedNotification, PlannerContext } from '../types';
import { DayContext, dayContext, duringNap, READING_UP_TITLE, readingDown } from './dayContext';
import { liveWindDownCoversBedtime } from './liveWindDown';

export const DAILY_REMINDER_CAP = 5;
/** Nap need (0–100) above which a "nap window open" nudge is worth sending. */
export const NAP_NUDGE_MIN_NEED = 55;
export const WRIST_WAKE_CATEGORY = 'wrist-wake';
/** The routine alarm's buzzes: "I'm up" or "Skip routine" (back to sleep until the final alarm). */
export const WRIST_ROUTINE_CATEGORY = 'wrist-routine';
export const ROUTINE_SKIP_ACTION = 'routine-skip';
export const WRIST_WAKE_KIND = 'wrist-wake';
const wristWakeId = (i: number) => `wrist-wake-${i}`;
const wristRoutineId = (i: number) => `wrist-routine-${i}`;
/** Planner id of a two-step morning's routine phone alarm (builds without the native alarm). */
export const ROUTINE_PLAN_ID = 'wake-routine';
/** Highest priority first; lower ones are dropped when a day goes over the cap. */
const PRIORITY = ['bedtime', 'winddown', 'nap', 'checkin', 'caffeine'];

const hours = (min: number) => Math.round((min / 60) * 10) / 10;

function windDownBody(day: DayContext): string {
  // With the bedtime rundown: its first steps now, the phone later.
  const base = day.rundown
    ? `Your bedtime rundown starts — phone down at ${formatTime(day.phoneDown)}, lights out at ${formatTime(day.lightsOut)}.`
    : `Dim the lights and put screens away — lights out at ${formatTime(day.lightsOut)}.`;
  if (!day.adaptive) return base;
  if (day.lateCaffeine) return `${base} Caffeine is still in your system, so keep this hour extra calm.`;
  if (day.napShiftMin > 0) return `${base} That's ${day.napShiftMin} min later than usual after your nap.`;
  if (day.highDebt) return `${base} You're short on sleep — protect tonight's full window.`;
  return base;
}

function bedtimeBody(a: Analysis, day: DayContext): string {
  const base = `Going to sleep now gets you ${hours(a.need.needMin)}h before ${formatTime(a.tonight.wake)}.`;
  if (!day.adaptive) return base;
  if (day.napShiftMin > 0) {
    return `Your ${day.napsTodayMin}-min nap pushed sleepiness back a little, so lights out is ${formatTime(day.lightsOut)} — keep your ${formatTime(a.tonight.wake)} wake-up.`;
  }
  if (day.lateCaffeine) {
    return `About ${Math.round(day.caffeineAtBedtimeMg)} mg of caffeine is still around. Head to bed now; if you're not sleepy, read in dim light until you are.`;
  }
  if (day.highDebt && a.tonight.extraForDebtMin > 0) {
    return `Tonight includes +${a.tonight.extraForDebtMin} min toward your ${formatDuration(a.debt.debtMin)} sleep debt. ${base}`;
  }
  return base;
}

/** Keeps at most `cap` reminders per (4am-to-4am) day, dropping the least important first. */
export function capPerDay(list: PlannedNotification[], cap: number): PlannedNotification[] {
  const byDay = new Map<string, PlannedNotification[]>();
  for (const p of list) {
    const key = dateKey(p.at - 4 * HOUR);
    byDay.set(key, [...(byDay.get(key) ?? []), p]);
  }
  const keep = new Set<PlannedNotification>();
  for (const items of byDay.values()) {
    const rank = (p: PlannedNotification) => {
      const i = PRIORITY.indexOf(p.id);
      return i < 0 ? PRIORITY.length : i;
    };
    [...items].sort((x, y) => rank(x) - rank(y)).slice(0, cap).forEach((p) => keep.add(p));
  }
  return list.filter((p) => keep.has(p));
}

/** Pure planning step: everything this feature wants scheduled for the current analysis. */
export function planReminders({ analysis: a, state, now }: PlannerContext): PlannedNotification[] {
  const prefs = state.settings.notifications;
  const t = a.tonight;
  const day = dayContext(a, state, now);
  const napping = (at: number) => day.adaptive && duringNap(day, at);
  // In bed already ("I'm in bed"): wind-down and lights-out would only be noise now.
  const inBed = inBedTonight(state.settings.session, t.wakeDate);
  const out: PlannedNotification[] = [];

  // The live wind-down card replaces the plain wind-down reminder (same moment, one notification).
  if (prefs.windDown && !prefs.liveWindDown && !inBed && !napping(t.windDownStart)) {
    out.push({
      id: 'winddown',
      at: t.windDownStart,
      channel: 'reminders',
      categoryId: RUNNING_LATE_CATEGORY,
      title: 'Time to wind down 🌙',
      body: windDownBody(day),
    });
  }
  // During wind-down the live card is already scheduled to turn into "Lights out" at bedtime.
  // With reading time in the bedtime rundown, this is also "reading time's up" (one notification, not two).
  if (prefs.bedtime && !inBed && !liveWindDownCoversBedtime(a, state, now, day) && !napping(day.lightsOut)) {
    out.push({
      id: 'bedtime',
      at: day.lightsOut,
      channel: 'reminders',
      categoryId: RUNNING_LATE_CATEGORY,
      title: day.readingMin > 0 ? READING_UP_TITLE : 'Lights out',
      body: day.readingMin > 0 ? `${readingDown(day)} ${bedtimeBody(a, day)}` : bedtimeBody(a, day),
    });
  }
  // Adaptive: a last call only matters if you're actually drinking caffeine today.
  if (prefs.caffeine && a.caffeine.cutoff.cutoff && (!day.adaptive || day.caffeineTodayMg > 0)) {
    const at = a.caffeine.cutoff.cutoff - 15 * MINUTE;
    if (!napping(at)) {
      out.push({
        id: 'caffeine',
        at,
        channel: 'reminders',
        title: 'Last call for caffeine ☕',
        body: day.adaptive
          ? `You've had ${Math.round(day.caffeineTodayMg)} mg today. Anything after ${formatTime(a.caffeine.cutoff.cutoff)} will still be in your system at bedtime.`
          : `Caffeine after ${formatTime(a.caffeine.cutoff.cutoff)} will still be in your system at bedtime.`,
      });
    }
  }
  if (prefs.morningCheckIn) {
    // On free days the natural-wake prompt already lands ~45 min after waking; ask about the night later.
    const freeDay = !state.profile.workdays.includes(weekdayOfKey(t.wakeDate));
    const checkinDelay = freeDay && prefs.naturalWakePrompt ? 120 : 45;
    out.push({
      id: 'checkin',
      at: t.wake + checkinDelay * MINUTE,
      channel: 'reminders',
      title: 'How did you sleep?',
      body: 'Rate last night and log anything from yesterday — it sharpens your sleep-need estimate.',
      data: { route: '/journal' },
    });
  }
  // Adaptive: nudge at the start of the nap window, only when a nap would clearly help.
  const nap = a.nap;
  if (day.adaptive && nap.verdict === 'nap-later' && nap.needScore >= NAP_NUDGE_MIN_NEED && nap.window && nap.window.start > now && !day.napTimer) {
    const what = nap.best ? `A ${nap.best.label.toLowerCase()} (${nap.best.alarmAfterMin} min)` : 'A short nap';
    out.push({
      id: 'nap',
      at: nap.window.start,
      channel: 'reminders',
      title: 'Nap window open 💤',
      body: `${what} now will lift your afternoon — best before ${formatTime(nap.window.end)}.`,
      data: { route: '/nap' },
    });
  }

  const planned = day.adaptive ? capPerDay(out, DAILY_REMINDER_CAP) : out;
  if (prefs.smartAlarm) {
    const wake = nextWakeAlarm(a, state.settings, now);
    // Two-step morning: the gentler routine alarm first (its own buzzes and phone alarm), then the final one.
    const routine = wake.routine;
    if (routine && !routine.done) {
      const backup = formatTime(routine.at);
      routine.wrist.forEach((at, i) =>
        planned.push({
          id: wristRoutineId(i),
          at,
          channel: 'wrist',
          alarm: true,
          silent: true,
          categoryId: WRIST_ROUTINE_CATEGORY,
          title: i === 0 ? `${routine.title} ⌚` : 'Routine time — still in bed?',
          body:
            i === 0
              ? `${routine.body} Tap "I'm up" — or "Skip routine" to sleep on — else the phone alarm rings at ${backup}.`
              : `Phone alarm at ${backup} unless you tap "I'm up" or "Skip routine".`,
          data: { kind: WRIST_WAKE_KIND, base: routine.base, routine: true },
        }),
      );
      if (!hasFullScreenAlarm()) {
        planned.push({
          id: ROUTINE_PLAN_ID,
          at: routine.at,
          channel: 'wake',
          sound: 'wake.wav',
          alarm: true,
          title: routine.title,
          body: routine.body,
          categoryId: WRIST_ROUTINE_CATEGORY,
          data: { kind: WRIST_WAKE_KIND, base: routine.base, routine: true },
        });
      }
    }
    if (!wake.done) {
      // Watch-first: silent buzzes on the wrist, then the phone alarm as a backup.
      const backup = formatTime(wake.at);
      wake.wrist.forEach((at, i) =>
        planned.push({
          id: wristWakeId(i),
          at,
          channel: 'wrist',
          alarm: true,
          silent: true,
          categoryId: WRIST_WAKE_CATEGORY,
          title: i === 0 ? `${wake.title} ⌚` : 'Still in bed?',
          body: i === 0 ? `${wake.body} Tap "I'm up", or the phone alarm rings at ${backup}.` : `Phone alarm at ${backup} unless you tap "I'm up".`,
          data: { kind: WRIST_WAKE_KIND, base: wake.base },
        }),
      );
      // Builds with the native full-screen alarm ring the phone alarm from there instead (see syncWakeAlarm).
      if (!hasFullScreenAlarm()) {
        planned.push({ id: 'wake', at: wake.at, channel: 'wake', sound: 'wake.wav', alarm: true, title: wake.title, body: wake.body });
      }
    }
  }
  return planned;
}

/** Cancels the routine alarm's watch buzzes, its planner phone alarm and the native routine alarm (scheduled or showing). */
export async function cancelRoutineAlarms(): Promise<void> {
  if (Platform.OS === 'web') return;
  for (const id of [...WRIST_BUZZ_OFFSETS_MIN.map((_, i) => plannedId('reminders', wristRoutineId(i))), plannedId('reminders', ROUTINE_PLAN_ID)]) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
    await Notifications.dismissNotificationAsync(id).catch(() => undefined);
  }
  await cancelFullScreenAlarm(WAKE_ROUTINE_ALARM_ID);
}

/**
 * "I'm up" on a watch buzz: stop the remaining buzzes and the phone backup for that alarm — on a
 * two-step morning just the routine alarm's (`routine`), the final alarm still rings.
 */
export async function stopWristWake(
  state: Pick<AppState, 'setMark'> & Partial<Pick<AppState, 'updateWakeLog'>>,
  base: number,
  opts: { routine?: boolean } = {},
): Promise<void> {
  state.setMark(opts.routine ? WAKE_ROUTINE_DONE_MARK : WAKE_DONE_MARK, base);
  // When you said you were up: evidence for the accurate wake-up (engine/wakeDetect.ts; a routine tap is read as the routine).
  const at = Date.now();
  state.updateWakeLog?.((log) => logUp(log, at));
  if (Platform.OS === 'web') return;
  const ids = opts.routine
    ? [...WRIST_BUZZ_OFFSETS_MIN.map((_, i) => plannedId('reminders', wristRoutineId(i))), plannedId('reminders', ROUTINE_PLAN_ID)]
    : [...WRIST_BUZZ_OFFSETS_MIN.map((_, i) => plannedId('reminders', wristWakeId(i))), plannedId('reminders', 'wake')];
  for (const id of ids) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
    await Notifications.dismissNotificationAsync(id).catch(() => undefined);
  }
  await cancelFullScreenAlarm(opts.routine ? WAKE_ROUTINE_ALARM_ID : WAKE_ALARM_ID);
}

const ROUTES = new Set(['/nap', '/journal', '/winddown']);

export const reminders: NotificationFeature = {
  id: 'reminders',
  plan: planReminders,
  categories: [
    {
      id: NAP_TIMER_CATEGORY,
      actions: [
        { id: 'nap-done', title: "I'm up — log nap" },
        { id: 'nap-cancel', title: 'Cancel nap' },
      ],
    },
    { id: NAP_ALARM_CATEGORY, actions: [{ id: 'nap-done', title: "I'm up — log nap" }] },
    { id: WRIST_WAKE_CATEGORY, actions: [{ id: 'wrist-up', title: "I'm up" }] },
    {
      id: WRIST_ROUTINE_CATEGORY,
      actions: [
        { id: 'wrist-up', title: "I'm up" },
        { id: ROUTINE_SKIP_ACTION, title: 'Skip routine', opensApp: false },
      ],
    },
    {
      id: RUNNING_LATE_CATEGORY,
      actions: [
        { id: IN_BED_ACTION, title: "I'm in bed" },
        { id: RUNNING_LATE_ACTION, title: 'Running late' },
      ],
    },
  ],
  async onResponse(r, state: AppState) {
    markResponseHandled();
    if (r.data.kind === NAP_TIMER_KIND) {
      const start = typeof r.data.start === 'number' ? r.data.start : undefined;
      // Tapping a watch buzz itself also means you're up.
      const action = r.actionId === 'default' && r.data.wrist === true ? 'nap-done' : r.actionId;
      // Only act on the timer this notification belongs to (a response can be replayed later).
      if (action === 'nap-done' || action === 'nap-cancel') {
        if (state.settings.napTimer && (start === undefined || state.settings.napTimer.start === start)) {
          await stopNapTimer(state, action === 'nap-done');
        }
      }
      openFromNotification('/nap');
      return;
    }
    if (r.data.kind === WRIST_WAKE_KIND) {
      const base = typeof r.data.base === 'number' ? r.data.base : undefined;
      const routine = r.data.routine === true;
      // "Skip routine": back to sleep — the routine alarm stops, the final one still rings, and the
      // morning counts as a one-alarm morning. Stays in the background (no app to look at in bed).
      if (routine && r.actionId === ROUTINE_SKIP_ACTION) {
        if (base !== undefined && Date.now() - base < 3 * HOUR) await skipRoutine(dateKey(base));
        return;
      }
      // A replayed response for an old alarm must not cancel a newer one.
      if (base !== undefined && Date.now() - base < 3 * HOUR && state.settings.marks[routine ? WAKE_ROUTINE_DONE_MARK : WAKE_DONE_MARK] !== base) {
        await stopWristWake(state, base, { routine });
      }
      // After the routine alarm: Today, with its "back to bed by …" card — not "How did you sleep?".
      // The final alarm's "I'm up" also ends tonight's sleep session (the check-in does that: `up`).
      openFromNotification(routine ? '/' : { pathname: '/checkin', params: { up: 'watch' } });
      return;
    }
    if (r.actionId === RUNNING_LATE_ACTION) {
      openFromNotification('/tonight');
      return;
    }
    // Opens eepy and starts the sleep session there (it needs tonight's plan): src/app/quick/[action].tsx.
    if (r.actionId === IN_BED_ACTION) {
      openFromNotification(IN_BED_LINK as Href);
      return;
    }
    if (r.actionId === 'default' && typeof r.data.route === 'string' && ROUTES.has(r.data.route)) {
      openFromNotification(r.data.route as Href);
    }
  },
};
