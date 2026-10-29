import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { CalibrationResult } from '../engine/calibration';
import type { CbtiProgram } from '../engine/cbti';
import { generateDemoData } from '../engine/demo';
import type { Experiment } from '../engine/experiments';
import type { GoalSetting } from '../engine/goals';
import type { UpcomingDemand } from '../engine/nap';
import {
  AlertnessCheckIn,
  CaffeineDose,
  DailyStats,
  DayLog,
  DEFAULT_PROFILE,
  NightVitals,
  Profile,
  SleepDataset,
  SleepSession,
  Workout,
} from '../engine/types';
import type { SyncResult } from '../integrations/healthConnect';

export interface NotificationPrefs {
  windDown: boolean;
  bedtime: boolean;
  caffeine: boolean;
  morningCheckIn: boolean;
  smartAlarm: boolean;
  /** "Last night: 7h 12m · score 82 …" as soon as the night syncs. */
  morningReport: boolean;
  /** Reminders that react to naps, late caffeine and nap need. */
  adaptiveReminders: boolean;
  /** Nudge to open Nothing X when last night hasn't arrived by mid-morning. */
  missingNightNudge: boolean;
  /** Pinned countdown notification during wind-down. */
  liveWindDown: boolean;
  /** Short "how alert are you right now?" pings that teach the energy forecast. */
  pings: boolean;
  pingsPerDay: 2 | 3;
  /** Free-day morning prompt: "Did you wake up on your own?" */
  naturalWakePrompt: boolean;
  weeklyReview: boolean;
  experimentNudges: boolean;
}

export interface BackgroundSettings {
  enabled: boolean;
  lastRun?: number;
  lastResult?: string;
}

export interface CalendarSettings {
  enabled: boolean;
  /** Calendars to read; empty = all visible calendars. */
  calendarIds: string[];
  /** Minutes needed between waking and the first event. */
  prepMin: number;
}

export interface AudioSettings {
  sound: 'white' | 'pink' | 'brown' | 'rain';
  volume: number;
  timerMin: number;
}

export interface NapTimer {
  start: number;
  alarmAt: number;
  label: string;
  notificationId?: string;
}

export interface Settings {
  dataMode: 'live' | 'demo';
  /** Health Connect data origins (apps) to trust for sleep, most preferred first. */
  preferredOrigins: string[];
  /** Days of history pulled on the first sync. */
  historyDays: number;
  lastSync?: number;
  lastSyncError?: string;
  lastSyncCounts?: SyncResult['counts'];
  autoSync: boolean;
  notifications: NotificationPrefs;
  /** Something demanding later today that changes nap advice. */
  upcoming?: { kind: UpcomingDemand; date: string };
  napTimer?: NapTimer;
  background: BackgroundSettings;
  calendar: CalendarSettings;
  audio: AudioSettings;
  /** Small bookkeeping values for features (e.g. last morning report sent). */
  marks: Record<string, string | number | undefined>;
}

export interface AppState extends SleepDataset {
  checkins: AlertnessCheckIn[];
  workouts: Workout[];
  /** Learned personal circadian timing (energy forecast calibration). */
  calibration?: CalibrationResult;
  experiments: Experiment[];
  goals: GoalSetting[];
  cbti?: CbtiProgram;
  settings: Settings;
  hydrated: boolean;
  setHydrated(): void;
  setProfile(patch: Partial<Profile>): void;
  setSettings(patch: Partial<Settings>): void;
  setNotificationPrefs(patch: Partial<NotificationPrefs>): void;
  mergeSync(result: SyncResult): void;
  addManualSession(s: SleepSession): void;
  deleteSession(id: string): void;
  logDay(date: string, patch: Partial<DayLog>): void;
  toggleTag(date: string, tag: string): void;
  addCaffeine(d: CaffeineDose): void;
  removeCaffeine(id: string): void;
  saveScreening(id: string, answers: number[], score: number, date: string): void;
  loadDemo(now?: number): void;
  /** Drops demo data (keeping the user's own profile) before connecting real data. */
  exitDemo(): void;
  importData(data: SleepDataset): void;
  resetAll(): void;
  addCheckIn(c: AlertnessCheckIn): void;
  removeCheckIn(id: string): void;
  setCalibration(r: CalibrationResult | undefined): void;
  upsertExperiment(e: Experiment): void;
  removeExperiment(id: string): void;
  setGoals(goals: GoalSetting[]): void;
  setCbti(p: CbtiProgram | undefined): void;
  setBackground(patch: Partial<BackgroundSettings>): void;
  setCalendarSettings(patch: Partial<CalendarSettings>): void;
  setAudioSettings(patch: Partial<AudioSettings>): void;
  setMark(key: string, value: string | number | undefined): void;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  windDown: true,
  bedtime: true,
  caffeine: false,
  morningCheckIn: true,
  smartAlarm: false,
  morningReport: true,
  adaptiveReminders: true,
  missingNightNudge: true,
  liveWindDown: true,
  pings: true,
  pingsPerDay: 3,
  naturalWakePrompt: true,
  weeklyReview: true,
  experimentNudges: true,
};

