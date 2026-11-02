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
import { router } from 'expo-router';

import { analyze } from '../../engine/analysis';
import { generateDemoData } from '../../engine/demo';
import { atMinutes, dateKey, MINUTE } from '../../engine/time';
import type { SleepDataset, TwoStepMorning } from '../../engine/types';
import type { AppState, SleepModeSettings, WatchSettings } from '../../state/store';
import { planReminders, reminders, ROUTINE_PLAN_ID, stopWristWake } from '../features/reminders';
import {
  nextWakeAlarm,
  planNativeRoutineAlarm,
  planNativeWakeAlarm,
  resetWakeAlarmMemo,
  routineNow,
  syncWakeAlarm,
  WAKE_ALARM_ID,
  WAKE_AT_MARK,
  WAKE_DONE_MARK,
  WAKE_ROUTINE_ALARM_ID,
  WAKE_ROUTINE_AT_MARK,
  WAKE_FINAL_SKIP_MARK,
  WAKE_ROUTINE_DONE_MARK,
  WAKE_SKIP_MARK,
} from '../fullScreenAlarm';
import { naturalWake } from '../features/naturalWake';
import { sleepModeWindow } from '../sleepMode';
import { makeState } from './helpers';

const PHONE: WatchSettings = { napAlarm: 'phone', wakeAlarm: 'phone', backupMin: 5 };
const WRIST: WatchSettings = { napAlarm: 'wrist', wakeAlarm: 'wrist', backupMin: 5 };
const TWO: TwoStepMorning = { enabled: true, firstWakeMin: 5 * 60, routineMin: 20 };

/** Thursday 2026-10-22; Friday is a workday with a 06:05 wake-up, routine alarm by 05:00. */
const THU = '2026-10-22';
const FRI = '2026-10-23';
const demo = generateDemoData(atMinutes(THU, 12 * 60));
const withTwoStep = (two?: TwoStepMorning, wakePlan?: SleepDataset['profile']['wakePlan']): SleepDataset => ({
  ...demo,
  profile: { ...demo.profile, workWakeMin: 6 * 60 + 5, ...(two ? { twoStepMorning: two } : {}), ...(wakePlan ? { wakePlan } : {}) },
});
const DATA = withTwoStep(TWO);

type Marks = Record<string, string | number | undefined>;
/** `day` at `hour` (fractions are minutes). */
function ctx(day: string, hour: number, opts: { watch?: WatchSettings; marks?: Marks; data?: SleepDataset; smartAlarm?: boolean; sleepMode?: SleepModeSettings } = {}) {
  const now = atMinutes(day, Math.round(hour * 60));
  const data = opts.data ?? DATA;
  const state = makeState(data, { settings: { watch: opts.watch ?? PHONE, marks: opts.marks ?? {}, ...(opts.sleepMode ? { sleepMode: opts.sleepMode } : {}) }, prefs: { smartAlarm: opts.smartAlarm ?? true } });
  return { analysis: analyze({ ...data, sessions: state.sessions }, now), state, now, background: true };
}
const eve = () => ctx(THU, 21);
const final = atMinutes(FRI, 6 * 60 + 5);

beforeEach(() => {
  jest.clearAllMocks();
  mockModule.available = true;
  resetWakeAlarmMemo();
});

