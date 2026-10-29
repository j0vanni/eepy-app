/**
 * Mid-morning nudge to open Nothing X when last night hasn't synced (`missingNightNudge`).
 *
 * Live data only. The nudge for the next 10:00 (today's, then tomorrow's) is kept scheduled while
 * that morning's night is missing, and cancelled by the re-plan that follows a sync bringing the
 * night in — so it still fires when background sync couldn't run at all, which is exactly when
 * it's needed. Never earlier than 90 min after your usual wake-up on that day.
 * OWNER: background & notifications workstream.
 */
import type { Analysis } from '../../engine/analysis';
import { wakeTargetFor } from '../../engine/schedule';
import { addDays, atMinutes, dateKey } from '../../engine/time';
import type { AppState } from '../../state/store';
import { markResponseHandled, openFromNotification } from '../navigate';
import type { NotificationFeature, PlannedNotification, PlannerContext } from '../types';

export const MISSING_NIGHT_MIN = 10 * 60;
export const MISSING_NIGHT_CATEGORY = 'missing-night';

/** When to nudge for the night ending on `date`: 10:00, or 90 min after the usual wake-up if later. */
export function missingNightTime(a: Analysis, state: AppState, date: string): number {
  const { wakeMin: target, isWorkday } = wakeTargetFor(state.profile, date);
  const habitual = (isWorkday ? a.chronotype.habitualWork : a.chronotype.habitualFree)?.wakeMin;
  // Habitual wake can be a clock time just after midnight for night owls; ignore implausible ones.
  const usual = habitual !== undefined && habitual > 4 * 60 && habitual < 14 * 60 ? Math.max(target, habitual) : target;
  return atMinutes(date, Math.max(MISSING_NIGHT_MIN, usual + 90));
}

/** Pure planning step. */
export function planMissingNight({ analysis: a, state, now }: PlannerContext): PlannedNotification[] {
  if (!state.settings.notifications.missingNightNudge) return [];
  if (state.settings.dataMode !== 'live' || !state.profile.onboarded) return [];
  // Only for people whose nights come from the watch via Health Connect.
  if (!state.sessions.some((s) => s.source === 'health-connect')) return [];
  const out: PlannedNotification[] = [];
  const today = dateKey(now);
  for (const date of [today, addDays(today, 1)]) {
    if (a.nights.some((n) => n.wakeDate === date && n.main)) continue;
    const at = missingNightTime(a, state, date);
    if (at <= now) continue;
    out.push({
      id: `missing-${date}`,
      at,
      channel: 'reminders',
      title: "Last night hasn't arrived",
      body: 'Open Nothing X to sync your watch — eepy picks the night up from Health Connect a moment later.',
      categoryId: MISSING_NIGHT_CATEGORY,
      data: { date },
    });
    break; // one pending nudge is enough; the next re-plan schedules the following one
  }
  return out;
}

export const missingNight: NotificationFeature = {
  id: 'missingNight',
  plan: planMissingNight,
  categories: [{ id: MISSING_NIGHT_CATEGORY, actions: [{ id: 'log', title: 'Log it manually' }] }],
  onResponse(r) {
    markResponseHandled();
    // A plain tap just opens eepy, which syncs on launch.
    if (r.actionId === 'log') openFromNotification('/log-sleep');
  },
};
