/**
 * "I'm up" before this morning's alarm (state/earlyUp.ts) against the real store: offered from 3am
 * until the alarm, ends the night (session or not), turns off this morning's alarms (both on a
 * two-step morning), switches Today to the morning, and Undo puts it all back.
 */
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  setNotificationCategoryAsync: jest.fn(() => Promise.resolve()),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  clearLastNotificationResponse: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const mockStatus: { current: Record<string, unknown> } = { current: {} };
const mockNative = {
  scheduleAlarm: jest.fn((..._args: unknown[]) => Promise.resolve(true)),
  cancelAlarm: jest.fn((_id: string) => Promise.resolve()),
  canUseFullScreenIntent: jest.fn(() => Promise.resolve(true)),
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

import { Platform } from 'react-native';

import { soundPlayer } from '../../audio/player';
import { analyze, Analysis } from '../../engine/analysis';
import { dayPhase, phaseInputFor } from '../../engine/dayPhase';
import { atMinutes, MINUTE } from '../../engine/time';
import { nextWakeAlarm, WAKE_AT_MARK, WAKE_FINAL_SKIP_MARK, WAKE_ROUTINE_AT_MARK, WAKE_ROUTINE_SKIP_MARK, WAKE_UP_EARLY_MARK } from '../../notifications/fullScreenAlarm';
import { analyzeOptionsFor } from '../analysisOptions';
import { earlyUpOffer, imUpEarly, undoEarlyUp, upEarlyAt } from '../earlyUp';
import { inBedAvailable, startInBedSession } from '../inBed';
import { selectDataset, useStore } from '../store';

// Monday night → Tuesday 2026-11-03, a workday with a 07:00 wake-up in the demo profile.
const MON = '2026-11-02';
const TUE = '2026-11-03';
const prevOS = Platform.OS;
const analysisAt = (now: number): Analysis => {
  const s = useStore.getState();
  return analyze(selectDataset(s), now, analyzeOptionsFor(s, { now }));
};
const at = (day: string, h: number) => atMinutes(day, Math.round(h * 60));

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  jest.clearAllMocks();
  (Platform as { OS: string }).OS = 'android';
  const eve = at(MON, 21);
  jest.spyOn(Date, 'now').mockReturnValue(eve);
  soundPlayer.stopNow();
  const st = useStore.getState();
  st.loadDemo(eve);
  st.setProfile({ onboarded: true, twoStepMorning: undefined, wakePlan: {} });
  st.setSettings({ session: undefined, tonight: undefined, inBedSounds: false, marks: {}, clock: '24h' });
  st.setNotificationPrefs({ smartAlarm: true });
  st.setSleepModeSettings({ enabled: true, startAt: 'lightsout' });
  mockStatus.current = { access: true, active: true, windows: [] };
});
afterEach(() => {
  soundPlayer.stopNow();
  (Platform as { OS: string }).OS = prevOS;
  jest.restoreAllMocks();
});

/** This morning's alarm as syncWakeAlarm holds it after 4am. */
function holdMorning(twoStep = false) {
  if (twoStep) useStore.getState().setProfile({ twoStepMorning: { enabled: true, firstWakeMin: 5 * 60, routineMin: 20, since: MON } });
  const before = analysisAt(at(TUE, 3));
  const marks: Record<string, number> = { [WAKE_AT_MARK]: before.tonight.wake };
  if (before.tonight.twoStep) marks[WAKE_ROUTINE_AT_MARK] = before.alarm.alarm;
  useStore.getState().setSettings({ marks });
  return { final: before.tonight.wake, routine: before.tonight.twoStep ? before.alarm.alarm : undefined };
}

