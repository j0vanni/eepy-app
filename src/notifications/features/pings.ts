/**
 * 2–3 daily "how alert are you?" pings that feed the energy-forecast calibration (`pings`, `pingsPerDay`).
 * OWNER: learning workstream.
 *
 * Timing (engine/pingPlan.ts): random-but-stable times seeded by the date, 1h after wake-up to 30 min
 * before wind-down, one each in the morning / afternoon-dip / evening third of the waking day; today
 * and tomorrow are planned (the scheduler's horizon is 36h). A ping is skipped when there was a
 * check-in in the 90 minutes before it.
 * Taper: once the fit has ≥ 40 check-ins over ≥ 14 days, one ping a day keeps it current.
 *
 * Responses: the three buttons log KSS 3 / 5 / 7 without opening the app; tapping the body opens
 * /checkin for the full 1–9 scale. A response more than 2h after the ping is ignored (you'd be rating
 * a different moment), and each ping is logged at most once.
 */
import { Platform } from 'react-native';

import { DAY, HOUR } from '../../engine/time';
import { planPingTimes, pingsPerDay, PingSlot } from '../../engine/pingPlan';
import { refitCalibration } from '../../state/learning';
import { AppState, useStore } from '../../state/store';
import type { NotificationFeature, PlannedNotification } from '../types';
import { dismissPresented, openRoute } from './learningShared';

export const PING_CATEGORY = 'eepy-ping';
/** Responses later than this after the ping don't describe the moment it asked about. */
const STALE_MS = 2 * HOUR;
const OPENED_MARK = 'pings.lastOpened';

export const PING_ACTIONS: { id: string; title: string; kss: number }[] = [
  { id: 'ping-alert', title: '😀 Alert', kss: 3 },
  { id: 'ping-ok', title: '😐 OK', kss: 5 },
  { id: 'ping-sleepy', title: '🥱 Sleepy', kss: 7 },
];

const TITLES: Record<PingSlot, string> = {
  morning: 'Morning check: how alert are you?',
  afternoon: 'Quick one: how alert are you right now?',
  evening: 'Evening check: how alert are you?',
};

export const pings: NotificationFeature = {
  id: 'pings',
  categories: [{ id: PING_CATEGORY, actions: PING_ACTIONS.map((a) => ({ id: a.id, title: a.title, opensApp: false })) }],

  plan({ analysis: a, state, now }) {
    const prefs = state.settings.notifications;
    if (!prefs.pings) return [];
    const count = pingsPerDay(prefs.pingsPerDay, state.calibration);
    const checkinTimes = state.checkins.map((c) => c.time);
    const days = [
      { date: a.day, wake: a.wakeTime, windDown: a.tonight.windDownStart },
      // Tomorrow's evening isn't planned yet; tonight's wind-down a day later is a close stand-in.
      { date: a.tonight.wakeDate, wake: a.tonight.wake, windDown: a.tonight.windDownStart + DAY },
    ];
    const out: PlannedNotification[] = [];
    for (const d of days) {
      for (const p of planPingTimes({ ...d, count, checkinTimes })) {
        if (p.at <= now) continue;
        out.push({
          id: p.id,
          at: p.at,
          channel: 'pings',
          categoryId: PING_CATEGORY,
          title: TITLES[p.slot],
          body: 'Tap how you feel, or open eepy for the full 1–9 scale. Each answer sharpens your energy forecast.',
          data: { pid: p.id, at: p.at, slot: p.slot },
        });
      }
    }
    return out;
  },

  async onResponse({ actionId, data }) {
    const pid = typeof data.pid === 'string' ? data.pid : undefined;
    if (!pid) return;
    const at = typeof data.at === 'number' ? data.at : undefined;
    const now = Date.now();
    const fresh = at === undefined || now - at <= STALE_MS;
    const state: AppState = useStore.getState();

    if (actionId === 'default') {
      // Body tap → full scale. Guard against the same response being re-delivered on a later launch.
      if (!fresh || state.settings.marks[OPENED_MARK] === pid) return;
      state.setMark(OPENED_MARK, pid);
      openRoute('/checkin');
      return;
    }

    const action = PING_ACTIONS.find((x) => x.id === actionId);
    if (!action) return;
    if (Platform.OS !== 'web') await dismissPresented((n) => n.request.content.data?.pid === pid).catch(() => undefined);
    const id = `ping-${pid}`;
    if (!fresh || state.checkins.some((c) => c.id === id)) return;
    state.addCheckIn({ id, time: now, kss: action.kss, source: 'ping' });
    refitCalibration(useStore.getState());
  },
};
