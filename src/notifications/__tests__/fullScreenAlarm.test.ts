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

// The native module: present (a mock) or absent (undefined, like iOS / web / Expo Go / older APKs).
const mockNative = {
  scheduleAlarm: jest.fn((..._args: unknown[]) => Promise.resolve(true)),
  cancelAlarm: jest.fn((_id: string) => Promise.resolve()),
  canUseFullScreenIntent: jest.fn(() => Promise.resolve(true)),
  openFullScreenIntentSettings: jest.fn(() => Promise.resolve()),
};
const mockModule: { available: boolean } = { available: true };
jest.mock('../../../modules/eepy-alarm', () => ({
  __esModule: true,
  get default() {
    return mockModule.available ? mockNative : undefined;
  },
}));

import * as Notifications from 'expo-notifications';

import { MINUTE } from '../../engine/time';
import type { AppState, NapTimer } from '../../state/store';
import { cancelNotification, startNapTimer } from '../alarms';
import { planReminders } from '../features/reminders';
import {
  alarmRequestCode,
  getFullScreenAlarmStatus,
  hasFullScreenAlarm,
  NAP_ALARM_ID,
  planNativeWakeAlarm,
  resetWakeAlarmMemo,
  snoozeUntil,
  syncWakeAlarm,
  WAKE_ALARM_ID,
} from '../fullScreenAlarm';
import { NAP_NOTIFICATION_ID, stopNapTimer } from '../napTimer';
import { at, scenario, WORKDAY } from './helpers';

const schedule = Notifications.scheduleNotificationAsync as jest.Mock;
const permissions = Notifications.getPermissionsAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockModule.available = true;
  mockNative.scheduleAlarm.mockImplementation(() => Promise.resolve(true));
  resetWakeAlarmMemo();
});

