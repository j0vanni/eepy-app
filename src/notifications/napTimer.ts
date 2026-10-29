/**
 * Nap timer notifications: the ids, and stopping a running timer (from the Nap screen or the
 * notification's buttons). Starting one lives in ./alarms (it needs the channel setup).
 *
 * Keep this module free of imports from ./channels or ./features: the reminders feature imports
 * it, and channels.ts imports every feature — a cycle would leave FEATURES half-initialised.
 * (./fullScreenAlarm follows the same rule, so importing it here is fine.)
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { MINUTE } from '../engine/time';
import type { AppState } from '../state/store';
import { cancelFullScreenAlarm, NAP_ALARM_ID } from './fullScreenAlarm';

/**
 * One identifier for everything nap-related: the pinned "Napping" card is presented under it and
 * the alarm is scheduled under it, so when the alarm fires Android replaces the card in place.
 */
export const NAP_NOTIFICATION_ID = 'eepy-nap';
export const NAP_TIMER_KIND = 'nap-timer';
/** Action-button categories (registered by the reminders feature, which also routes the taps). */
export const NAP_TIMER_CATEGORY = 'nap-timer';
export const NAP_ALARM_CATEGORY = 'nap-alarm';

export type NapState = Pick<AppState, 'settings' | 'setSettings' | 'addManualSession'>;

/**
 * Cancels the nap alarm and removes the pinned card (or the alarm, if it already rang) — including
 * the native full-screen alarm and its snooze, which stop ringing if they are.
 */
export async function clearNapNotifications(id: string | undefined = NAP_NOTIFICATION_ID): Promise<void> {
  if (Platform.OS === 'web') return;
  for (const x of new Set([id ?? NAP_NOTIFICATION_ID, NAP_NOTIFICATION_ID])) {
    await Notifications.cancelScheduledNotificationAsync(x).catch(() => undefined);
  }
  await Notifications.dismissNotificationAsync(NAP_NOTIFICATION_ID).catch(() => undefined);
  await cancelFullScreenAlarm(NAP_ALARM_ID);
}

/** Stops the running nap timer, optionally logging the nap as a manual session. */
export async function stopNapTimer(state: NapState, log: boolean, now = Date.now()): Promise<void> {
  const timer = state.settings.napTimer;
  if (!timer) return;
  await clearNapNotifications(timer.notificationId);
  if (log) {
    const end = Math.min(now, timer.alarmAt);
    const sleepStart = Math.min(end - MINUTE, timer.start + 7 * MINUTE);
    state.addManualSession({
      id: `nap-${timer.start}`,
      source: 'manual',
      start: timer.start,
      end,
      kind: 'nap',
      stages: [
        { stage: 'awake', start: timer.start, end: sleepStart },
        { stage: 'light', start: sleepStart, end },
      ],
    });
  }
  state.setSettings({ napTimer: undefined });
}
