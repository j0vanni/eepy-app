/**
 * The sleep session against the real store: "I'm in bed" (tonight re-timed, sounds, sleep mode,
 * evening reminders quiet), Undo, "I'm up" (alarm off when it's about to ring, Undo), auto-close and
 * "Save last night from your taps".
 */
jest.mock('expo-notifications', () => ({
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
  clearLastNotificationResponse: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const mockStatus: { current: Record<string, unknown> } = { current: {} };
const mockNative = {
  getSleepModeStatus: jest.fn(() => Promise.resolve(mockStatus.current)),
  scheduleSleepMode: jest.fn(() => Promise.resolve(mockStatus.current)),
  cancelSleepMode: jest.fn(() => Promise.resolve()),
  startSleepModeNow: jest.fn((_night: string, _off: number) => Promise.resolve(true)),
  stopSleepModeNow: jest.fn((_night: string) => Promise.resolve(true)),
  undoSleepModeStart: jest.fn((_night: string) => Promise.resolve(true)),
  dismissSleepModePrompt: jest.fn(() => Promise.resolve()),
};
jest.mock('../../../modules/eepy-alarm', () => ({
  __esModule: true,
  get default() {
    return mockNative;
  },
}));

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { soundPlayer } from '../../audio/player';
import { analyze, Analysis } from '../../engine/analysis';
import { TAPS_ORIGIN } from '../../engine/sessions';
import { atMinutes, dateKey, MINUTE } from '../../engine/time';
import { nextWakeAlarm, WAKE_AT_MARK, WAKE_DONE_MARK, WAKE_SKIP_MARK } from '../../notifications/fullScreenAlarm';
import { eveningNotificationIds } from '../../notifications/ids';
import { planLiveWindDown, shouldDismissLiveWindDown } from '../../notifications/features/liveWindDown';
import { planReminders } from '../../notifications/features/reminders';
import { screensOff } from '../../notifications/features/screensOff';
import { analyzeOptionsFor } from '../analysisOptions';
import { cancelInBedSession, closeStaleInBed, endInBedSession, saveTapsNight, sessionAlarm, startInBedSession, undoEndInBedSession } from '../inBed';
import { selectDataset, useStore } from '../store';

// Monday evening, wind-down under way: the demo plan's lights-out is ~23:08, wake-up Tuesday 07:00.
const DAY = '2026-11-02';
const NOW = atMinutes(DAY, 22 * 60 + 45);
const prevOS = Platform.OS;

const analysisAt = (now: number): Analysis => {
  const s = useStore.getState();
  return analyze(selectDataset(s), now, analyzeOptionsFor(s, { now }));
};
const ctx = (now: number) => ({ analysis: analysisAt(now), state: useStore.getState(), now, background: false });
const session = () => useStore.getState().settings.session;
const minute = (t: number) => Math.floor(t / MINUTE) * MINUTE;

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  jest.clearAllMocks();
  (Platform as { OS: string }).OS = 'android';
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  soundPlayer.stopNow();
  const st = useStore.getState();
  st.loadDemo(NOW);
  st.setProfile({ onboarded: true });
  st.setSettings({ session: undefined, tonight: undefined, inBedSounds: undefined, marks: {}, clock: '24h' });
  st.setNotificationPrefs({ smartAlarm: true, liveWindDown: true, windDown: true, bedtime: true, screensOff: true });
  st.setSleepModeSettings({ enabled: true, startAt: 'lightsout' });
  mockStatus.current = { access: true, active: false, windows: [] };
});
afterEach(() => {
  // The player's foreground tick would keep Jest alive.
  soundPlayer.stopNow();
  (Platform as { OS: string }).OS = prevOS;
  jest.restoreAllMocks();
});

describe("I'm in bed", () => {
  it('makes the tap tonight\'s lights-out, starts sounds and sleep mode until the alarm, and quiets tonight', async () => {
    const before = analysisAt(NOW);
    expect(before.tonight.bedtime - NOW).toBeGreaterThan(10 * MINUTE);
    const s = await startInBedSession(before, NOW);
    expect(s).toMatchObject({ inBedAt: NOW, wakeDate: before.tonight.wakeDate, retimed: true, soundsStarted: true, sounds: 'Brown noise · 45 min', sleepModeStarted: true, sleepModeOn: true });
    expect(useStore.getState().settings.tonight).toEqual({ wakeDate: before.tonight.wakeDate, bedtime: NOW });
    expect(useStore.getState().wakeLog.inBed).toContain(NOW);
    expect(soundPlayer.getState().status).toBe('playing');

    // The analysis now plans from the tap: the alarm is re-timed, never past the wake-up.
    const a = analysisAt(NOW);
    expect(a.tonight.bedtime).toBe(NOW);
    expect(a.tonight.wake).toBe(before.tonight.wake);
    expect(a.alarm.alarm).toBeLessThanOrEqual(a.tonight.wake);
    // Sleep mode switched on now, off at that alarm.
    const alarm = nextWakeAlarm(a, useStore.getState().settings, NOW);
    expect(mockNative.startSleepModeNow).toHaveBeenCalledWith(a.tonight.wakeDate, alarm.base);
    expect(sessionAlarm(a, useStore.getState().settings, s, NOW)).toMatchObject({ state: 'set', at: alarm.base });

    // Tonight's evening notifications: cleared now and not planned again.
    for (const id of eveningNotificationIds(s.wakeDate)) expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(id);
    const planned = planReminders(ctx(NOW)).map((p) => p.id);
    expect(planned).not.toContain('winddown');
    expect(planned).not.toContain('bedtime');
    expect(planned).toContain('checkin');
    expect(planLiveWindDown(ctx(NOW))).toEqual([]);
    expect(shouldDismissLiveWindDown(a, useStore.getState(), NOW)).toBe(true);
    expect(screensOff.plan(ctx(NOW))).toEqual([]);
  });

  it('Undo puts the plan back and stops what it started', async () => {
    const before = analysisAt(NOW);
    await startInBedSession(before, NOW);
    const stop = jest.spyOn(soundPlayer, 'stop');
    await cancelInBedSession();
    expect(session()).toBeUndefined();
    expect(useStore.getState().settings.tonight).toBeUndefined();
    expect(useStore.getState().wakeLog.inBed).not.toContain(NOW);
    expect(stop).toHaveBeenCalled();
    expect(mockNative.undoSleepModeStart).toHaveBeenCalledWith(before.tonight.wakeDate);
    expect(mockNative.stopSleepModeNow).not.toHaveBeenCalled();
    const a = analysisAt(NOW);
    expect(a.tonight.bedtime).toBe(before.tonight.bedtime);
    expect(a.alarm).toEqual(before.alarm);
    // The reminders are back.
    expect(planReminders(ctx(NOW)).map((p) => p.id)).toContain('checkin');
    expect(planLiveWindDown(ctx(NOW)).length).toBe(1);
  });

  it('keeps an "Adjust tonight" you made, and restores it on Undo', async () => {
    const plain = analysisAt(NOW);
    const own = { wakeDate: plain.tonight.wakeDate, bedtime: plain.tonight.bedtime + 60 * MINUTE, wake: plain.tonight.wake + 30 * MINUTE };
    useStore.getState().setSettings({ tonight: own });
    await startInBedSession(analysisAt(NOW), NOW);
    expect(useStore.getState().settings.tonight).toEqual({ wakeDate: own.wakeDate, bedtime: NOW, wake: own.wake });
    await cancelInBedSession();
    expect(useStore.getState().settings.tonight).toEqual(own);
  });

  it('near lights-out keeps the plan (and the alarm), still quieting the reminders', async () => {
    const a = analysisAt(NOW);
    const tap = Math.floor((a.tonight.bedtime - 4 * MINUTE) / MINUTE) * MINUTE;
    const s = await startInBedSession(a, tap);
    expect(s.retimed).toBe(false);
    expect(useStore.getState().settings.tonight).toBeUndefined();
    expect(analysisAt(tap).alarm).toEqual(a.alarm);
    const planned = planReminders(ctx(tap)).map((p) => p.id);
    expect(planned).not.toContain('bedtime');
    expect(planLiveWindDown(ctx(tap))).toEqual([]);
  });

  it('leaves alone what was already on: a playing sound, sleep mode switched on by the autopilot', async () => {
    void soundPlayer.play(useStore.getState().settings.audio);
    mockStatus.current = { access: true, active: true, windows: [] };
    const s = await startInBedSession(analysisAt(NOW), NOW);
    expect(s).toMatchObject({ sleepModeOn: true });
    expect(s.soundsStarted).toBeUndefined();
    expect(s.sleepModeStarted).toBeUndefined();
    expect(mockNative.startSleepModeNow).not.toHaveBeenCalled();
    const stop = jest.spyOn(soundPlayer, 'stop');
    await cancelInBedSession();
    expect(stop).not.toHaveBeenCalled();
    expect(mockNative.undoSleepModeStart).not.toHaveBeenCalled();
  });

  it('starts no sound with "Start sleep sounds" off, and no sleep mode without the autopilot', async () => {
    useStore.getState().setSettings({ inBedSounds: false });
    useStore.getState().setSleepModeSettings({ enabled: false });
    const s = await startInBedSession(analysisAt(NOW), NOW);
    expect(s.soundsStarted).toBeUndefined();
    expect(soundPlayer.getState().status).toBe('idle');
    expect(mockNative.getSleepModeStatus).not.toHaveBeenCalled();
  });

  it('after 4am before the wake-up is this morning\'s session: nothing re-timed', async () => {
    const early = atMinutes('2026-11-03', 4 * 60 + 30);
    jest.spyOn(Date, 'now').mockReturnValue(early);
    // Last night hasn't synced: the demo data stops at the evening before.
    const a = analysisAt(early);
    expect(a.day).toBe('2026-11-03');
    const s = await startInBedSession(a, early);
    expect(s).toMatchObject({ wakeDate: '2026-11-03', retimed: false });
    expect(useStore.getState().settings.tonight).toBeUndefined();
  });
});

describe("I'm up", () => {
  /** Tonight's session, then the morning. */
  async function night() {
    await startInBedSession(analysisAt(NOW), NOW);
    const a = analysisAt(NOW);
    const alarm = nextWakeAlarm(a, useStore.getState().settings, NOW).base;
    // What syncWakeAlarm records on every re-plan, so the morning's alarm is held past 4am.
    useStore.getState().setMark(WAKE_AT_MARK, alarm);
    return { a, alarm };
  }

  it('ends the session: sleep mode and sounds off, the alarm still to ring left alone — Undo puts it back', async () => {
    const { alarm } = await night();
    const morning = minute(alarm - 30 * MINUTE);
    jest.spyOn(Date, 'now').mockReturnValue(morning);
    mockStatus.current = { access: true, active: true, windows: [] };
    const a = analysisAt(morning);
    expect(await endInBedSession('today', a, morning)).toBe(true);
    const s = session()!;
    expect(s).toMatchObject({ closed: 'up', upAt: morning, sleepModeStopped: alarm });
    expect(useStore.getState().wakeLog.outOfBed).toContain(morning);
    expect(mockNative.stopSleepModeNow).toHaveBeenCalledWith(s.wakeDate);
    expect(soundPlayer.getState().status).not.toBe('playing');
    // A stray "I'm up" never silences an alarm: it still rings.
    expect(useStore.getState().settings.marks[WAKE_DONE_MARK]).toBeUndefined();
    expect(nextWakeAlarm(analysisAt(morning), useStore.getState().settings, morning)).toMatchObject({ base: alarm, done: false });

    await undoEndInBedSession();
    expect(session()).toMatchObject({ inBedAt: NOW });
    expect(session()!.closed).toBeUndefined();
    expect(useStore.getState().wakeLog.outOfBed).not.toContain(morning);
    expect(mockNative.startSleepModeNow).toHaveBeenLastCalledWith(s.wakeDate, alarm);
  });

  it("from the alarm: logged like the alarm's I'm up — but not minutes after going to bed", async () => {
    const { alarm } = await night();
    expect(await endInBedSession('alarm', undefined, NOW + 5 * MINUTE)).toBe(false);
    expect(session()!.closed).toBeUndefined();
    const up = minute(alarm + MINUTE);
    expect(await endInBedSession('alarm', undefined, up)).toBe(true);
    expect(session()).toMatchObject({ closed: 'up', upAt: up });
    expect(useStore.getState().wakeLog.ups).toContain(up);
    // Nothing left to end.
    expect(await endInBedSession('watch', undefined, alarm + 2 * MINUTE)).toBe(false);
  });

  it('closes by itself once stale, without an up time', async () => {
    await night();
    const wake = session()!.wakeAt;
    expect(closeStaleInBed(wake + 2 * 60 * MINUTE)).toBe(false);
    expect(closeStaleInBed(wake + 3 * 60 * MINUTE)).toBe(true);
    expect(session()).toMatchObject({ closed: 'auto' });
    expect(session()!.upAt).toBeUndefined();
    expect(closeStaleInBed(wake + 4 * 60 * MINUTE)).toBe(false);
  });

  it('"Save last night from your taps" adds a manual night (the watch\'s replaces it later)', async () => {
    const { alarm } = await night();
    const up = minute(alarm);
    await endInBedSession('alarm', undefined, up);
    const s = session()!;
    const id = saveTapsNight({ day: s.wakeDate, lastNightIsCurrent: false, latencyMin: 18 });
    expect(id).toBe(`manual-${NOW}`);
    const saved = useStore.getState().sessions.find((x) => x.id === id)!;
    expect(saved).toMatchObject({ source: 'manual', origin: TAPS_ORIGIN, start: NOW, end: up });
    expect(session()!.savedId).toBe(id);
    // Once saved it isn't offered again.
    expect(saveTapsNight({ day: s.wakeDate, lastNightIsCurrent: false, latencyMin: 18 })).toBeUndefined();
  });
});

describe('the alarm line', () => {
  it("says your own alarm when eepy's is off, and a skipped morning", async () => {
    useStore.getState().setNotificationPrefs({ smartAlarm: false });
    const s = await startInBedSession(analysisAt(NOW), NOW);
    const a = analysisAt(NOW);
    expect(sessionAlarm(a, useStore.getState().settings, s, NOW)).toMatchObject({ state: 'own', wake: a.tonight.wake });
    useStore.getState().setNotificationPrefs({ smartAlarm: true });
    useStore.getState().setMark(WAKE_SKIP_MARK, dateKey(a.tonight.wake));
    expect(sessionAlarm(a, useStore.getState().settings, s, NOW).state).toBe('skipped');
    // The morning after it rang (eepy has moved on to the next alarm): only the wake-up is worth saying.
    useStore.getState().setMark(WAKE_SKIP_MARK, undefined);
    const later = atMinutes('2026-11-03', 7 * 60 + 30);
    expect(sessionAlarm(analysisAt(later), useStore.getState().settings, s, later)).toEqual({ state: 'past', wake: s.wakeAt });
  });
});
