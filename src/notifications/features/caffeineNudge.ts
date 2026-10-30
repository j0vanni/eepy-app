/**
 * "Had your usual coffee?" (`caffeineNudge`): when the usual morning drink (learned from the
 * caffeine log, see engine/caffeineHabits.ts) hasn't been logged an hour after its usual time,
 * ask once. "Yes" logs it at the usual time — not when you answered — so the caffeine curve,
 * cut-off and bedtime advice stay right; "Not today" stops asking until tomorrow; tapping the
 * notification opens the drink editor to set the exact time.
 */
import { addDays, atMinutes, dateKey, formatClock, MINUTE } from '../../engine/time';
import { USUAL_SKIPPED_MARK, usualCaffeine, usualDoseId, usualNudgeAt } from '../../engine/caffeineHabits';
import { useStore } from '../../state/store';
import type { NotificationFeature, PlannedNotification } from '../types';
import { dismissPresented, openRoute } from './learningShared';

export const CAFFEINE_NUDGE_CATEGORY = 'eepy-usual-coffee';
/** Stop asking once the habit looks over (no morning drink logged for this long). */
const STALE_DAYS = 7;
const OPENED_MARK = 'caffeineNudge.lastOpened';

const shortDrink = (label: string) => label.replace(/\s*\(.*\)/, '').toLowerCase();

export const caffeineNudge: NotificationFeature = {
  id: 'caffeineNudge',
  categories: [
    {
      id: CAFFEINE_NUDGE_CATEGORY,
      actions: [
        { id: 'coffee-yes', title: 'Yes, at my usual time', opensApp: false },
        { id: 'coffee-no', title: 'Not today', opensApp: false },
      ],
    },
  ],

  plan({ state, now }) {
    if (!state.settings.notifications.caffeineNudge) return [];
    const usual = usualCaffeine(state.caffeine, now);
    const today = dateKey(now);
    if (!usual || usual.lastDate < addDays(today, -STALE_DAYS)) return [];
    const out: PlannedNotification[] = [];
    for (const date of [today, addDays(today, 1)]) {
      if (state.caffeine.some((d) => dateKey(d.time) === date)) continue;
      if (state.settings.marks[USUAL_SKIPPED_MARK] === date) continue;
      const at = usualNudgeAt(usual, date);
      if (at === undefined) continue;
      out.push({
        id: date,
        at,
        channel: 'reminders',
        categoryId: CAFFEINE_NUDGE_CATEGORY,
        title: 'Had your usual coffee? ☕',
        body: `Nothing logged yet today. "Yes" logs your ${shortDrink(usual.label)} (${usual.mg} mg) at ${formatClock(usual.timeMin)} — or tap to set the exact time.`,
        data: { date, timeMin: usual.timeMin, mg: usual.mg, label: usual.label },
      });
    }
    return out;
  },

  async onResponse({ actionId, data }) {
    const date = typeof data.date === 'string' ? data.date : undefined;
    if (!date) return;
    const state = useStore.getState();
    const now = Date.now();
    // Answers about an older day (a replayed response) are ignored.
    if (now - atMinutes(date, 0) > 2 * 24 * 60 * MINUTE) return;
    if (actionId === 'default') {
      if (state.settings.marks[OPENED_MARK] === date) return;
      state.setMark(OPENED_MARK, date);
      openRoute({ pathname: '/caffeine', params: { usual: '1' } });
      return;
    }
    if (actionId !== 'coffee-yes' && actionId !== 'coffee-no') return;
    await dismissPresented((n) => n.request.content.data?.feature === 'caffeineNudge' && n.request.content.data?.date === date).catch(() => undefined);
    if (actionId === 'coffee-no') {
      state.setMark(USUAL_SKIPPED_MARK, date);
      return;
    }
    const { timeMin, mg, label } = data;
    if (typeof timeMin !== 'number' || typeof mg !== 'number' || typeof label !== 'string') return;
    const id = usualDoseId(date);
    if (state.caffeine.some((d) => d.id === id)) return;
    state.addCaffeine({ id, time: Math.min(now, atMinutes(date, timeMin)), mg, label });
  },
};
