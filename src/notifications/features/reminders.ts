/**
 * Core daily reminders: wind-down, bedtime, caffeine cut-off, morning check-in, cycle-timed wake alarm.
 *
 * With `adaptiveReminders` on they react to the day (see `planReminders`): a nap nudge when nap
 * need is high, the caffeine last call only after you've logged caffeine, nothing while a nap
 * timer is running, lights-out moved after a long nap, and copy that mentions late caffeine,
 * naps or high debt. Capped at DAILY_REMINDER_CAP per day so it stays quiet.
 * Also routes taps on the nap-timer notifications (see ../napTimer.ts).
 * OWNER: background & notifications workstream.
 */
import * as Notifications from 'expo-notifications';
import type { Href } from 'expo-router';
import { Platform } from 'react-native';

import type { Analysis } from '../../engine/analysis';
import { logUp } from '../../engine/wakeDetect';
import { dateKey, formatDuration, formatTime, HOUR, MINUTE, weekdayOfKey } from '../../engine/time';
import type { AppState } from '../../state/store';
import { cancelFullScreenAlarm, hasFullScreenAlarm, nextWakeAlarm, WAKE_ALARM_ID, WAKE_DONE_MARK, WRIST_BUZZ_OFFSETS_MIN } from '../fullScreenAlarm';
import { plannedId, RUNNING_LATE_ACTION, RUNNING_LATE_CATEGORY } from '../ids';
import { markResponseHandled, openFromNotification } from '../navigate';
import { NAP_ALARM_CATEGORY, NAP_TIMER_CATEGORY, NAP_TIMER_KIND, stopNapTimer } from '../napTimer';
import type { NotificationFeature, PlannedNotification, PlannerContext } from '../types';
import { DayContext, dayContext, duringNap } from './dayContext';
import { liveWindDownCoversBedtime } from './liveWindDown';

export const DAILY_REMINDER_CAP = 5;
/** Nap need (0–100) above which a "nap window open" nudge is worth sending. */
export const NAP_NUDGE_MIN_NEED = 55;
export const WRIST_WAKE_CATEGORY = 'wrist-wake';
export const WRIST_WAKE_KIND = 'wrist-wake';
const wristWakeId = (i: number) => `wrist-wake-${i}`;
/** Highest priority first; lower ones are dropped when a day goes over the cap. */
const PRIORITY = ['bedtime', 'winddown', 'nap', 'checkin', 'caffeine'];

const hours = (min: number) => Math.round((min / 60) * 10) / 10;

function windDownBody(day: DayContext): string {
  const base = `Dim the lights and put screens away — lights out at ${formatTime(day.lightsOut)}.`;
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
  const out: PlannedNotification[] = [];

  // The live wind-down card replaces the plain wind-down reminder (same moment, one notification).
  if (prefs.windDown && !prefs.liveWindDown && !napping(t.windDownStart)) {
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
  if (prefs.bedtime && !liveWindDownCoversBedtime(a, state, now, day) && !napping(day.lightsOut)) {
    out.push({
      id: 'bedtime',
      at: day.lightsOut,
      channel: 'reminders',
      categoryId: RUNNING_LATE_CATEGORY,
      title: 'Lights out',
      body: bedtimeBody(a, day),
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

/** "I'm up" on a watch buzz: stop the remaining buzzes and the phone backup for that alarm. */
export async function stopWristWake(state: Pick<AppState, 'setMark'> & Partial<Pick<AppState, 'updateWakeLog'>>, base: number): Promise<void> {
  state.setMark(WAKE_DONE_MARK, base);
  // When you said you were up: evidence for the accurate wake-up (engine/wakeDetect.ts).
  const at = Date.now();
  state.updateWakeLog?.((log) => logUp(log, at));
  if (Platform.OS === 'web') return;
  const ids = [...WRIST_BUZZ_OFFSETS_MIN.map((_, i) => plannedId('reminders', wristWakeId(i))), plannedId('reminders', 'wake')];
  for (const id of ids) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
    await Notifications.dismissNotificationAsync(id).catch(() => undefined);
  }
  await cancelFullScreenAlarm(WAKE_ALARM_ID);
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
    { id: RUNNING_LATE_CATEGORY, actions: [{ id: RUNNING_LATE_ACTION, title: 'Running late' }] },
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
      // A replayed response for an old alarm must not cancel a newer one.
      if (base !== undefined && Date.now() - base < 3 * HOUR && state.settings.marks[WAKE_DONE_MARK] !== base) {
        await stopWristWake(state, base);
      }
      openFromNotification('/checkin');
      return;
    }
    if (r.actionId === RUNNING_LATE_ACTION) {
      openFromNotification('/tonight');
      return;
    }
    if (r.actionId === 'default' && typeof r.data.route === 'string' && ROUTES.has(r.data.route)) {
      openFromNotification(r.data.route as Href);
    }
  },
};
