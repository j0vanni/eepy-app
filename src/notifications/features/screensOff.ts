/**
 * "Screens off" reminder (`screensOff`) at the wind-down timeline's screens-off time (Settings →
 * Wind-down: 30/45/60 min before lights-out). Follows an adjusted or eased night. Tap → wind-down.
 * With an e-ink reader on, it says the e-reader is fine (frontlight low, and warm if it can be).
 */
import { eReaderIfOn } from '../../engine/eReader';
import { formatTime } from '../../engine/time';
import { screensOffAt } from '../../engine/windDownPlan';
import { markResponseHandled, openFromNotification } from '../navigate';
import type { NotificationFeature } from '../types';

export const screensOff: NotificationFeature = {
  id: 'screensOff',
  plan({ analysis: a, state }) {
    if (!state.settings.notifications.screensOff) return [];
    const at = screensOffAt(a.tonight, state.settings.screensOffMin);
    if (at >= a.tonight.bedtime) return [];
    const bed = formatTime(a.tonight.bedtime);
    const e = eReaderIfOn(state.settings.eReader);
    return [
      {
        id: a.tonight.wakeDate,
        at,
        channel: 'reminders',
        title: 'Screens off 📵',
        body: e
          ? `Phone down — e-reader's fine, frontlight low${e.warmLight ? ' and warm' : ''}. Send last messages, check your alarm, then phone on the charger, face down — lights out at ${bed}.`
          : `Send last messages, check your alarm, then phone on the charger, face down — lights out at ${bed}. Sleep sounds keep playing.`,
        data: { route: '/winddown' },
      },
    ];
  },
  onResponse(r) {
    markResponseHandled();
    if (r.actionId === 'default') openFromNotification('/winddown');
  },
};