describe('two alarms on a two-step morning', () => {
  it('a cycle-timed routine alarm before 05:00, then the final alarm at the 06:05 wake-up', () => {
    const c = eve();
    const w = nextWakeAlarm(c.analysis, c.state.settings, c.now);
    expect(w).toMatchObject({ base: final, at: final, title: 'Good morning ☀️', body: 'Time to get up.', held: false, done: false });
    expect(w.routine).toEqual({
      title: 'Routine time 🧴',
      body: 'Face routine time — keep the lights low, then back to bed until 06:05.',
      base: c.analysis.alarm.alarm,
      at: c.analysis.alarm.alarm,
      wrist: [],
      held: false,
      done: false,
    });
    expect(w.routine!.base).toBeLessThanOrEqual(atMinutes(FRI, 300));
    expect(w.routine!.base).toBeGreaterThanOrEqual(atMinutes(FRI, 270));
  });

  it('plans both phone alarms on builds without the native alarm', () => {
    mockModule.available = false;
    const c = eve();
    const planned = planReminders(c);
    expect(planned.find((p) => p.id === ROUTINE_PLAN_ID)).toMatchObject({ at: c.analysis.alarm.alarm, channel: 'wake', alarm: true, title: 'Routine time 🧴' });
    expect(planned.find((p) => p.id === 'wake')).toMatchObject({ at: final, channel: 'wake', alarm: true });
    mockModule.available = true;
    expect(planReminders(c).filter((p) => p.id === ROUTINE_PLAN_ID || p.id === 'wake')).toEqual([]);
  });

  it('schedules both native alarms under their own ids and records both', async () => {
    const c = eve();
    await syncWakeAlarm(c.analysis, c.state, c.now);
    expect(mockNative.scheduleAlarm).toHaveBeenCalledWith(WAKE_ALARM_ID, final, 'Good morning ☀️', 'Time to get up.', 'eepy://checkin?up=alarm');
    expect(mockNative.scheduleAlarm).toHaveBeenCalledWith(
      WAKE_ROUTINE_ALARM_ID,
      c.analysis.alarm.alarm,
      'Routine time 🧴',
      'Face routine time — keep the lights low, then back to bed until 06:05.',
      'eepy://',
    );
    expect(c.state.setMark).toHaveBeenCalledWith(WAKE_AT_MARK, final);
    expect(c.state.setMark).toHaveBeenCalledWith(WAKE_ROUTINE_AT_MARK, c.analysis.alarm.alarm);
    // Again with nothing changed: no native calls.
    await syncWakeAlarm(c.analysis, c.state, c.now + MINUTE);
    expect(mockNative.scheduleAlarm).toHaveBeenCalledTimes(2);
  });
});

describe('holding this morning until the final alarm has rung', () => {
  // Before 4am the analysis still plans this (Friday) morning; what syncWakeAlarm records then.
  const before = ctx(FRI, 3);
  const routineAt = before.analysis.alarm.alarm;
  const marks: Marks = { [WAKE_AT_MARK]: final, [WAKE_ROUTINE_AT_MARK]: routineAt };

  it('at 3am both alarms are this morning', () => {
    const w = nextWakeAlarm(before.analysis, before.state.settings, before.now);
    expect(w.base).toBe(final);
    expect(dateKey(routineAt)).toBe(FRI);
    expect(w.routine?.base).toBe(routineAt);
  });

  it('after the routine alarm, the 06:05 alarm is not replaced by tomorrow\'s', () => {
    const c = ctx(FRI, 5.5, { marks });
    // The analysis has moved on to Saturday…
    expect(c.analysis.tonight.wakeDate).toBe('2026-10-24');
    // …but this morning's final alarm (and the routine alarm before it) are held.
    const w = nextWakeAlarm(c.analysis, c.state.settings, c.now);
    expect(w).toMatchObject({ base: final, held: true, done: false });
    expect(w.routine).toMatchObject({ base: routineAt, held: true });
    expect(planNativeWakeAlarm(c.analysis, true, c.now, c.state.settings)).toEqual({ action: 'keep' });
    expect(planNativeRoutineAlarm(c.analysis, true, c.now, c.state.settings)).toEqual({ action: 'keep' });
  });

  it('touches neither native alarm nor the marks during the hold', async () => {
    for (const h of [4.25, 5.5, 6.1]) {
      const c = ctx(FRI, h, { marks });
      await syncWakeAlarm(c.analysis, c.state, c.now);
      expect(c.state.setMark).not.toHaveBeenCalled();
    }
    expect(mockNative.scheduleAlarm).not.toHaveBeenCalled();
    expect(mockNative.cancelAlarm).not.toHaveBeenCalled();
  });

  it('plans the held final alarm on builds without the native alarm', () => {
    mockModule.available = false;
    const planned = planReminders(ctx(FRI, 5.5, { marks }));
    expect(planned.find((p) => p.id === 'wake')?.at).toBe(final);
  });

  it('lasts through the snooze grace after 06:05, then tomorrow takes over', () => {
    const ringing = ctx(FRI, 6 + 30 / 60, { marks });
    expect(nextWakeAlarm(ringing.analysis, ringing.state.settings, ringing.now)).toMatchObject({ base: final, held: true });
    const after = ctx(FRI, 6 + 36 / 60, { marks });
    const w = nextWakeAlarm(after.analysis, after.state.settings, after.now);
    expect(w.held).toBe(false);
    expect(dateKey(w.base)).toBe('2026-10-24');
    // Saturday is a free day: no routine alarm.
    expect(w.routine).toBeUndefined();
  });

  it('in watch-first mode lasts until the final backup alarm has rung', () => {
    const c = ctx(FRI, 6 + 38 / 60, { marks, watch: WRIST });
    expect(nextWakeAlarm(c.analysis, c.state.settings, c.now)).toMatchObject({ base: final, at: final + 5 * MINUTE, held: true });
  });
});