describe('"I\'m up" before the alarm', () => {
  it('is offered from 3am until this morning\'s alarm', () => {
    const { final } = holdMorning();
    const s = useStore.getState();
    expect(earlyUpOffer(analysisAt(at(TUE, 2.5)), s.settings, s.profile, at(TUE, 2.5))).toBeUndefined();
    expect(earlyUpOffer(analysisAt(at(TUE, 4.5)), s.settings, s.profile, at(TUE, 4.5))).toMatchObject({ date: TUE, wakeAt: final, eepyAlarm: true });
    expect(earlyUpOffer(analysisAt(final + MINUTE), s.settings, s.profile, final + MINUTE)).toBeUndefined();
  });

  it('turns off this morning\'s alarm, logs when you got up, switches Today to the morning — and Undo puts it back', async () => {
    holdMorning();
    const now = at(TUE, 4.75);
    (Date.now as jest.Mock).mockReturnValue(now);
    const a = analysisAt(now);
    const input = phaseInputFor(a, useStore.getState().profile);
    expect(dayPhase(now, input)).toBe('night');
    const undo = await imUpEarly(a, now);
    const st = useStore.getState();
    expect(st.settings.marks[WAKE_FINAL_SKIP_MARK]).toBe(TUE);
    expect(upEarlyAt(st.settings, now)).toBe(now);
    expect(nextWakeAlarm(analysisAt(now), st.settings, now).done).toBe(true);
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith('eepy-wake');
    expect(st.wakeLog.outOfBed ?? []).toContain(now);
    expect(mockNative.stopSleepModeNow).toHaveBeenCalled();
    // Today: morning now, and no "I'm in bed".
    expect(dayPhase(now, phaseInputFor(a, st.profile, upEarlyAt(st.settings, now)))).toBe('morning');
    expect(inBedAvailable(a, st.profile, now)).toBe(false);
    expect(earlyUpOffer(a, st.settings, st.profile, now)).toBeUndefined();

    await undoEarlyUp(undo, a);
    const back = useStore.getState();
    expect(back.settings.marks[WAKE_FINAL_SKIP_MARK]).toBeUndefined();
    expect(back.settings.marks[WAKE_UP_EARLY_MARK]).toBeUndefined();
    expect(back.wakeLog.outOfBed ?? []).not.toContain(now);
    expect(nextWakeAlarm(analysisAt(now), back.settings, now).done).toBe(false);
    expect(mockNative.startSleepModeNow).toHaveBeenCalled();
  });

  it('ends an open sleep session (Undo opens it again)', async () => {
    holdMorning();
    const bed = at(MON, 23);
    (Date.now as jest.Mock).mockReturnValue(bed);
    await startInBedSession(analysisAt(bed), bed);
    expect(useStore.getState().settings.session?.closed).toBeUndefined();
    const now = at(TUE, 5);
    (Date.now as jest.Mock).mockReturnValue(now);
    const undo = await imUpEarly(analysisAt(now), now);
    expect(undo.sessionEnded).toBe(true);
    expect(useStore.getState().settings.session).toMatchObject({ closed: 'up', upAt: now });
    await undoEarlyUp(undo, analysisAt(now));
    expect(useStore.getState().settings.session?.closed).toBeUndefined();
  });

  it('on a two-step morning, before the routine alarm: both alarms off', async () => {
    const { routine } = holdMorning(true);
    expect(routine).toBeDefined();
    const now = routine! - 20 * MINUTE;
    (Date.now as jest.Mock).mockReturnValue(now);
    const s = useStore.getState();
    expect(earlyUpOffer(analysisAt(now), s.settings, s.profile, now)).toMatchObject({ routineAt: routine });
    await imUpEarly(analysisAt(now), now);
    const marks = useStore.getState().settings.marks;
    expect(marks[WAKE_FINAL_SKIP_MARK]).toBe(TUE);
    expect(marks[WAKE_ROUTINE_SKIP_MARK]).toBe(TUE);
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith('eepy-wake-routine');
    // The routine wasn't recorded as skipped: no sleep after waking makes it the real wake-up anyway.
    expect(useStore.getState().profile.wakePlan?.[TUE]).toBeUndefined();
  });
});
