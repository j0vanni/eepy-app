// The store module creates a persisted zustand store on import.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { analyze, Analysis } from '../../engine/analysis';
import { generateDemoData } from '../../engine/demo';
import { atMinutes } from '../../engine/time';
import type { SleepDataset } from '../../engine/types';
import { AppState, DEFAULT_NOTIFICATION_PREFS, NotificationPrefs, Settings } from '../../state/store';
import type { PlannerContext } from '../types';

/** 2026-10-21 is a Wednesday (workday): demo data has a short, late night that ended ~06:55. */
export const WORKDAY = '2026-10-21';
/** 2026-10-24 is a Saturday: at 09:00 the demo free-day night hasn't ended yet (so it's "missing"). */
export const SATURDAY = '2026-10-24';

export const at = (day: string, h: number) => atMinutes(day, h * 60);

/** A plain AppState around a dataset, with jest.fn() actions. */
export function makeState(data: SleepDataset, over: { settings?: Partial<Settings>; prefs?: Partial<NotificationPrefs> } = {}): AppState {
  const settings: Settings = {
    clock: '24h',
    customDrinks: [],
    screenDim: false,
    screensOffMin: 45,
    dataMode: 'live',
    preferredOrigins: [],
    historyDays: 60,
    autoSync: true,
    notifications: { ...DEFAULT_NOTIFICATION_PREFS, ...over.prefs },
    background: { enabled: true },
    calendar: { enabled: false, calendarIds: [], prepMin: 60 },
    audio: { sound: 'brown', volume: 0.6, timerMin: 45 },
    watch: { napAlarm: 'phone', wakeAlarm: 'phone', backupMin: 5 },
    updates: { autoCheck: true },
    sleepMode: { enabled: false, startAt: 'lightsout', offerSounds: true },
    marks: {},
    ...over.settings,
  };
  const fn = () => jest.fn();
  return {
    ...data,
    // Treat demo sessions as if they came from the watch via Health Connect.
    sessions: data.sessions.map((s) => ({ ...s, source: 'health-connect' as const })),
    checkins: data.checkins ?? [],
    workouts: data.workouts ?? [],
    wakeLog: data.wakeLog ?? { detect: true, use: [], ups: [], fixes: {} },
    experiments: [],
    goals: [],
    settings,
    hydrated: true,
    setHydrated: fn(),
    setProfile: fn(),
    setSettings: fn(),
    setNotificationPrefs: fn(),
    mergeSync: fn(),
    addManualSession: fn(),
    deleteSession: fn(),
    logDay: fn(),
    toggleTag: fn(),
    addCaffeine: fn(),
    updateCaffeine: fn(),
    removeCaffeine: fn(),
    saveScreening: fn(),
    loadDemo: fn(),
    exitDemo: fn(),
    importData: fn(),
    resetAll: fn(),
    addCheckIn: fn(),
    removeCheckIn: fn(),
    updateWakeLog: fn(),
    setCalibration: fn(),
    upsertExperiment: fn(),
    removeExperiment: fn(),
    setGoals: fn(),
    setCbti: fn(),
    setBackground: fn(),
    setCalendarSettings: fn(),
    setAudioSettings: fn(),
    setUpdateSettings: fn(),
    setSleepModeSettings: fn(),
    setMark: fn(),
    setWatchSettings: fn(),
  } as AppState;
}

/** Demo data generated "as of" `dataNow`, analysed at `now` (defaults to the same instant). */
export function scenario(
  dataNow: number,
  opts: { now?: number; settings?: Partial<Settings>; prefs?: Partial<NotificationPrefs>; edit?: (d: SleepDataset) => SleepDataset; background?: boolean } = {},
): PlannerContext & { analysis: Analysis } {
  const now = opts.now ?? dataNow;
  let data = generateDemoData(dataNow);
  if (opts.edit) data = opts.edit(data);
  const state = makeState(data, opts);
  return { analysis: analyze({ ...data, sessions: state.sessions }, now), state, now, background: opts.background ?? true };
}
