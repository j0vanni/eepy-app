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

import { analyze } from '../../engine/analysis';
import { generateDemoData } from '../../engine/demo';
import { atMinutes, dateKey, MINUTE } from '../../engine/time';
import type { AppState, WatchSettings } from '../../state/store';
import { startNapTimer } from '../alarms';
import { planReminders, reminders, stopWristWake } from '../features/reminders';
import { nextWakeAlarm, planNativeWakeAlarm, resetWakeAlarmMemo, syncWakeAlarm, WAKE_ALARM_ID, WAKE_AT_MARK, WAKE_DONE_MARK, WAKE_SKIP_MARK } from '../fullScreenAlarm';
import { naturalWake } from '../features/naturalWake';
import { NAP_NOTIFICATION_ID, NAP_WRIST_IDS, stopNapTimer } from '../napTimer';
import { makeState } from './helpers';

const schedule = Notifications.scheduleNotificationAsync as jest.Mock;
const PHONE: WatchSettings = { napAlarm: 'phone', wakeAlarm: 'phone', backupMin: 5 };
const WRIST: WatchSettings = { napAlarm: 'wrist', wakeAlarm: 'wrist', backupMin: 5 };

/** Thursday 2026-10-22: demo data says the alarm is 07:00 on workdays. */
const THU = '2026-10-22';
const data = generateDemoData(atMinutes(THU, 12 * 60));

function ctxAt(hour: number, watch: WatchSettings = PHONE, marks: Record<string, string | number | undefined> = {}) {
  const now = atMinutes(THU, hour * 60);
  const state = makeState(data, { settings: { watch, marks }, prefs: { smartAlarm: true } });
  return { analysis: analyze({ ...data, sessions: state.sessions }, now), state, now, background: true };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockModule.available = true;
  resetWakeAlarmMemo();
});

describe('holding the morning alarm across the 4am switch', () => {
  it('at 3am plans this morning; at 5am the analysis already plans tomorrow', () => {
    expect(dateKey(ctxAt(3).analysis.alarm.alarm)).toBe(THU);
    expect(dateKey(ctxAt(5).analysis.alarm.alarm)).toBe('2026-10-23');
  });

  it('keeps the alarm scheduled before 4am until it has rung', () => {
    const morning = ctxAt(3).analysis.alarm.alarm;
    const c = ctxAt(5, PHONE, { [WAKE_AT_MARK]: morning });
    const next = nextWakeAlarm(c.analysis, c.state.settings, c.now);
    expect(next).toMatchObject({ at: morning, base: morning, held: true, done: false, wrist: [] });
    // Still current while it may be ringing or snoozed…
    expect(nextWakeAlarm(c.analysis, c.state.settings, morning + 20 * MINUTE).held).toBe(true);
    // …then tomorrow's takes over.
    expect(nextWakeAlarm(c.analysis, c.state.settings, morning + 31 * MINUTE)).toMatchObject({ at: c.analysis.alarm.alarm, held: false });
  });

  it('plans the held alarm instead of moving it to tomorrow (expo-notifications builds)', () => {
    mockModule.available = false;
    const morning = ctxAt(3).analysis.alarm.alarm;
    const wake = planReminders(ctxAt(5, PHONE, { [WAKE_AT_MARK]: morning })).find((p) => p.id === 'wake');
    expect(wake?.at).toBe(morning);
  });

  it('leaves the held alarm alone natively, and records what is scheduled', async () => {
    const morning = ctxAt(3).analysis.alarm.alarm;
    const c = ctxAt(5, PHONE, { [WAKE_AT_MARK]: morning });
    expect(planNativeWakeAlarm(c.analysis, true, c.now, c.state.settings)).toEqual({ action: 'keep' });
    await syncWakeAlarm(c.analysis, c.state, c.now);
    expect(mockNative.scheduleAlarm).not.toHaveBeenCalled();
    expect(mockNative.cancelAlarm).not.toHaveBeenCalled();
    expect(c.state.setMark).not.toHaveBeenCalled();

    // Evening: the mark moves to tomorrow's alarm.
    const eve = ctxAt(21, PHONE, { [WAKE_AT_MARK]: morning });
    await syncWakeAlarm(eve.analysis, eve.state, eve.now);
    expect(eve.state.setMark).toHaveBeenCalledWith(WAKE_AT_MARK, eve.analysis.alarm.alarm);
    expect(mockNative.scheduleAlarm).toHaveBeenCalledWith(WAKE_ALARM_ID, eve.analysis.alarm.alarm, expect.any(String), expect.any(String), 'eepy://checkin');
  });

  it('forgets the mark when the alarm is off', async () => {
    const c = ctxAt(21, PHONE, { [WAKE_AT_MARK]: 123 });
    c.state.settings.notifications.smartAlarm = false;
    await syncWakeAlarm(c.analysis, c.state, c.now);
    expect(c.state.setMark).toHaveBeenCalledWith(WAKE_AT_MARK, undefined);
  });
});

