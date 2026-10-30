import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { formatTime, MINUTE } from '../engine/time';
import { configureNotifications, ensureNotificationPermission } from './channels';
import { cancelFullScreenAlarm, NAP_ALARM_ID, NAP_ALARM_LINK, scheduleFullScreenAlarm, WRIST_BUZZ_OFFSETS_MIN } from './fullScreenAlarm';
import { NAP_ALARM_CATEGORY, NAP_NOTIFICATION_ID, NAP_TIMER_CATEGORY, NAP_TIMER_KIND, NAP_WRIST_IDS, NapState } from './napTimer';

/** Taps and buttons on nap notifications are routed by the reminders feature. */
const NAP_DATA = { feature: 'reminders', kind: NAP_TIMER_KIND };

/** Silent, exact buzzes on the 'wrist' channel (Nothing X mirrors them to the watch). */
async function scheduleWristBuzzes(ids: string[], at: number, content: (i: number) => Notifications.NotificationContentInput): Promise<void> {
  for (const [i, offset] of WRIST_BUZZ_OFFSETS_MIN.entries()) {
    if (!ids[i]) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: ids[i],
      content: { sound: false, priority: 'max', ...content(i) },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at + offset * MINUTE, channelId: 'wrist', delivery: 'alarmClock' },
    }).catch((e) => console.warn('wrist buzz failed', ids[i], e));
  }
}

/**
 * One-off nap alarm (exact alarm-clock delivery). Returns the id to cancel it later (stopNapTimer
 * clears both kinds). Uses the native full-screen lock-screen alarm when this build has it, else
 * an expo-notifications alarm — never both. With `wristBackupMin` the watch buzzes first and the
 * phone alarm only rings that many minutes later, as a backup.
 */
export async function scheduleNapAlarm(
  minutes: number,
  label: string,
  opts: { at?: number; start?: number; wristBackupMin?: number } = {},
): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;
  await configureNotifications();
  if (!(await ensureNotificationPermission())) return undefined;
  const wristAt = opts.at ?? Date.now() + minutes * MINUTE;
  const at = opts.wristBackupMin !== undefined ? wristAt + opts.wristBackupMin * MINUTE : wristAt;
  if (opts.wristBackupMin !== undefined) {
    const backup = formatTime(at);
    await scheduleWristBuzzes(NAP_WRIST_IDS, wristAt, (i) => ({
      title: i === 0 ? 'Nap over ⌚ time to get up' : 'Still napping?',
      body: `${label} finished. Tap "I'm up" or the phone alarm rings at ${backup}.`,
      categoryIdentifier: NAP_ALARM_CATEGORY,
      data: { ...NAP_DATA, start: opts.start, wrist: true },
    }));
  }
  const title = 'Nap over — time to get up';
  const body = `${label} finished. Get some light and move around to shake off grogginess.`;
  // The pinned "Napping" card stays up until the nap is stopped ("I'm up" opens the Nap screen).
  if (await scheduleFullScreenAlarm(NAP_ALARM_ID, at, title, body, NAP_ALARM_LINK)) return NAP_NOTIFICATION_ID;
  return Notifications.scheduleNotificationAsync({
    // Shares the pinned card's identifier, so the alarm replaces the card when it rings.
    identifier: NAP_NOTIFICATION_ID,
    content: {
      title,
      body,
      sound: 'default',
      priority: 'max',
      categoryIdentifier: NAP_ALARM_CATEGORY,
      data: { ...NAP_DATA, start: opts.start },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
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
  const watch = state.settings.watch;
  const wristBackupMin = watch?.napAlarm === 'wrist' ? watch.backupMin : undefined;
  const notificationId = await scheduleNapAlarm(option.alarmAfterMin, option.label, { at: alarmAt, start: now, wristBackupMin });
  state.setSettings({ napTimer: { ...timer, notificationId, ...(wristBackupMin !== undefined ? { backupAt: alarmAt + wristBackupMin * MINUTE } : {}) } });
}

/** Cancels a scheduled notification and the native full-screen alarm with the same id, if any. */
export async function cancelNotification(id?: string): Promise<void> {
  if (!id || Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
  await cancelFullScreenAlarm(id);
}

/** A one-off buzz to check that Nothing X mirrors eepy's notifications to the watch. */
export async function sendWatchTestBuzz(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  await configureNotifications();
  if (!(await ensureNotificationPermission())) return false;
  await Notifications.scheduleNotificationAsync({
    identifier: 'eepy-watch-test',
    content: {
      title: 'eepy test buzz ⌚',
      body: 'If your CMF Watch just vibrated and shows this, watch-first alarms will work.',
      sound: false,
      priority: 'max',
    },
    trigger: { channelId: 'wrist' },
  });
  return true;
}
