import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { MINUTE } from '../engine/time';
import { configureNotifications, ensureNotificationPermission } from './channels';

/** One-off nap alarm (exact alarm-clock delivery). Returns the notification id to cancel it later. */
export async function scheduleNapAlarm(minutes: number, label: string): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;
  await configureNotifications();
  if (!(await ensureNotificationPermission())) return undefined;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Nap over — time to get up',
      body: `${label} finished. Get some light and move around to shake off grogginess.`,
      sound: 'default',
      priority: 'max',
      data: { feature: 'nap' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: Date.now() + minutes * MINUTE, channelId: 'alarms', delivery: 'alarmClock' },
  });
}

export async function cancelNotification(id?: string): Promise<void> {
  if (!id || Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
}
