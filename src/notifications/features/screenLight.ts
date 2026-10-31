/**
 * Evening phone-light reminder (`screenLight`): when melatonin starts rising (~3 h before
 * lights-out, see engine/screenLight.ts) — "Night Light on, screen ≤ 40%". Its button opens
 * Android's Night Light settings; a tap opens the wind-down routine. Follows an adjusted night.
 */
import { screenLightSchedule } from '../../engine/screenLight';
import { formatTime } from '../../engine/time';
import { screensOffAt } from '../../engine/windDownPlan';
import { openNightLightSettings } from '../../integrations/screen';
import { markResponseHandled, openFromNotification } from '../navigate';
import type { NotificationFeature } from '../types';

export const SCREEN_LIGHT_CATEGORY = 'screen-light';

export const screenLight: NotificationFeature = {
  id: 'screenLight',
  categories: [{ id: SCREEN_LIGHT_CATEGORY, actions: [{ id: 'night-light', title: 'Night Light settings' }] }],

  plan({ analysis: a, state }) {
    if (!state.settings.notifications.screenLight) return [];
    const plan = { wakeTime: a.wakeTime, windDownStart: a.tonight.windDownStart, bedtime: a.tonight.bedtime, nextWake: a.tonight.wake, screensOff: screensOffAt(a.tonight, state.settings.screensOffMin) };
    const evening = screenLightSchedule(plan).find((t) => t.phase === 'evening');
    if (!evening) return [];
    return [
      {
        id: a.tonight.wakeDate,
        at: evening.from,
        channel: 'reminders',
        categoryId: SCREEN_LIGHT_CATEGORY,
        title: 'Phone light: warm & dim 🌇',
        body: `Melatonin is starting to rise. Night Light on and screen at 40% or less until ${formatTime(a.tonight.windDownStart)}, then as dim as you can read.`,
        data: { route: '/winddown' },
      },
    ];
  },

  async onResponse(r) {
    markResponseHandled();
    if (r.actionId === 'night-light') await openNightLightSettings();
    else if (r.actionId === 'default') openFromNotification('/winddown');
  },
};
