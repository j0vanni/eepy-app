/**
 * "Screens off" / "Phone down" reminder (`screensOff`) at tonight's phone-down: with the bedtime
 * rundown on, lights-out minus its screen-free steps (engine/rundown.ts), and the text says what
 * comes next (teeth, reading time…); with it off, the wind-down timeline's screens-off time
 * (Settings → Wind-down: 30/45/60 min before lights-out). Follows an adjusted or eased night; quiet
 * once you're in bed ("I'm in bed"), during a nap timer (adaptive) and once the guided player has
 * passed phone-down. Tap → wind-down. With an e-ink reader on, it says the e-reader is fine
 * (frontlight low, and warm if it can be).
 */
import { eReaderIfOn } from '../../engine/eReader';
import { inBedTonight } from '../../engine/inBed';
import { phoneDownAt, progressFor, rundownFor, screenFreeSummary } from '../../engine/rundown';
import { formatTime } from '../../engine/time';
import { markResponseHandled, openFromNotification } from '../navigate';
import type { NotificationFeature } from '../types';
import { dayContext, duringNap } from './dayContext';

export const screensOff: NotificationFeature = {
  id: 'screensOff',
  plan({ analysis: a, state, now }) {
    if (!state.settings.notifications.screensOff || inBedTonight(state.settings.session, a.tonight.wakeDate)) return [];
    const at = phoneDownAt(a.tonight, state.settings);
    if (at >= a.tonight.bedtime) return [];
    const day = dayContext(a, state, now);
    if (day.adaptive && duringNap(day, at)) return [];
    // Already past phone-down in the guided player tonight.
    if (progressFor(state.settings.rundownProgress, a.tonight.wakeDate)?.marks['phone-down']) return [];
    const bed = formatTime(a.tonight.bedtime);
    const e = eReaderIfOn(state.settings.eReader);
    const r = rundownFor(a, state);
    if (r) {
      const next = screenFreeSummary(r);
      return [
        {
          id: a.tonight.wakeDate,
          at,
          channel: 'reminders',
          title: 'Phone down 📵',
          body: `Charger across the room, face down${e ? ` — e-reader's fine, frontlight low${e.warmLight ? ' and warm' : ''}` : ''}. ${next ? `Next: ${next}. ` : ''}Lights out at ${bed}.`,
          data: { route: '/winddown' },
        },
      ];
    }
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