describe('watch-first two-step morning', () => {
  it('buzzes the wrist for each alarm, with a phone backup after each', () => {
    mockModule.available = false;
    const c = ctx(THU, 21, { watch: WRIST });
    const r = c.analysis.alarm.alarm;
    const planned = planReminders(c);
    const wrist = planned.filter((p) => p.channel === 'wrist');
    expect(wrist.map((p) => p.id)).toEqual(['wrist-routine-0', 'wrist-routine-1', 'wrist-routine-2', 'wrist-wake-0', 'wrist-wake-1', 'wrist-wake-2']);
    expect(wrist.slice(0, 3).map((p) => p.at)).toEqual([r, r + MINUTE, r + 2 * MINUTE]);
    expect(wrist.slice(3).map((p) => p.at)).toEqual([final, final + MINUTE, final + 2 * MINUTE]);
    expect(wrist[0]).toMatchObject({ silent: true, alarm: true, categoryId: 'wrist-wake', data: { kind: 'wrist-wake', base: r, routine: true } });
    expect(wrist[3].data).toEqual({ kind: 'wrist-wake', base: final });
    expect(planned.find((p) => p.id === ROUTINE_PLAN_ID)?.at).toBe(r + 5 * MINUTE);
    expect(planned.find((p) => p.id === 'wake')?.at).toBe(final + 5 * MINUTE);
  });

  it('moves both native phone alarms to their backup times', () => {
    const c = ctx(THU, 21, { watch: WRIST });
    expect(planNativeRoutineAlarm(c.analysis, true, c.now, c.state.settings)).toMatchObject({ action: 'set', alarm: { at: c.analysis.alarm.alarm + 5 * MINUTE } });
    expect(planNativeWakeAlarm(c.analysis, true, c.now, c.state.settings)).toMatchObject({ action: 'set', alarm: { at: final + 5 * MINUTE } });
  });

  it('"I\'m up" on a routine buzz stops only the routine alarm', async () => {
    const c = ctx(THU, 21, { watch: WRIST });
    const r = c.analysis.alarm.alarm;
    await stopWristWake(c.state, r, { routine: true });
    expect(c.state.setMark).toHaveBeenCalledWith(WAKE_ROUTINE_DONE_MARK, r);
    expect(c.state.setMark).not.toHaveBeenCalledWith(WAKE_DONE_MARK, expect.anything());
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('eepy-plan-reminders-wrist-routine-0');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('eepy-plan-reminders-wake-routine');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('eepy-plan-reminders-wrist-wake-0');
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith(WAKE_ROUTINE_ALARM_ID);
    expect(mockNative.cancelAlarm).not.toHaveBeenCalledWith(WAKE_ALARM_ID);

    // The final alarm still rings.
    const after = ctx(THU, 21, { watch: WRIST, marks: { [WAKE_ROUTINE_DONE_MARK]: r } });
    expect(planReminders(after).filter((p) => p.channel === 'wrist').map((p) => p.id)).toEqual(['wrist-wake-0', 'wrist-wake-1', 'wrist-wake-2']);
    expect(planNativeRoutineAlarm(after.analysis, true, after.now, after.state.settings)).toEqual({ action: 'cancel' });
    expect(planNativeWakeAlarm(after.analysis, true, after.now, after.state.settings)).toMatchObject({ action: 'set' });
  });

  it('routes the routine buzz button to stopping it and opens Today', async () => {
    const c = ctx(THU, 21, { watch: WRIST });
    const base = Date.now() - MINUTE;
    await reminders.onResponse!({ actionId: 'wrist-up', data: { kind: 'wrist-wake', base, routine: true } }, c.state as AppState);
    expect(c.state.setMark).toHaveBeenCalledWith(WAKE_ROUTINE_DONE_MARK, base);
    expect(router.push).toHaveBeenCalledWith('/');
  });
});

