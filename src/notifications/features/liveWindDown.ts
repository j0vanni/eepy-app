/**
 * Pinned wind-down card (`liveWindDown`).
 *
 * expo-notifications (SDK 58) has no chronometer / countdown / `timeoutAfter` on Android content
 * (only `sticky`, `autoDismiss`, `priority`, `color`, `subtitle`), so the card can't tick by
 * itself. Instead it is planned so it never goes stale:
 *  - before wind-down: a sticky card is scheduled for wind-down start;
 *  - during wind-down (any re-plan — app opened or background sync): a notification with the same
 *    identifier is scheduled for lights-out, so at bedtime Android replaces the pinned card in
 *    place with a normal, swipeable "Lights out" message;
 *  - afterwards (or when switched off): any leftover card is dismissed on the next re-plan.
 * Tapping the card opens the wind-down screen (and, being auto-cancel, removes it).
 * OWNER: background & notifications workstream.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Analysis } from '../../engine/analysis';
import { formatDuration, formatTime, MINUTE } from '../../engine/time';
import type { AppState } from '../../state/store';
import { markResponseHandled, openFromNotification } from '../navigate';
import type { NotificationFeature, PlannedNotification, PlannerContext } from '../types';
import { DayContext, dayContext, duringNap } from './dayContext';

export const LIVE_WIND_DOWN_FEATURE = 'liveWindDown';
export const LIVE_ID = 'live';
/** Must match how scheduler.ts namespaces planned notifications (`eepy-plan-<feature>-<id>`). */
export const LIVE_NOTIFICATION_IDENTIFIER = `eepy-plan-${LIVE_WIND_DOWN_FEATURE}-${LIVE_ID}`;
/** The "Lights out" message stays this long after lights-out before a re-plan clears it. */
const AFTER_GRACE = 15 * MINUTE;
/** The scheduler drops anything due within 30 s, so treat that as "now". */
const EPS = 30_000;

export type LivePhase = 'off' | 'before' | 'during' | 'after';

export function liveWindDownPhase(a: Analysis, state: AppState, now: number, day: DayContext = dayContext(a, state, now)): LivePhase {
  if (!state.settings.notifications.liveWindDown) return 'off';
  const start = a.tonight.windDownStart;
  // Napping through the start of wind-down (adaptive): stay quiet rather than pin a card mid-nap.
  if (day.adaptive && duringNap(day, start) && now < start) return 'off';
  if (now < start - EPS) return 'before';
  if (now < day.lightsOut - EPS) return 'during';
  return 'after';
}

function checklist(a: Analysis, state: AppState, day: DayContext): string {
  const lines = ['☐ Dim the lights', '☐ Screens away (or night mode)', '☐ Cool, dark, quiet room'];
  if (day.adaptive && day.lateCaffeine) lines.push('Caffeine is still around tonight — keep this hour extra calm.');
  else if (day.adaptive && day.napShiftMin > 0) lines.push(`Lights out is ${day.napShiftMin} min later tonight after your nap.`);
  const wake = state.settings.notifications.smartAlarm ? a.alarm.alarm : a.tonight.wake;
  lines.push(`Wake-up ${formatTime(wake)} · tap for your routine`);
  return lines.join('\n');
}

function lightsOutBody(a: Analysis, day: DayContext): string {
  const inBed = formatDuration((a.tonight.wake - day.lightsOut) / MINUTE);
  const base = `Wind-down done — lights out now gives you ${inBed} in bed before ${formatTime(a.tonight.wake)}.`;
  if (day.adaptive && day.lateCaffeine) return `${base} Not sleepy yet? Read in dim light until you are.`;
  return base;
}

/** Pure planning step (see the module comment for the phases). */
export function planLiveWindDown({ analysis: a, state, now }: PlannerContext): PlannedNotification[] {
  const day = dayContext(a, state, now);
  const phase = liveWindDownPhase(a, state, now, day);
  const prefs = state.settings.notifications;
  if (phase === 'before') {
    return [
      {
        id: LIVE_ID,
        at: a.tonight.windDownStart,
        // The card replaces the plain wind-down reminder, so it alerts only if that reminder is on.
        channel: prefs.windDown ? 'reminders' : 'live',
        sticky: true,
        title: `Wind-down · lights out at ${formatTime(day.lightsOut)}`,
        body: checklist(a, state, day),
        data: { route: '/winddown' },
      },
    ];
  }
  if (phase === 'during') {
    if (day.adaptive && duringNap(day, day.lightsOut)) return [];
    return [
      {
        id: LIVE_ID,
        at: day.lightsOut,
        // Same identifier: replaces the pinned card in place. Carries the bedtime reminder too.
        channel: prefs.bedtime ? 'reminders' : 'live',
        title: `Lights out · ${formatTime(day.lightsOut)}`,
        body: lightsOutBody(a, day),
      },
    ];
  }
  return [];
}

/** Whether a re-plan at `now` should clear a leftover pinned card. */
export function shouldDismissLiveWindDown(a: Analysis, state: AppState, now: number): boolean {
  const day = dayContext(a, state, now);
  const phase = liveWindDownPhase(a, state, now, day);
  return phase === 'off' || phase === 'before' || (phase === 'after' && now >= day.lightsOut + AFTER_GRACE);
}

/** True when the live card will deliver tonight's "Lights out" itself (reminders then skips its own). */
export function liveWindDownCoversBedtime(a: Analysis, state: AppState, now: number, day?: DayContext): boolean {
  return liveWindDownPhase(a, state, now, day) === 'during';
}

function dismissLiveCard(): void {
  if (Platform.OS === 'web') return;
  Notifications.dismissNotificationAsync(LIVE_NOTIFICATION_IDENTIFIER).catch(() => undefined);
}

export const liveWindDown: NotificationFeature = {
  id: LIVE_WIND_DOWN_FEATURE,
  plan(ctx) {
    if (shouldDismissLiveWindDown(ctx.analysis, ctx.state, ctx.now)) dismissLiveCard();
    return planLiveWindDown(ctx);
  },
  onResponse(r) {
    markResponseHandled();
    if (r.actionId === 'default' && r.data.route === '/winddown') openFromNotification('/winddown');
  },
};
