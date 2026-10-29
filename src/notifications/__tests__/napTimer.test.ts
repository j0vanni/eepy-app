jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn(() => Promise.resolve()),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  scheduleNotificationAsync: jest.fn((req: { identifier: string }) => Promise.resolve(req.identifier)),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
  clearLastNotificationResponse: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { MINUTE } from '../../engine/time';
import type { AppState, NapTimer } from '../../state/store';
import { reminders } from '../features/reminders';
import { startNapTimer } from '../alarms';
import { NAP_NOTIFICATION_ID, stopNapTimer } from '../napTimer';
import { at, scenario, WORKDAY } from './helpers';

const schedule = Notifications.scheduleNotificationAsync as jest.Mock;

function napState(timer?: NapTimer): AppState {
  const ctx = scenario(at(WORKDAY, 8.5));
  return { ...ctx.state, settings: { ...ctx.state.settings, napTimer: timer } };
}

beforeEach(() => jest.clearAllMocks());

describe('nap timer notifications', () => {
  it('pins a "Napping" card and schedules the alarm under the same identifier', async () => {
    const state = napState();
    const now = at(WORKDAY, 14);
    await startNapTimer(state, { alarmAfterMin: 25, label: 'Power nap' }, now);
    expect(schedule).toHaveBeenCalledTimes(2);
    const [card, alarm] = schedule.mock.calls.map((c) => c[0]);
    expect(card).toMatchObject({ identifier: NAP_NOTIFICATION_ID, trigger: { channelId: 'live' }, content: { sticky: true, autoDismiss: false, title: 'Napping · alarm at 14:25' } });
    expect(alarm).toMatchObject({ identifier: NAP_NOTIFICATION_ID, trigger: { channelId: 'alarms', date: now + 25 * MINUTE, delivery: 'alarmClock' } });
    expect(state.setSettings).toHaveBeenCalledWith({ napTimer: { start: now, alarmAt: now + 25 * MINUTE, label: 'Power nap', notificationId: NAP_NOTIFICATION_ID } });
  });

  it('removes the card and the alarm when the nap is stopped, logging it if asked', async () => {
    const start = at(WORKDAY, 14);
    const state = napState({ start, alarmAt: start + 25 * MINUTE, label: 'Power nap', notificationId: NAP_NOTIFICATION_ID });
    await stopNapTimer(state, true, start + 30 * MINUTE);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(NAP_NOTIFICATION_ID);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(NAP_NOTIFICATION_ID);
    expect(state.addManualSession).toHaveBeenCalledWith(expect.objectContaining({ id: `nap-${start}`, kind: 'nap', start, end: start + 25 * MINUTE }));
    expect(state.setSettings).toHaveBeenCalledWith({ napTimer: undefined });
  });

  it('handles the "I\'m up" button from the notification, only for the matching timer', async () => {
    const start = at(WORKDAY, 14);
    const state = napState({ start, alarmAt: start + 25 * MINUTE, label: 'Power nap', notificationId: NAP_NOTIFICATION_ID });
    await reminders.onResponse!({ actionId: 'nap-done', data: { feature: 'reminders', kind: 'nap-timer', start: start - 1 } }, state);
    expect(state.setSettings).not.toHaveBeenCalled();
    await reminders.onResponse!({ actionId: 'nap-done', data: { feature: 'reminders', kind: 'nap-timer', start } }, state);
    expect(state.addManualSession).toHaveBeenCalled();
    expect(state.setSettings).toHaveBeenCalledWith({ napTimer: undefined });
    expect(router.push).toHaveBeenCalledWith('/nap');
  });
});
