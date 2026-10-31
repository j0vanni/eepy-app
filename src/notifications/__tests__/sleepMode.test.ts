jest.mock('expo-notifications', () => ({}));

// The native module: present (a mock) or absent (undefined, like iOS / web / Expo Go / older APKs).
const mockNative = {
  scheduleSleepMode: jest.fn((..._args: unknown[]) => Promise.resolve({})),
  cancelSleepMode: jest.fn(() => Promise.resolve()),
  getSleepModeStatus: jest.fn(() => Promise.resolve({ sdk: 35, supported: true, access: true, windows: [] })),
  startSleepModeNow: jest.fn((_night: string, _off: number) => Promise.resolve(true)),
  stopSleepModeNow: jest.fn((_night: string) => Promise.resolve(true)),
  dismissSleepModePrompt: jest.fn(() => Promise.resolve()),
  openSleepModeAccessSettings: jest.fn(() => Promise.resolve(true)),
  openSleepModeSettings: jest.fn(() => Promise.resolve(true)),
};
const mockModule: { available: boolean } = { available: true };
jest.mock('../../../modules/eepy-alarm', () => ({
  __esModule: true,
  get default() {
    return mockModule.available ? mockNative : undefined;
  },
}));

import { Platform } from 'react-native';

import type { Analysis } from '../../engine/analysis';
import { dateKey, MINUTE } from '../../engine/time';
import type { AppState, Settings, SleepModeSettings } from '../../state/store';
import { nextWakeAlarm, WAKE_AT_MARK, WAKE_SKIP_MARK } from '../fullScreenAlarm';
import {
  activeSleepWindow,
  getSleepModeStatus,
  hasSleepMode,
  planSleepMode,
  resetSleepModeMemo,
  sleepModeWindow,
  sleepSoundsLabel,
  stopSleepModeNow,
  syncSleepMode,
} from '../sleepMode';
import { at, scenario, WORKDAY } from './helpers';

const ON: SleepModeSettings = { enabled: true, startAt: 'lightsout', offerSounds: true };

function withSettings(state: AppState, patch: Partial<Settings>): AppState {
  return { ...state, settings: { ...state.settings, ...patch } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockModule.available = true;
  mockNative.scheduleSleepMode.mockImplementation(() => Promise.resolve({}));
  resetSleepModeMemo();
});