const DEFAULT_SETTINGS: Settings = {
  dataMode: 'live',
  preferredOrigins: [],
  historyDays: 60,
  autoSync: true,
  notifications: DEFAULT_NOTIFICATION_PREFS,
  background: { enabled: true },
  calendar: { enabled: false, calendarIds: [], prepMin: 60 },
  audio: { sound: 'brown', volume: 0.6, timerMin: 45 },
  marks: {},
};

const EMPTY: Omit<AppState, keyof Actions | 'settings' | 'hydrated'> = {
  sessions: [],
  vitals: {},
  daily: {},
  dayLogs: {},
  caffeine: [],
  profile: DEFAULT_PROFILE,
  checkins: [],
  workouts: [],
  calibration: undefined,
  experiments: [],
  goals: [],
  cbti: undefined,
};

type Actions = {
  [K in keyof AppState as AppState[K] extends (...args: never[]) => unknown ? K : never]: AppState[K];
};

/** Data that belongs to a Health Connect window is replaced wholesale by a sync. */
function inWindow(start: number, end: number, from: number, to: number) {
  return end >= from && start <= to;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      ...EMPTY,
      settings: DEFAULT_SETTINGS,
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      setProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setNotificationPrefs: (patch) =>
        set((s) => ({ settings: { ...s.settings, notifications: { ...s.settings.notifications, ...patch } } })),

      mergeSync: (r) =>
        set((s) => {
          // Health Connect is the source of truth for its window: replace what we had there.
          const windowStart = r.from - 12 * 3600_000;
          const kept = s.sessions.filter((x) => x.source !== 'health-connect' || x.end < windowStart || x.start > r.to);
          const keptIds = new Set(kept.map((x) => x.id));
          const vitals: Record<string, NightVitals> = {};
          for (const [id, v] of Object.entries(s.vitals)) if (keptIds.has(id)) vitals[id] = v;
          Object.assign(vitals, r.vitals);
          const daily: Record<string, DailyStats> = { ...s.daily };
          for (const [date, d] of Object.entries(r.daily)) daily[date] = { ...daily[date], ...d };
          const keptWorkouts = s.workouts.filter((w) => !inWindow(w.start, w.end, windowStart, r.to));
          return {
            sessions: [...kept, ...r.sessions].sort((a, b) => a.start - b.start),
            vitals,
            daily,
            workouts: [...keptWorkouts, ...(r.workouts ?? [])].sort((a, b) => a.start - b.start),
            settings: { ...s.settings, lastSync: Date.now(), lastSyncError: undefined, lastSyncCounts: r.counts },
          };
        }),

      addManualSession: (session) => set((s) => ({ sessions: [...s.sessions.filter((x) => x.id !== session.id), session].sort((a, b) => a.start - b.start) })),
      deleteSession: (id) =>
        set((s) => {
          const vitals = { ...s.vitals };
          delete vitals[id];
          return { sessions: s.sessions.filter((x) => x.id !== id), vitals };
        }),

      logDay: (date, patch) =>
        set((s) => ({ dayLogs: { ...s.dayLogs, [date]: { ...(s.dayLogs[date] ?? { date, tags: [] }), ...patch } } })),
      toggleTag: (date, tag) =>
        set((s) => {
          const cur = s.dayLogs[date] ?? { date, tags: [] };
          const tags = cur.tags.includes(tag) ? cur.tags.filter((t) => t !== tag) : [...cur.tags, tag];
          return { dayLogs: { ...s.dayLogs, [date]: { ...cur, tags } } };
        }),

      addCaffeine: (d) => set((s) => ({ caffeine: [...s.caffeine, d].sort((a, b) => a.time - b.time) })),
      removeCaffeine: (id) => set((s) => ({ caffeine: s.caffeine.filter((x) => x.id !== id) })),

      saveScreening: (id, answers, score, date) =>
        set((s) => ({ profile: { ...s.profile, screenings: { ...s.profile.screenings, [id]: { score, answers, date } } } })),

      loadDemo: (now = Date.now()) =>
        set((s) => {
          const demo = generateDemoData(now);
          return {
            ...demo,
            profile: s.profile.onboarded ? s.profile : demo.profile,
            settings: { ...s.settings, dataMode: 'demo', preferredOrigins: [], lastSync: undefined, lastSyncError: undefined },
          };
        }),

      exitDemo: () =>
        set((s) =>
          s.settings.dataMode === 'demo'
            ? { ...EMPTY, profile: s.profile, settings: { ...s.settings, dataMode: 'live', lastSync: undefined } }
            : {},
        ),

      importData: (data) =>
        set((s) => ({ ...data, checkins: data.checkins ?? [], workouts: data.workouts ?? [], settings: { ...s.settings, dataMode: 'live' } })),

      resetAll: () => set({ ...EMPTY, settings: DEFAULT_SETTINGS }),

      addCheckIn: (c) => set((s) => ({ checkins: [...s.checkins.filter((x) => x.id !== c.id), c].sort((a, b) => a.time - b.time) })),
      removeCheckIn: (id) => set((s) => ({ checkins: s.checkins.filter((x) => x.id !== id) })),
      setCalibration: (calibration) => set({ calibration }),
      upsertExperiment: (e) => set((s) => ({ experiments: [...s.experiments.filter((x) => x.id !== e.id), e] })),
      removeExperiment: (id) => set((s) => ({ experiments: s.experiments.filter((x) => x.id !== id) })),
      setGoals: (goals) => set({ goals }),
      setCbti: (cbti) => set({ cbti }),
      setBackground: (patch) => set((s) => ({ settings: { ...s.settings, background: { ...s.settings.background, ...patch } } })),
      setCalendarSettings: (patch) => set((s) => ({ settings: { ...s.settings, calendar: { ...s.settings.calendar, ...patch } } })),
      setAudioSettings: (patch) => set((s) => ({ settings: { ...s.settings, audio: { ...s.settings.audio, ...patch } } })),
      setMark: (key, value) => set((s) => ({ settings: { ...s.settings, marks: { ...s.settings.marks, [key]: value } } })),
    }),
    {
      name: 'eepy-store-v1',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        sessions: s.sessions,
        vitals: s.vitals,
        daily: s.daily,
        dayLogs: s.dayLogs,
        caffeine: s.caffeine,
        profile: s.profile,
        checkins: s.checkins,
        workouts: s.workouts,
        calibration: s.calibration,
        experiments: s.experiments,
        goals: s.goals,
        cbti: s.cbti,
        settings: s.settings,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const ps = p.settings;
        return {
          ...current,
          ...p,
          profile: { ...DEFAULT_PROFILE, ...p.profile },
          checkins: p.checkins ?? [],
          workouts: p.workouts ?? [],
          experiments: p.experiments ?? [],
          goals: p.goals ?? [],
          settings: {
            ...DEFAULT_SETTINGS,
            ...ps,
            notifications: { ...DEFAULT_SETTINGS.notifications, ...ps?.notifications },
            background: { ...DEFAULT_SETTINGS.background, ...ps?.background },
            calendar: { ...DEFAULT_SETTINGS.calendar, ...ps?.calendar },
            audio: { ...DEFAULT_SETTINGS.audio, ...ps?.audio },
            marks: { ...ps?.marks },
          },
        };
      },
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);

export function selectDataset(s: AppState): SleepDataset {
  return {
    sessions: s.sessions,
    vitals: s.vitals,
    daily: s.daily,
    dayLogs: s.dayLogs,
    caffeine: s.caffeine,
    profile: s.profile,
    checkins: s.checkins,
    workouts: s.workouts,
  };
}

export function hasAnyData(s: AppState): boolean {
  return s.sessions.length > 0;
}