describe('skips and free days', () => {
  it('"Skip" for that morning silences both alarms', () => {
    mockModule.available = false;
    const c = ctx(THU, 21, { watch: WRIST, marks: { [WAKE_SKIP_MARK]: FRI } });
    const w = nextWakeAlarm(c.analysis, c.state.settings, c.now);
    expect(w).toMatchObject({ skipped: true, done: true });
    expect(w.routine?.done).toBe(true);
    expect(planReminders(c).filter((p) => p.alarm)).toEqual([]);
    mockModule.available = true;
    expect(planNativeWakeAlarm(c.analysis, true, c.now, c.state.settings)).toEqual({ action: 'cancel' });
    expect(planNativeRoutineAlarm(c.analysis, true, c.now, c.state.settings)).toEqual({ action: 'cancel' });
  });

  it('skipping during the routine ("staying up") cancels the held final alarm', async () => {
    const before = ctx(FRI, 3);
    const marks: Marks = { [WAKE_AT_MARK]: final, [WAKE_ROUTINE_AT_MARK]: before.analysis.alarm.alarm, [WAKE_SKIP_MARK]: FRI };
    const c = ctx(FRI, 5.25, { marks });
    expect(planNativeWakeAlarm(c.analysis, true, c.now, c.state.settings)).toEqual({ action: 'cancel' });
    await syncWakeAlarm(c.analysis, c.state, c.now);
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith(WAKE_ALARM_ID);
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith(WAKE_ROUTINE_ALARM_ID);
    expect(mockNative.scheduleAlarm).not.toHaveBeenCalled();
  });

  it('a calendar free day has neither alarm', () => {
    const c = ctx(THU, 21, { data: withTwoStep(TWO, { [FRI]: { free: true } }) });
    expect(c.analysis.tonight.twoStep).toBeUndefined();
    const w = nextWakeAlarm(c.analysis, c.state.settings, c.now);
    expect(w).toMatchObject({ calendarFree: true, done: true });
    expect(w.routine).toBeUndefined();
  });
});

describe('the routine card window', () => {
  const before = ctx(FRI, 3);
  const routineAt = before.analysis.alarm.alarm;
  const marks: Marks = { [WAKE_AT_MARK]: final, [WAKE_ROUTINE_AT_MARK]: routineAt };

  it('is open from the routine alarm until the final alarm rings', () => {
    const c = ctx(FRI, 5, { marks });
    expect(routineNow(c.analysis, c.state.settings, c.state.profile, c.now)).toEqual({
      routineAt,
      backToBedBy: routineAt + 20 * MINUTE,
      finalAt: final,
      finalPhoneAt: final,
      date: FRI,
      skipped: false,
      eepyAlarm: true,
    });
    expect(routineNow(c.analysis, c.state.settings, c.state.profile, routineAt - 10 * MINUTE)).toBeUndefined();
    const later = ctx(FRI, 6 + 6 / 60, { marks });
    expect(routineNow(later.analysis, later.state.settings, later.state.profile, later.now)).toBeUndefined();
  });

  it('"I\'m staying up" skips only the final alarm, without making it a free morning', async () => {
    const c = ctx(FRI, 5.25, { marks: { ...marks, [WAKE_FINAL_SKIP_MARK]: FRI } });
    expect(routineNow(c.analysis, c.state.settings, c.state.profile, c.now)?.skipped).toBe(true);
    expect(nextWakeAlarm(c.analysis, c.state.settings, c.now)).toMatchObject({ base: final, held: true, done: true });
    expect(planNativeWakeAlarm(c.analysis, true, c.now, c.state.settings)).toEqual({ action: 'cancel' });
    await syncWakeAlarm(c.analysis, c.state, c.now);
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith(WAKE_ALARM_ID);
    // Not a free morning: no "did you wake up on your own?".
    expect(naturalWake.plan(c).map((p) => p.id)).not.toContain(FRI);
  });

  it("works from the plan when eepy's alarm is off (nothing to skip)", () => {
    const c = ctx(FRI, 5, { smartAlarm: false });
    expect(routineNow(c.analysis, c.state.settings, c.state.profile, c.now)).toEqual({
      routineAt: atMinutes(FRI, 300),
      backToBedBy: atMinutes(FRI, 320),
      finalAt: final,
      finalPhoneAt: final,
      date: FRI,
      skipped: false,
      eepyAlarm: false,
    });
    expect(routineNow(c.analysis, c.state.settings, c.state.profile, atMinutes(FRI, 6 * 60 + 5))).toBeUndefined();
    // Saturday: no two-step morning.
    const sat = ctx('2026-10-24', 5, { smartAlarm: false });
    expect(routineNow(sat.analysis, sat.state.settings, sat.state.profile, sat.now)).toBeUndefined();
  });
});