describe('tonight\'s sleep-mode window', () => {
  it('runs from lights-out to the planned wake-up when eepy\'s alarm is off', () => {
    const { analysis, state, now } = scenario(at(WORKDAY, 8.5), { settings: { sleepMode: ON } });
    expect(sleepModeWindow(analysis, state.settings, now)).toEqual({
      night: analysis.tonight.wakeDate,
      on: analysis.tonight.bedtime,
      off: analysis.tonight.wake,
      offAtAlarm: false,
    });
  });

  it('can start with wind-down instead', () => {
    const { analysis, state, now } = scenario(at(WORKDAY, 8.5), { settings: { sleepMode: { ...ON, startAt: 'winddown' } } });
    const w = sleepModeWindow(analysis, state.settings, now)!;
    expect(w.on).toBe(analysis.tonight.windDownStart);
    expect(w.on).toBeLessThan(analysis.tonight.bedtime);
  });

  it('ends when the morning alarm starts — the first watch buzz in watch-first mode', () => {
    const phone = scenario(at(WORKDAY, 8.5), { prefs: { smartAlarm: true }, settings: { sleepMode: ON } });
    expect(sleepModeWindow(phone.analysis, phone.state.settings, phone.now)).toMatchObject({ off: phone.analysis.alarm.alarm, offAtAlarm: true });

    const wrist = scenario(at(WORKDAY, 8.5), { prefs: { smartAlarm: true }, settings: { sleepMode: ON, watch: { napAlarm: 'phone', wakeAlarm: 'wrist', backupMin: 5 } } });
    const w = sleepModeWindow(wrist.analysis, wrist.state.settings, wrist.now)!;
    // The phone backup rings 5 min later; sleep mode is already off so the wrist buzzes get through.
    expect(nextWakeAlarm(wrist.analysis, wrist.state.settings, wrist.now).at).toBe(wrist.analysis.alarm.alarm + 5 * MINUTE);
    expect(w.off).toBe(wrist.analysis.alarm.alarm);
  });

  it('falls back to the planned wake-up when tomorrow\'s alarm is skipped', () => {
    const { analysis, state, now } = scenario(at(WORKDAY, 8.5), { prefs: { smartAlarm: true }, settings: { sleepMode: ON } });
    const skipped = withSettings(state, { marks: { [WAKE_SKIP_MARK]: dateKey(analysis.alarm.alarm) } });
    expect(sleepModeWindow(analysis, skipped.settings, now)).toMatchObject({ off: analysis.tonight.wake, offAtAlarm: false });
  });

  it("uses tonight's alarm, not this morning's held one", () => {
    // 05:00: the plan is already for tonight, while this morning's 06:45 alarm hasn't rung yet.
    const ctx = scenario(at(WORKDAY, 5), { prefs: { smartAlarm: true }, settings: { sleepMode: ON } });
    const held = at(WORKDAY, 6.75);
    const settings = { ...ctx.state.settings, marks: { [WAKE_AT_MARK]: held } };
    expect(nextWakeAlarm(ctx.analysis, settings, ctx.now)).toMatchObject({ held: true, base: held });
    const w = sleepModeWindow(ctx.analysis, settings, ctx.now)!;
    expect(w.off).toBe(ctx.analysis.alarm.alarm);
    expect(w.on).toBe(ctx.analysis.tonight.bedtime);
    expect(w.off).toBeGreaterThan(w.on);
  });

  it('follows "Adjust tonight" (analysis.tonight already carries it)', () => {
    const { analysis, state, now } = scenario(at(WORKDAY, 8.5), { settings: { sleepMode: ON } });
    const later = analysis.tonight.bedtime + 75 * MINUTE;
    const adjusted: Analysis = { ...analysis, tonight: { ...analysis.tonight, bedtime: later, wake: analysis.tonight.wake + 30 * MINUTE } };
    expect(sleepModeWindow(adjusted, state.settings, now)).toMatchObject({ on: later, off: analysis.tonight.wake + 30 * MINUTE });
  });

  it('covers the rest of a night already under way, and nothing once it is over', () => {
    // 01:00 is still "last night" for the engine: lights-out has passed, the wake-up hasn't.
    const night = scenario(at('2026-10-22', 1), { settings: { sleepMode: ON } });
    const w = sleepModeWindow(night.analysis, night.state.settings, night.now)!;
    expect(w.night).toBe('2026-10-22');
    expect(w.on).toBeLessThanOrEqual(night.now);
    expect(w.off).toBeGreaterThan(night.now);
    expect(sleepModeWindow(night.analysis, night.state.settings, w.off + MINUTE)).toBeUndefined();
  });
});

describe('planSleepMode', () => {
  it('cancels when autopilot is off and waits for an analysis', () => {
    const { analysis, state, now } = scenario(at(WORKDAY, 8.5));
    expect(planSleepMode(analysis, state.settings, now)).toEqual({ action: 'cancel' });
    const on = withSettings(state, { sleepMode: ON });
    expect(planSleepMode(undefined, on.settings, now)).toEqual({ action: 'keep' });
  });

  it('offers the default sleep sound with its timer, if wanted', () => {
    const { analysis, state, now } = scenario(at(WORKDAY, 8.5), { settings: { sleepMode: ON } });
    expect(planSleepMode(analysis, state.settings, now)).toMatchObject({ action: 'set', sounds: 'Brown noise · 45 min', window: { night: analysis.tonight.wakeDate } });
    const quiet = withSettings(state, { sleepMode: { ...ON, offerSounds: false } });
    expect(planSleepMode(analysis, quiet.settings, now)).toMatchObject({ action: 'set', sounds: null });
  });

  it('labels the sounds offer', () => {
    expect(sleepSoundsLabel({ sound: 'rain', volume: 0.5, timerMin: 0 })).toBe('Rain · until you stop it');
    expect(sleepSoundsLabel({ sound: 'pink', volume: 0.5, timerMin: 90 })).toBe('Pink noise · 1h 30m');
    expect(sleepSoundsLabel({ sound: 'white', volume: 0.5, timerMin: 30 })).toBe('White noise · 30 min');
  });
});

