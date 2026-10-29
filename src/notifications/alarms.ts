import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { formatTime, MINUTE } from '../engine/time';
import { configureNotifications, ensureNotificationPermission } from './channels';
import { NAP_ALARM_CATEGORY, NAP_NOTIFICATION_ID, NAP_TIMER_CATEGORY, NAP_TIMER_KIND, NapState } from './napTimer';

/** Taps and buttons on nap notifications are routed by the reminders feature. */
const NAP_DATA = { feature: 'reminders', kind: NAP_TIMER_KIND };

/** One-off nap alarm (exact alarm-clock delivery). Returns the notification id to cancel it later. */
export async function scheduleNapAlarm(minutes: number, label: string, opts: { at?: number; start?: number } = {}): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;
  await configureNotifications();
  if (!(await ensureNotificationPermission())) return undefined;
  return Notifications.scheduleNotificationAsync({
    // Shares the pinned card's identifier, so the alarm replaces the card when it rings.
    identifier: NAP_NOTIFICATION_ID,
    content: {
      title: 'Nap over — time to get up',
      body: `${label} finished. Get some light and move around to shake off grogginess.`,
      sound: 'default',
      priority: 'max',
      categoryIdentifier: NAP_ALARM_CATEGORY,
      data: { ...NAP_DATA, start: opts.start },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: opts.at ?? Date.now() + minutes * MINUTE,
      channelId: 'alarms',
      delivery: 'alarmClock',
    },
  });
}

/** Pinned, silent "Napping · alarm at 14:45" card shown while a nap timer runs (replaced by the alarm). */
export async function showNapOngoing(timer: { start: number; alarmAt: number; label: string }): Promise<void> {
  if (Platform.OS === 'web') return;
  await configureNotifications();
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  await Notifications.scheduleNotificationAsync({
    identifier: NAP_NOTIFICATION_ID,
    content: {
      title: `Napping · alarm at ${formatTime(timer.alarmAt)}`,
      body: `${timer.label}. Lie down somewhere dark and quiet — even dozing helps.`,
      sticky: true,
      autoDismiss: false,
      sound: false,
      priority: 'low',
      categoryIdentifier: NAP_TIMER_CATEGORY,
      data: { ...NAP_DATA, start: timer.start },
    },
    // Present now, in the low-importance "Live countdowns" channel.
    trigger: { channelId: 'live' },
  });
}

/** Starts a nap: pinned card + exact alarm, and the timer in settings (stop it with stopNapTimer). */
export async function startNapTimer(state: NapState, option: { alarmAfterMin: number; label: string }, now = Date.now()): Promise<void> {
  const alarmAt = now + option.alarmAfterMin * MINUTE;
  const timer = { start: now, alarmAt, label: option.label };
  await showNapOngoing(timer).catch((e) => console.warn('nap card failed', e));
  const notificationId = await scheduleNapAlarm(option.alarmAfterMin, option.label, { at: alarmAt, start: now });
  state.setSettings({ napTimer: { ...timer, notificationId } });
}

export async function cancelNotification(id?: string): Promise<void> {
  if (!id || Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
}
