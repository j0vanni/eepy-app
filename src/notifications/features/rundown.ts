/**
 * Bedtime rundown reminders (`rundown`, engine/rundown.ts):
 * - "Phone down in 10 min" (`phoneDownSoon`, on by default): last messages and the alarm check
 *   before the phone goes down. Not before wind-down starts. Also with the rundown off (10 min
 *   before screens-off).
 * - Per-step reminders you switch on in Settings → Your bedtime rundown ("Remind me"): a "by" step
 *   (last meal, last drink…) 15 min before its time, anything else when it starts.
 * Phone-down itself is the screens-off reminder (screensOff.ts) and lights-out the bedtime one
 * (reminders.ts, "Reading time's up" with reading time). Like those: quiet once you tapped "I'm in
 * bed", during a nap timer (adaptive), and for steps the guided player has already done.
 * Tap → wind-down.
 */
import { inBedTonight } from '../../engine/inBed';
import { PHONE_DOWN_SOON_MIN, phoneDownAt, progressFor, rundownFor, screenFreeSummary } from '../../engine/rundown';
import { formatTime, MINUTE } from '../../engine/time';
import { markResponseHandled, openFromNotification } from '../navigate';
import type { NotificationFeature, PlannedNotification } from '../types';
import { dayContext, duringNap } from './dayContext';

export const RUNDOWN_FEATURE = 'rundown';
/** A "by" step's reminder comes this long before its time. */
export const BY_STEP_LEAD_MIN = 15;

/** Planner ids (unique within this feature) for tonight's heads-up and step reminders. */
export const phoneDownSoonId = (wakeDate: string) => `${wakeDate}-soon`;
export const rundownStepReminderId = (wakeDate: string, stepId: string) => `${wakeDate}-${stepId}`;

/** The first sentence of a step's description. */
function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?](?=\s+[A-Z"“]|$)/);
  return m ? m[0] : text;
}

export const rundown: NotificationFeature = {
  id: RUNDOWN_FEATURE,
  plan({ analysis: a, state, now }) {
    const t = a.tonight;
    if (inBedTonight(state.settings.session, t.wakeDate)) return [];
    const day = dayContext(a, state, now);
    const napping = (at: number) => day.adaptive && duringNap(day, at);
    const marks = progressFor(state.settings.rundownProgress, t.wakeDate)?.marks ?? {};
    const r = rundownFor(a, state);
    const out: PlannedNotification[] = [];

    if (state.settings.notifications.phoneDownSoon && !marks['phone-down'] && !marks.alarm) {
      const down = phoneDownAt(t, state.settings);
      const at = down - PHONE_DOWN_SOON_MIN * MINUTE;
      if (down < t.bedtime && at >= t.windDownStart && !napping(at)) {
        const next = r ? screenFreeSummary(r) : '';
        out.push({
          id: phoneDownSoonId(t.wakeDate),
          at,
          channel: 'reminders',
          title: `Phone down in ${PHONE_DOWN_SOON_MIN} min`,
          body: r
            ? `Send last messages and check your alarm — at ${formatTime(down)} the phone goes on the charger${next ? `, then ${next}` : ''}.`
            : `Send last messages and check your alarm — screens off at ${formatTime(down)}, lights out at ${formatTime(t.bedtime)}.`,
          data: { route: '/winddown' },
        });
      }
    }

    for (const step of r?.steps ?? []) {
      if (!step.remind || step.status) continue;
      const at = step.kind === 'by' ? step.at - BY_STEP_LEAD_MIN * MINUTE : step.at;
      if (napping(at)) continue;
      out.push({
        id: rundownStepReminderId(t.wakeDate, step.id),
        at,
        channel: 'reminders',
        title: step.kind === 'by' ? `${step.title} by ${formatTime(step.at)}` : step.title,
        body: firstSentence(step.detail),
        data: { route: '/winddown' },
      });
    }
    return out;
  },
  onResponse(r) {
    markResponseHandled();
    if (r.actionId === 'default') openFromNotification('/winddown');
  },
};
