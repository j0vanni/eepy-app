/**
 * Core daily reminders: wind-down, bedtime, caffeine cut-off, morning check-in, cycle-timed wake alarm.
 * OWNER: background & notifications workstream (adaptive behaviour goes here).
 */
import { formatTime, MINUTE } from '../../engine/time';
import type { NotificationFeature, PlannedNotification } from '../types';

export const reminders: NotificationFeature = {
  id: 'reminders',
  plan({ analysis: a, state }) {
    const prefs = state.settings.notifications;
    const t = a.tonight;
    const out: PlannedNotification[] = [];
    if (prefs.windDown) {
      out.push({
        id: 'winddown',
        at: t.windDownStart,
        channel: 'reminders',
        title: 'Time to wind down 🌙',
        body: `Dim the lights and put screens away — lights out at ${formatTime(t.bedtime)}.`,
      });
    }
    if (prefs.bedtime) {
      out.push({
        id: 'bedtime',
        at: t.bedtime,
        channel: 'reminders',
        title: 'Lights out',
        body: `Going to sleep now gets you ${Math.round((a.need.needMin / 60) * 10) / 10}h before ${formatTime(t.wake)}.`,
      });
    }
    if (prefs.caffeine && a.caffeine.cutoff.cutoff) {
      out.push({
        id: 'caffeine',
        at: a.caffeine.cutoff.cutoff - 15 * MINUTE,
        channel: 'reminders',
        title: 'Last call for caffeine ☕',
        body: `Caffeine after ${formatTime(a.caffeine.cutoff.cutoff)} will still be in your system at bedtime.`,
      });
    }
    if (prefs.morningCheckIn) {
      out.push({
        id: 'checkin',
        at: t.wake + 45 * MINUTE,
        channel: 'reminders',
        title: 'How did you sleep?',
        body: 'Rate last night and log anything from yesterday — it sharpens your sleep-need estimate.',
      });
    }
    if (prefs.smartAlarm) {
      out.push({
        id: 'wake',
        at: a.alarm.alarm,
        channel: 'alarms',
        alarm: true,
        title: 'Good morning ☀️',
        body: a.alarm.onBoundary ? 'Woken at the end of a sleep cycle.' : 'Time to get up.',
      });
    }
    return out;
  },
};