describe('watch-first wake alarm', () => {
  it('buzzes the wrist three times, then rings the phone as a backup', () => {
    mockModule.available = false;
    const c = ctxAt(21, WRIST);
    const alarm = c.analysis.alarm.alarm;
    const planned = planReminders(c);
    const wrist = planned.filter((p) => p.channel === 'wrist');
    expect(wrist.map((p) => p.at)).toEqual([alarm, alarm + MINUTE, alarm + 2 * MINUTE]);
    for (const p of wrist) expect(p).toMatchObject({ alarm: true, silent: true, categoryId: 'wrist-wake', data: { kind: 'wrist-wake', base: alarm } });
    expect(planned.find((p) => p.id === 'wake')).toMatchObject({ at: alarm + 5 * MINUTE, channel: 'wake' });
  });

  it('moves the native phone alarm to the backup time', () => {
    const c = ctxAt(21, WRIST);
    expect(planNativeWakeAlarm(c.analysis, true, c.now, c.state.settings)).toMatchObject({ action: 'set', alarm: { at: c.analysis.alarm.alarm + 5 * MINUTE } });
  });

  it('"I\'m up" on a buzz cancels the rest and the backup, and nothing is re-planned for that morning', async () => {
    const c = ctxAt(21, WRIST);
    const base = c.analysis.alarm.alarm;
    await stopWristWake(c.state, base);
    expect(c.state.setMark).toHaveBeenCalledWith(WAKE_DONE_MARK, base);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('eepy-plan-reminders-wake');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('eepy-plan-reminders-wrist-wake-2');
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith(WAKE_ALARM_ID);

    const after = ctxAt(21, WRIST, { [WAKE_DONE_MARK]: base });
    expect(planReminders(after).filter((p) => p.channel === 'wrist' || p.id === 'wake')).toEqual([]);
    expect(planNativeWakeAlarm(after.analysis, true, after.now, after.state.settings)).toEqual({ action: 'cancel' });
  });

  it('routes the buzz button (and a tap on the buzz) to stopping the alarm', async () => {
    const c = ctxAt(21, WRIST);
    const base = Date.now() - MINUTE;
    await reminders.onResponse!({ actionId: 'wrist-up', data: { kind: 'wrist-wake', base } }, c.state as AppState);
    expect(c.state.setMark).toHaveBeenCalledWith(WAKE_DONE_MARK, base);
    // An old, replayed response does nothing.
    (c.state.setMark as jest.Mock).mockClear();
    await reminders.onResponse!({ actionId: 'default', data: { kind: 'wrist-wake', base: base - 24 * 60 * MINUTE } }, c.state as AppState);
    expect(c.state.setMark).not.toHaveBeenCalled();
  });
});

describe('watch-first nap alarm', () => {
  it('buzzes the wrist, then the phone alarm rings after the backup delay', async () => {
    const c = ctxAt(14, WRIST);
    await startNapTimer(c.state, { alarmAfterMin: 25, label: 'Power nap' }, c.now);
    const end = c.now + 25 * MINUTE;
    const buzzes = schedule.mock.calls.map((x) => x[0]).filter((r) => r.trigger.channelId === 'wrist');
    expect(buzzes.map((r) => r.identifier)).toEqual(NAP_WRIST_IDS);
    expect(buzzes.map((r) => r.trigger.date)).toEqual([end, end + MINUTE, end + 2 * MINUTE]);
    expect(buzzes[0].content).toMatchObject({ sound: false, data: { wrist: true } });
    expect(mockNative.scheduleAlarm).toHaveBeenCalledWith('eepy-nap', end + 5 * MINUTE, expect.any(String), expect.any(String), 'eepy://nap');
    // The timer still ends when the nap does (the backup is only a safety net).
    expect(c.state.setSettings).toHaveBeenCalledWith({ napTimer: expect.objectContaining({ alarmAt: end }) });
  });

  it('phone mode schedules no buzzes', async () => {
    const c = ctxAt(14, PHONE);
    await startNapTimer(c.state, { alarmAfterMin: 25, label: 'Power nap' }, c.now);
    expect(schedule.mock.calls.filter((x) => x[0].trigger.channelId === 'wrist')).toHaveLength(0);
  });

  it('stopping the nap clears the buzzes too', async () => {
    const c = ctxAt(14, WRIST);
    const state = { ...c.state, settings: { ...c.state.settings, napTimer: { start: c.now, alarmAt: c.now + 25 * MINUTE, label: 'Power nap', notificationId: NAP_NOTIFICATION_ID } } };
    await stopNapTimer(state, true, c.now + 26 * MINUTE);
    for (const id of NAP_WRIST_IDS) {
      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(id);
      expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(id);
    }
  });
});

describe('skipping an alarm', () => {
  it("silences only that morning's alarm, watch buzzes included", async () => {
    mockModule.available = false;
    const eve = ctxAt(21, WRIST);
    const tomorrow = dateKey(eve.analysis.alarm.alarm);
    const skipped = ctxAt(21, WRIST, { [WAKE_SKIP_MARK]: tomorrow });
    expect(nextWakeAlarm(skipped.analysis, skipped.state.settings, skipped.now)).toMatchObject({ skipped: true, done: true });
    expect(planReminders(skipped).filter((p) => p.channel === 'wrist' || p.id === 'wake')).toEqual([]);
    // A skip for another day changes nothing.
    const other = ctxAt(21, WRIST, { [WAKE_SKIP_MARK]: THU });
    expect(planReminders(other).filter((p) => p.channel === 'wrist' || p.id === 'wake')).toHaveLength(4);

    mockModule.available = true;
    expect(planNativeWakeAlarm(skipped.analysis, true, skipped.now, skipped.state.settings)).toEqual({ action: 'cancel' });
  });

  it('asks "did you wake up on your own?" on a skipped workday', () => {
    const eve = ctxAt(21, PHONE);
    const tomorrow = eve.analysis.tonight.wakeDate; // Friday, a workday
    expect(naturalWake.plan(eve).map((p) => p.id)).not.toContain(tomorrow);
    const skipped = ctxAt(21, PHONE, { [WAKE_SKIP_MARK]: tomorrow });
    expect(naturalWake.plan(skipped).map((p) => p.id)).toContain(tomorrow);
  });
});
