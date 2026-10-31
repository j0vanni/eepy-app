/**
 * Morning report as soon as last night syncs (`settings.notifications.morningReport`):
 * "Last night: 7h 12m · score 82 · debt 2h ▼" + the night story's one-liner ("REM short (14% vs
 * 21%) — likely drinking alcohol.") + a line about today (nap, caffeine, lights out).
 * Sent once per night (`settings.marks.lastReportedWakeDate`), between waking and noon. If eepy is
 * open on screen when the night lands, the night is marked as reported without a notification —
 * the Today screen already shows it. Tapping the notification opens the night's details.
 * OWNER: background & notifications workstream.
 */
import { AppState as RNAppState } from 'react-native';

import type { Analysis } from '../../engine/analysis';
import { debtOnDate } from '../../engine/sleepDebt';
import { addDays, atMinutes, formatDuration, formatTime, HOUR } from '../../engine/time';
import { markResponseHandled, openFromNotification } from '../navigate';
import type { NotificationFeature, PlannedNotification, PlannerContext } from '../types';

export const REPORT_MARK = 'lastReportedWakeDate';

/** The report is only worth sending in the morning: until noon, or 2h after a late wake-up. */
export function reportDeadline(wakeDate: string, finalWake: number): number {
  return Math.max(atMinutes(wakeDate, 12 * 60), finalWake + 2 * HOUR);
}

function formatDebt(min: number): string {
  if (min < 15) return 'no debt';
  if (min < 60) return `debt ${Math.round(min / 5) * 5}m`;
  return `debt ${Math.round(min / 30) / 2}h`;
}

export function reportTitle(a: Analysis): string {
  const main = a.lastNight!.main!;
  const parts = [`Last night: ${formatDuration(main.totalSleepMin)}`];
  const score = a.scores[main.id]?.total;
  if (score !== undefined) parts.push(`score ${score}`);
  const yesterday = debtOnDate(a.nights, a.need.needMin, addDays(a.day, -1));
  const delta = a.debt.debtMin - yesterday;
  const arrow = delta <= -10 ? ' ▼' : delta >= 10 ? ' ▲' : '';
  parts.push(`${formatDebt(a.debt.debtMin)}${a.debt.debtMin >= 15 ? arrow : ''}`);
  return parts.join(' · ');
}

export function reportBody(a: Analysis): string {
  const n = a.nap;
  const win = n.window ? `${formatTime(n.window.start)}–${formatTime(n.window.end)}` : undefined;
  const parts: string[] = [];
  switch (n.verdict) {
    case 'nap-now':
      parts.push(win ? `A nap would help — best ${win}` : 'A nap would help today');
      break;
    case 'nap-later':
      parts.push(win ? `Nap window ${win}` : 'Plan a short nap this afternoon');
      break;
    case 'optional':
      parts.push(win ? `Nap optional (${win})` : 'Nap optional');
      break;
    default:
      parts.push('No nap needed');
  }
  if (a.caffeine.cutoff.cutoff) parts.push(`caffeine until ${formatTime(a.caffeine.cutoff.cutoff)}`);
  else if (a.caffeine.cutoff.overLimit) parts.push('no more caffeine today');
  parts.push(`lights out ${formatTime(a.tonight.bedtime)}`);
  return `Today: ${parts.join(' · ')}`;
}

/** Pure planning step: the report for the night that ended this morning, if it's due. */
export function planMorningReport({ analysis: a, state, now }: PlannerContext): PlannedNotification[] {
  if (!state.settings.notifications.morningReport) return [];
  const night = a.lastNightIsCurrent ? a.lastNight : undefined;
  const main = night?.main;
  if (!night || !main) return [];
  if (state.settings.marks[REPORT_MARK] === night.wakeDate) return [];
  if (now < main.finalWake || now > reportDeadline(night.wakeDate, main.finalWake)) return [];
  return [
    {
      id: `report-${night.wakeDate}`,
      at: now,
      immediate: true,
      channel: 'reports',
      title: reportTitle(a),
      body: a.lastNightStory?.sessionId === main.id ? `${a.lastNightStory.oneLiner}\n${reportBody(a)}` : reportBody(a),
      data: { nightId: main.id, wakeDate: night.wakeDate },
    },
  ];
}

// Re-plans can overlap (the open app and a background run share one JS context); never send twice.
const reportedThisSession = new Set<string>();

export const morningReport: NotificationFeature = {
  id: 'morningReport',
  plan(ctx) {
    const planned = planMorningReport(ctx);
    const wakeDate = planned[0]?.data?.wakeDate;
    if (typeof wakeDate !== 'string' || reportedThisSession.has(wakeDate)) return [];
    reportedThisSession.add(wakeDate);
    ctx.state.setMark(REPORT_MARK, wakeDate);
    // Looking at eepy right now: the Today screen already shows last night.
    if (!ctx.background && RNAppState.currentState === 'active') return [];
    return planned;
  },
  onResponse(r) {
    markResponseHandled();
    const id = r.data.nightId;
    if (r.actionId === 'default' && typeof id === 'string') openFromNotification({ pathname: '/night/[id]', params: { id } });
  },
};
