/**
 * "Screens off" reminder (`screensOff`) at the wind-down timeline's screens-off time (Settings →
 * Wind-down: 30/45/60 min before lights-out). Follows an adjusted or eased night. Tap → wind-down.
 */
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
    return [
      {
        id: a.tonight.wakeDate,
        at,
        channel: 'reminders',
        title: 'Screens off 📵',
        body: `Send last messages, check your alarm, then phone on the charger, face down — lights out at ${formatTime(a.tonight.bedtime)}. Sleep sounds keep playing.`,
        data: { route: '/winddown' },
      },
    ];
  },
  onResponse(r) {
    markResponseHandled();
    if (r.actionId === 'default') openFromNotification('/winddown');
  },
};