describe('bedtime autopilot on a two-step morning', () => {
  const ON: SleepModeSettings = { enabled: true, startAt: 'lightsout', offerSounds: true };

  it('stays on through the routine and switches off at the final alarm', () => {
    const c = ctx(THU, 21, { sleepMode: ON });
    const w = sleepModeWindow(c.analysis, c.state.settings, c.now)!;
    expect(w).toEqual({ night: FRI, on: c.analysis.tonight.bedtime, off: final, offAtAlarm: true });
    expect(w.off).toBeGreaterThan(c.analysis.alarm.alarm);
  });

  it('watch-first: off at the final alarm\'s first buzz, not the routine\'s', () => {
    const c = ctx(THU, 21, { sleepMode: ON, watch: WRIST });
    expect(sleepModeWindow(c.analysis, c.state.settings, c.now)?.off).toBe(final);
  });

  it('with eepy\'s alarm off: off at the final wake-up', () => {
    const c = ctx(THU, 21, { sleepMode: ON, smartAlarm: false });
    expect(sleepModeWindow(c.analysis, c.state.settings, c.now)).toMatchObject({ off: final, offAtAlarm: false });
  });
});

describe('with the setting off', () => {
  const OFF = withTwoStep({ ...TWO, enabled: false });

  it('one alarm, exactly as before', async () => {
    const c = ctx(THU, 21, { data: OFF, watch: WRIST });
    const plain = ctx(THU, 21, { data: withTwoStep(), watch: WRIST });
    const w = nextWakeAlarm(c.analysis, c.state.settings, c.now);
    expect(w.routine).toBeUndefined();
    expect(w).toEqual(nextWakeAlarm(plain.analysis, plain.state.settings, plain.now));
    expect(w.base).toBe(c.analysis.alarm.alarm);
    mockModule.available = false;
    expect(planReminders(c).map((p) => p.id)).toEqual(planReminders(plain).map((p) => p.id));
    expect(planReminders(c).some((p) => p.id.includes('routine'))).toBe(false);
    mockModule.available = true;
    await syncWakeAlarm(c.analysis, c.state, c.now);
    expect(mockNative.scheduleAlarm).toHaveBeenCalledTimes(1);
    expect(mockNative.scheduleAlarm.mock.calls[0][0]).toBe(WAKE_ALARM_ID);
    expect(mockNative.cancelAlarm).not.toHaveBeenCalled();
    expect(c.state.setMark).not.toHaveBeenCalledWith(WAKE_ROUTINE_AT_MARK, expect.anything());
  });

  it('a routine alarm left from when it was on is cancelled', async () => {
    const c = ctx(THU, 21, { data: OFF, marks: { [WAKE_ROUTINE_AT_MARK]: atMinutes(FRI, 290) } });
    await syncWakeAlarm(c.analysis, c.state, c.now);
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith(WAKE_ROUTINE_ALARM_ID);
    expect(c.state.setMark).toHaveBeenCalledWith(WAKE_ROUTINE_AT_MARK, undefined);
  });
});