describe('syncSleepMode', () => {
  it('hands tonight to the native side once, and again only when it changes', async () => {
    const { analysis, state, now } = scenario(at(WORKDAY, 8.5), { settings: { sleepMode: ON } });
    await syncSleepMode(analysis, state, now);
    await syncSleepMode(analysis, state, now + MINUTE);
    expect(mockNative.scheduleSleepMode).toHaveBeenCalledTimes(1);
    expect(mockNative.scheduleSleepMode).toHaveBeenCalledWith(analysis.tonight.wakeDate, analysis.tonight.bedtime, analysis.tonight.wake, 'Brown noise · 45 min');

    const later: Analysis = { ...analysis, tonight: { ...analysis.tonight, bedtime: analysis.tonight.bedtime + 30 * MINUTE } };
    await syncSleepMode(later, state, now + 2 * MINUTE);
    expect(mockNative.scheduleSleepMode).toHaveBeenCalledTimes(2);
    expect(mockNative.scheduleSleepMode).toHaveBeenLastCalledWith(analysis.tonight.wakeDate, later.tonight.bedtime, analysis.tonight.wake, 'Brown noise · 45 min');

    await syncSleepMode(later, withSettings(state, { sleepMode: { ...ON, offerSounds: false } }), now + 3 * MINUTE);
    expect(mockNative.scheduleSleepMode).toHaveBeenCalledTimes(3);
    expect(mockNative.scheduleSleepMode).toHaveBeenLastCalledWith(expect.any(String), expect.any(Number), expect.any(Number), null);
    expect(mockNative.cancelSleepMode).not.toHaveBeenCalled();
  });

  it('cancels once when autopilot is turned off, and plans again when it is back on', async () => {
    const { analysis, state, now } = scenario(at(WORKDAY, 8.5));
    await syncSleepMode(analysis, state, now);
    await syncSleepMode(analysis, state, now + MINUTE);
    expect(mockNative.cancelSleepMode).toHaveBeenCalledTimes(1);
    expect(mockNative.scheduleSleepMode).not.toHaveBeenCalled();

    await syncSleepMode(analysis, withSettings(state, { sleepMode: ON }), now + 2 * MINUTE);
    expect(mockNative.scheduleSleepMode).toHaveBeenCalledTimes(1);
  });

  it('leaves the native plan alone without an analysis or once the night is over', async () => {
    const { analysis, state } = scenario(at(WORKDAY, 8.5), { settings: { sleepMode: ON } });
    await syncSleepMode(undefined, state);
    await syncSleepMode(analysis, state, analysis.tonight.wake + MINUTE);
    expect(mockNative.scheduleSleepMode).not.toHaveBeenCalled();
    expect(mockNative.cancelSleepMode).not.toHaveBeenCalled();
  });

  it('retries after a native failure and never throws', async () => {
    const { analysis, state, now } = scenario(at(WORKDAY, 8.5), { settings: { sleepMode: ON } });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockNative.scheduleSleepMode.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    await expect(syncSleepMode(analysis, state, now)).resolves.toBeUndefined();
    await syncSleepMode(analysis, state, now + MINUTE);
    expect(mockNative.scheduleSleepMode).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('is a no-op without the native module', async () => {
    mockModule.available = false;
    const { analysis, state, now } = scenario(at(WORKDAY, 8.5), { settings: { sleepMode: ON } });
    await syncSleepMode(analysis, state, now);
    await syncSleepMode(analysis, withSettings(state, { sleepMode: { ...ON, enabled: false } }), now);
    expect(mockNative.scheduleSleepMode).not.toHaveBeenCalled();
    expect(mockNative.cancelSleepMode).not.toHaveBeenCalled();
  });
});

describe('status and manual control', () => {
  const prevOS = Platform.OS;
  afterEach(() => {
    (Platform as { OS: string }).OS = prevOS;
  });

  it('only exists on Android builds with the module', async () => {
    (Platform as { OS: string }).OS = 'ios';
    expect(hasSleepMode()).toBe(false);
    expect(await getSleepModeStatus()).toBeUndefined();
    expect(await stopSleepModeNow('2026-10-22')).toBe(false);
    (Platform as { OS: string }).OS = 'android';
    expect(hasSleepMode()).toBe(true);
    expect(await getSleepModeStatus()).toMatchObject({ access: true });
    expect(await stopSleepModeNow('2026-10-22')).toBe(true);
    expect(mockNative.stopSleepModeNow).toHaveBeenCalledWith('2026-10-22');
    mockModule.available = false;
    expect(hasSleepMode()).toBe(false);
  });

  it('finds the night in progress', () => {
    const windows = [
      { night: '2026-10-21', onAt: 100, offAt: 200, sounds: null },
      { night: '2026-10-22', onAt: 300, offAt: 400, sounds: null },
    ];
    const status = { windows } as unknown as Parameters<typeof activeSleepWindow>[0];
    expect(activeSleepWindow(status, 150)?.night).toBe('2026-10-21');
    expect(activeSleepWindow(status, 250)).toBeUndefined();
    expect(activeSleepWindow(status, 300)?.night).toBe('2026-10-22');
    expect(activeSleepWindow(undefined, 150)).toBeUndefined();
  });
});
