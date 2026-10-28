import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Analysis } from '../engine/analysis';
import { formatTime, MINUTE } from '../engine/time';
import type { NotificationPrefs } from './store';

const CHANNEL_REMINDERS = 'reminders';
const CHANNEL_ALARMS = 'alarms';
const DAILY_IDS = ['eepy-winddown', 'eepy-bedtime', 'eepy-caffeine', 'eepy-checkin', 'eepy-wake'];

let configured = false;

export async function configureNotifications(): Promise<void> {
  if (configured || Platform.OS === 'web') return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_REMINDERS, {
      name: 'Sleep reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_ALARMS, {
      name: 'Nap & wake alarms',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 600, 300, 600, 300, 600],
      sound: 'default',
      bypassDnd: true,
    });
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

async function scheduleAt(id: string, at: number, title: string, body: string, alarm = false) {
  if (at <= Date.now() + MINUTE) return;
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body, sound: alarm ? 'default' : undefined, priority: alarm ? 'max' : 'default', data: { kind: id } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: alarm ? CHANNEL_ALARMS : CHANNEL_REMINDERS,
      delivery: alarm ? 'alarmClock' : 'bestEffort',
    },
  });
}

/** Re-plans today's reminders from the latest analysis. Safe to call often. */
export async function scheduleDailyReminders(a: Analysis, prefs: NotificationPrefs): Promise<void> {
  if (Platform.OS === 'web') return;
  await configureNotifications();
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;
  await Promise.all(DAILY_IDS.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  const t = a.tonight;
  if (prefs.windDown) {
    await scheduleAt('eepy-winddown', t.windDownStart, 'Time to wind down 🌙', `Dim the lights and put screens away — lights out at ${formatTime(t.bedtime)}.`);
  }
  if (prefs.bedtime) {
    await scheduleAt('eepy-bedtime', t.bedtime, 'Lights out', `Going to sleep now gets you ${Math.round(a.need.needMin / 60 * 10) / 10}h before ${formatTime(t.wake)}.`);
  }
  if (prefs.caffeine && a.caffeine.cutoff.cutoff) {
    await scheduleAt('eepy-caffeine', a.caffeine.cutoff.cutoff - 15 * MINUTE, 'Last call for caffeine ☕', `Caffeine after ${formatTime(a.caffeine.cutoff.cutoff)} will still be in your system at bedtime.`);
  }
  if (prefs.morningCheckIn) {
    await scheduleAt('eepy-checkin', t.wake + 45 * MINUTE, 'How did you sleep?', 'Rate last night and log anything from yesterday — it sharpens your sleep-need estimate.');
  }
  if (prefs.smartAlarm) {
    await scheduleAt('eepy-wake', a.alarm.alarm, 'Good morning ☀️', a.alarm.onBoundary ? 'Woken at the end of a sleep cycle.' : 'Time to get up.', true);
  }
}

export async function scheduleNapAlarm(minutes: number, label: string): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;
  await configureNotifications();
  if (!(await ensureNotificationPermission())) return undefined;
  return Notifications.scheduleNotificationAsync({
    content: { title: 'Nap over — time to get up', body: `${label} finished. Get some light and move around to shake off grogginess.`, sound: 'default', priority: 'max' },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: Date.now() + minutes * MINUTE,
      channelId: CHANNEL_ALARMS,
      delivery: 'alarmClock',
    },
  });
}

export async function cancelNotification(id?: string): Promise<void> {
  if (!id || Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
}
