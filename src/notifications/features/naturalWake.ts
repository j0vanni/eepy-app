/**
 * Free-day prompt "Did you wake up on your own?" (`naturalWakePrompt`).
 * OWNER: learning workstream.
 *
 * On free days (not in profile.workdays) whose journal has no `wokeNaturally` answer yet, ask ~45 min
 * after waking: the recorded wake-up if last night has synced, otherwise the free-day wake target
 * + 30 min (people sleep in). Today and tomorrow are planned. The answer goes to the journal
 * (`logDay(date, { wokeNaturally })`), which the sleep-need estimator learns from: unrestricted
 * nights are the strongest evidence of how much sleep you need.
 */
import { atMinutes, MINUTE, weekdayOfKey } from '../../engine/time';
import { wakeTargetFor } from '../../engine/schedule';
import { useStore } from '../../state/store';
import { WAKE_SKIP_MARK } from '../fullScreenAlarm';
import type { NotificationFeature, PlannedNotification } from '../types';
import { dismissPresented, openRoute } from './learningShared';

export const NATURAL_WAKE_CATEGORY = 'eepy-natural-wake';
const AFTER_WAKE_MIN = 45;
/** Assumed sleep-in past the free-day target while last night hasn't synced. */
const SLEEP_IN_MIN = 30;
/** Answers about mornings older than this are ignored. */
const MAX_AGE_DAYS = 3;
const OPENED_MARK = 'naturalWake.lastOpened';

export const naturalWake: NotificationFeature = {
  id: 'naturalWake',
  categories: [
    {
      id: NATURAL_WAKE_CATEGORY,
      actions: [
        { id: 'woke-yes', title: 'Yes, on my own', opensApp: false },
        { id: 'woke-no', title: 'No, alarm / woken', opensApp: false },
      ],
    },
  ],

  plan({ analysis: a, state, now }) {
    if (!state.settings.notifications.naturalWakePrompt) return [];
    const { profile, dayLogs } = state;
    const out: PlannedNotification[] = [];
    for (const date of [a.day, a.tonight.wakeDate]) {
      // Workdays too when the alarm was skipped: that's a free morning.
      if (profile.workdays.includes(weekdayOfKey(date)) && state.settings.marks[WAKE_SKIP_MARK] !== date) continue;
      if (dayLogs[date]?.wokeNaturally !== undefined) continue;
      // Stable fallback time, so the prompt doesn't move around (or repeat) as data arrives.
      let at = atMinutes(date, wakeTargetFor(profile, date).wakeMin + SLEEP_IN_MIN + AFTER_WAKE_MIN);
      if (date === a.day && a.lastNightIsCurrent) {
        const actual = a.wakeTime + AFTER_WAKE_MIN * MINUTE;
        if (actual > now) at = actual;
      }
      out.push({
        id: date,
        at,
        channel: 'reminders',
        categoryId: NATURAL_WAKE_CATEGORY,
        title: 'Did you wake up on your own?',
        body: 'Free-day mornings without an alarm are how eepy learns how much sleep you really need.',
        data: { date },
      });
    }
    return out;
  },

  async onResponse({ actionId, data }) {
    const date = typeof data.date === 'string' ? data.date : undefined;
    if (!date) return;
    const state = useStore.getState();
    const ageDays = (Date.now() - atMinutes(date, 0)) / (24 * 60 * MINUTE);
    if (actionId === 'default') {
      // Body tap → the journal. Guard against the same response being re-delivered on a later launch.
      if (ageDays > 1 || state.settings.marks[OPENED_MARK] === date) return;
      state.setMark(OPENED_MARK, date);
      openRoute('/journal');
      return;
    }
    if (actionId !== 'woke-yes' && actionId !== 'woke-no') return;
    await dismissPresented((n) => n.request.content.data?.feature === 'naturalWake' && n.request.content.data?.date === date).catch(() => undefined);
    if (ageDays > MAX_AGE_DAYS) return;
    state.logDay(date, { wokeNaturally: actionId === 'woke-yes' });
  },
};