describe('pure helpers', () => {
  it("mirrors Java's String.hashCode() for request codes", () => {
    expect(alarmRequestCode('')).toBe(0);
    expect(alarmRequestCode('hello')).toBe(99162322);
    expect(alarmRequestCode('Aa')).toBe(2112);
    expect(alarmRequestCode('BB')).toBe(2112);
    // Overflows to Integer.MIN_VALUE in Java.
    expect(alarmRequestCode('polygenelubricants')).toBe(-2147483648);
  });

  it('gives every alarm id (and its snooze) its own request code', () => {
    const codes = [NAP_ALARM_ID, WAKE_ALARM_ID, `${NAP_ALARM_ID}:snooze`, `${WAKE_ALARM_ID}:snooze`].map(alarmRequestCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(Number.isInteger(c) && c >= -(2 ** 31) && c < 2 ** 31).toBe(true);
  });

  it('snoozes for 9 minutes', () => {
    expect(snoozeUntil(1_000)).toBe(1_000 + 9 * MINUTE);
  });

  it('plans the native wake alarm: off cancels, past or imminent alarms are left alone', () => {
    const { analysis, now } = scenario(at(WORKDAY, 8.5), { prefs: { smartAlarm: true } });
    expect(planNativeWakeAlarm(analysis, false, now)).toEqual({ action: 'cancel' });
    expect(planNativeWakeAlarm(undefined, true, now)).toEqual({ action: 'keep' });
    expect(planNativeWakeAlarm(analysis, true, now)).toEqual({ action: 'set', alarm: expect.objectContaining({ at: analysis.alarm.alarm, title: 'Good morning ☀️' }) });
    // Ringing / snoozed right now: re-planning must not cancel or move it.
    expect(planNativeWakeAlarm(analysis, true, analysis.alarm.alarm - 10_000)).toEqual({ action: 'keep' });
    expect(planNativeWakeAlarm(analysis, true, analysis.alarm.alarm + 5 * MINUTE)).toEqual({ action: 'keep' });
  });
});

describe('availability', () => {
  it('reports the full-screen permission state', async () => {
    expect(hasFullScreenAlarm()).toBe(true);
    expect(await getFullScreenAlarmStatus()).toBe('allowed');
    mockNative.canUseFullScreenIntent.mockResolvedValueOnce(false);
    expect(await getFullScreenAlarmStatus()).toBe('blocked');
    mockModule.available = false;
    expect(hasFullScreenAlarm()).toBe(false);
    expect(await getFullScreenAlarmStatus()).toBe('unavailable');
  });
});

describe('cycle-timed wake alarm', () => {
  it('leaves the wake alarm to the native module when the build has it', () => {
    const ctx = scenario(at(WORKDAY, 8.5), { prefs: { smartAlarm: true } });
    expect(planReminders(ctx).find((p) => p.id === 'wake')).toBeUndefined();
    mockModule.available = false;
    expect(planReminders(ctx).find((p) => p.id === 'wake')).toMatchObject({ at: ctx.analysis.alarm.alarm, channel: 'wake', alarm: true });
  });

  it('schedules it natively once, and again only when it changes', async () => {
    const { analysis, state, now } = scenario(at(WORKDAY, 8.5), { prefs: { smartAlarm: true } });
    await syncWakeAlarm(analysis, state, now);
    await syncWakeAlarm(analysis, state, now + MINUTE);
    expect(mockNative.scheduleAlarm).toHaveBeenCalledTimes(1);
    expect(mockNative.scheduleAlarm).toHaveBeenCalledWith(WAKE_ALARM_ID, analysis.alarm.alarm, 'Good morning ☀️', expect.any(String), 'eepy://checkin');

    const moved = { ...analysis, alarm: { ...analysis.alarm, alarm: analysis.alarm.alarm + 15 * MINUTE } };
    await syncWakeAlarm(moved, state, now + 2 * MINUTE);
    expect(mockNative.scheduleAlarm).toHaveBeenCalledTimes(2);
    expect(mockNative.scheduleAlarm).toHaveBeenLastCalledWith(WAKE_ALARM_ID, moved.alarm.alarm, expect.any(String), expect.any(String), 'eepy://checkin');
    expect(mockNative.cancelAlarm).not.toHaveBeenCalled();
  });

  it('cancels it when the alarm is turned off or notifications are not allowed', async () => {
    const off = scenario(at(WORKDAY, 8.5), { prefs: { smartAlarm: false } });
    await syncWakeAlarm(off.analysis, off.state, off.now);
    await syncWakeAlarm(off.analysis, off.state, off.now + MINUTE);
    expect(mockNative.cancelAlarm).toHaveBeenCalledTimes(1);
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith(WAKE_ALARM_ID);
    expect(mockNative.scheduleAlarm).not.toHaveBeenCalled();

    resetWakeAlarmMemo();
    const on = scenario(at(WORKDAY, 8.5), { prefs: { smartAlarm: true } });
    permissions.mockResolvedValueOnce({ granted: false });
    await syncWakeAlarm(on.analysis, on.state, on.now);
    expect(mockNative.cancelAlarm).toHaveBeenCalledTimes(2);
    expect(mockNative.scheduleAlarm).not.toHaveBeenCalled();
  });

  it("doesn't touch an alarm that is ringing or snoozed", async () => {
    const { analysis, state } = scenario(at(WORKDAY, 8.5), { prefs: { smartAlarm: true } });
    await syncWakeAlarm(analysis, state, analysis.alarm.alarm + 2 * MINUTE);
    expect(mockNative.scheduleAlarm).not.toHaveBeenCalled();
    expect(mockNative.cancelAlarm).not.toHaveBeenCalled();
  });

  it('is a no-op without the native module', async () => {
    mockModule.available = false;
    const { analysis, state, now } = scenario(at(WORKDAY, 8.5), { prefs: { smartAlarm: true } });
    await syncWakeAlarm(analysis, state, now);
    expect(mockNative.scheduleAlarm).not.toHaveBeenCalled();
    expect(permissions).not.toHaveBeenCalled();
  });
});

describe('nap alarm', () => {
  function napState(timer?: NapTimer): AppState {
    const ctx = scenario(at(WORKDAY, 8.5));
    return { ...ctx.state, settings: { ...ctx.state.settings, napTimer: timer } };
  }

  it('rings natively instead of scheduling an expo-notifications alarm', async () => {
    const state = napState();
    const now = at(WORKDAY, 14);
    await startNapTimer(state, { alarmAfterMin: 25, label: 'Power nap' }, now);
    expect(mockNative.scheduleAlarm).toHaveBeenCalledWith(NAP_ALARM_ID, now + 25 * MINUTE, 'Nap over — time to get up', expect.stringContaining('Power nap'), 'eepy://nap');
    // Only the pinned "Napping" card goes through expo-notifications.
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0][0]).toMatchObject({ identifier: NAP_NOTIFICATION_ID, trigger: { channelId: 'live' } });
    expect(state.setSettings).toHaveBeenCalledWith({ napTimer: { start: now, alarmAt: now + 25 * MINUTE, label: 'Power nap', notificationId: NAP_NOTIFICATION_ID } });
  });

  it('falls back to the expo-notifications alarm when the native one is refused', async () => {
    mockNative.scheduleAlarm.mockImplementation(() => Promise.resolve(false));
    const now = at(WORKDAY, 14);
    await startNapTimer(napState(), { alarmAfterMin: 25, label: 'Power nap' }, now);
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(schedule.mock.calls[1][0]).toMatchObject({ identifier: NAP_NOTIFICATION_ID, trigger: { channelId: 'alarms', date: now + 25 * MINUTE, delivery: 'alarmClock' } });
  });

  it('stopping the nap cancels (and silences) the native alarm too', async () => {
    const start = at(WORKDAY, 14);
    const state = napState({ start, alarmAt: start + 25 * MINUTE, label: 'Power nap', notificationId: NAP_NOTIFICATION_ID });
    await stopNapTimer(state, false, start + 26 * MINUTE);
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith(NAP_ALARM_ID);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(NAP_NOTIFICATION_ID);
  });

  it('cancelNotification cancels both kinds', async () => {
    await cancelNotification(NAP_NOTIFICATION_ID);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(NAP_NOTIFICATION_ID);
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith(NAP_NOTIFICATION_ID);
  });
});
