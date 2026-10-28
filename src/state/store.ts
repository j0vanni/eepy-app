import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { generateDemoData } from '../engine/demo';
import type { UpcomingDemand } from '../engine/nap';
import {
  CaffeineDose,
  DailyStats,
  DayLog,
  DEFAULT_PROFILE,
  NightVitals,
  Profile,
  SleepDataset,
  SleepSession,
} from '../engine/types';
import type { SyncResult } from '../integrations/healthConnect';

export interface NotificationPrefs {
  windDown: boolean;
  bedtime: boolean;
  caffeine: boolean;
  morningCheckIn: boolean;
  smartAlarm: boolean;
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
}

export interface AppState extends SleepDataset {
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
}

const DEFAULT_SETTINGS: Settings = {
  dataMode: 'live',
  preferredOrigins: [],
  historyDays: 60,
  autoSync: true,
  notifications: { windDown: true, bedtime: true, caffeine: false, morningCheckIn: true, smartAlarm: false },
};

const EMPTY: SleepDataset = { sessions: [], vitals: {}, daily: {}, dayLogs: {}, caffeine: [], profile: DEFAULT_PROFILE };

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
          return {
            sessions: [...kept, ...r.sessions].sort((a, b) => a.start - b.start),
            vitals,
            daily,
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
            ? { sessions: [], vitals: {}, daily: {}, dayLogs: {}, caffeine: [], settings: { ...s.settings, dataMode: 'live', lastSync: undefined } }
            : {},
        ),

      importData: (data) => set((s) => ({ ...data, settings: { ...s.settings, dataMode: 'live' } })),

      resetAll: () => set({ ...EMPTY, settings: DEFAULT_SETTINGS }),
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
        settings: s.settings,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...p,
          profile: { ...DEFAULT_PROFILE, ...p.profile },
          settings: { ...DEFAULT_SETTINGS, ...p.settings, notifications: { ...DEFAULT_SETTINGS.notifications, ...p.settings?.notifications } },
        };
      },
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);

export function selectDataset(s: AppState): SleepDataset {
  return { sessions: s.sessions, vitals: s.vitals, daily: s.daily, dayLogs: s.dayLogs, caffeine: s.caffeine, profile: s.profile };
}

export function hasAnyData(s: AppState): boolean {
  return s.sessions.length > 0;
}
