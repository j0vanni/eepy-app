/**
 * Background sync: pulls new Health Connect data, re-runs the engine and re-plans notifications
 * (morning report, adaptive reminders, pings) while eepy is closed, then checks GitHub for a newer
 * eepy build (throttled to every 6 h inside checkForUpdates).
 *
 * This module is imported from the app entry (index.ts) so the task is defined before Android
 * wakes the JS runtime headlessly (no React tree is mounted then — only module scope runs).
 * Android runs it through WorkManager (expo-background-task): at most every BACKGROUND_INTERVAL_MIN
 * minutes, only while eepy is not in the foreground and the phone is online, and later than that
 * whenever Doze / battery saver say so.
 * OWNER: background & notifications workstream.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { analyze } from '../engine/analysis';
import { MINUTE } from '../engine/time';
import { syncWakeAlarm } from '../notifications/fullScreenAlarm';
import { syncSleepMode } from '../notifications/sleepMode';
import { replanNotifications } from '../notifications/scheduler';
import { analyzeOptionsFor } from '../state/analysisOptions';
import { applyClockSetting } from '../state/clockFormat';
import { getFirstEventTomorrowDetails } from '../state/calendar';
import { refitCalibration } from '../state/learning';
import { selectDataset, useStore } from '../state/store';
import { runSync } from '../state/sync';
import { checkForUpdates } from '../updates/check';

export const BACKGROUND_SYNC_TASK = 'eepy-background-sync';
/** WorkManager's floor is 15 min; 30 keeps the battery cost low and mornings fresh. */
export const BACKGROUND_INTERVAL_MIN = 30;
/** A sync the open app did this recently is fresh enough; just re-plan. */
const RECENT_SYNC = 10 * MINUTE;
/** WorkManager stops a worker after ~10 min; finish well before that. */
const SYNC_TIMEOUT = 4 * MINUTE;
/** The GitHub release check is one small request; never let it hold the worker up. */
const UPDATE_CHECK_TIMEOUT = MINUTE;

export interface BackgroundRunOutcome {
  result: BackgroundTask.BackgroundTaskResult;
  /** Short status shown in Settings (also stored as `settings.background.lastResult`). */
  summary: string;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** In a headless run nothing has awaited the persisted store yet. */
async function ensureHydrated(): Promise<void> {
  if (useStore.persist.hasHydrated()) return;
  await useStore.persist.rehydrate();
}

/**
 * zustand's persist middleware writes to AsyncStorage without awaiting. AsyncStorage runs its
 * operations in order, so a read of the same key completes only after earlier writes — use it
 * as a barrier so marks like "morning report sent" survive the process being frozen right after.
 */
async function flushStore(): Promise<void> {
  try {
    await AsyncStorage.getItem(useStore.persist.getOptions().name ?? 'eepy-store-v1');
  } catch {
    // best effort
  }
}

const SYNC_SUMMARY: Record<string, string> = {
  'no-background-permission': 'Needs Health Connect background access',
  'no-permission': 'Needs Health Connect sleep permission',
  unavailable: 'Health Connect unavailable',
  'suspicious-empty': 'Health Connect returned nothing — kept existing nights',
};

/** One background run: sync → analyse → re-plan notifications. Never throws. */
export async function runBackgroundSync(now = Date.now()): Promise<BackgroundRunOutcome> {
  let summary: string;
  let result = BackgroundTask.BackgroundTaskResult.Success;
  try {
    await ensureHydrated();
    const initial = useStore.getState();
    if (!initial.settings.background.enabled) return { result, summary: 'Off' };
    if (!initial.profile.onboarded) {
      summary = 'Skipped — finish setting up eepy first';
    } else if (initial.settings.dataMode !== 'live') {
      summary = 'Skipped — demo data';
    } else {
      // 1. Pull new data (unless the open app just did).
      const fresh = initial.settings.lastSync && now - initial.settings.lastSync < RECENT_SYNC;
      if (fresh) {
        summary = 'Up to date';
      } else {
        try {
          const sync = await withTimeout(runSync({ background: true }), SYNC_TIMEOUT, 'Health Connect sync');
          if (sync.ok) {
            const n = sync.newSessions ?? 0;
            summary = n > 0 ? `Synced · ${n} new sleep${n === 1 ? '' : 's'}` : 'Synced · nothing new';
          } else {
            summary = (sync.code && SYNC_SUMMARY[sync.code]) ?? `Sync failed: ${sync.message}`;
            result = BackgroundTask.BackgroundTaskResult.Failed;
          }
        } catch (e) {
          summary = `Sync failed: ${e instanceof Error ? e.message : String(e)}`;
          result = BackgroundTask.BackgroundTaskResult.Failed;
        }
      }

      // 2. Re-plan notifications from whatever data we have (even if the sync failed, so the
      //    missing-night nudge and tonight's reminders stay right).
      // Check-ins that were waiting for last night's data can count now.
      refitCalibration(useStore.getState());
      const state = useStore.getState();
      if (state.sessions.length > 0) {
        // Notification text uses the user's 12/24-hour choice (nothing else sets it headlessly).
        applyClockSetting(state.settings.clock);
        const firstEvent = state.settings.calendar.enabled
          ? await getFirstEventTomorrowDetails(state.settings.calendar, now).catch(() => undefined)
          : undefined;
        const analysis = analyze(
          selectDataset(state),
          now,
          analyzeOptionsFor(state, { now, firstEventTomorrow: firstEvent?.start, firstEventTitle: firstEvent?.title }),
        );
        await replanNotifications(analysis, useStore.getState(), { background: true, now });
        await syncWakeAlarm(analysis, useStore.getState(), now);
        await syncSleepMode(analysis, useStore.getState(), now);
      }
    }
  } catch (e) {
    summary = `Error: ${e instanceof Error ? e.message : String(e)}`;
    result = BackgroundTask.BackgroundTaskResult.Failed;
  }
  // 3. A newer eepy build on GitHub? Posts one "tap to update" notification per build. Its own
  //    throttle and errors never change the task's result.
  try {
    await withTimeout(checkForUpdates('background', now), UPDATE_CHECK_TIMEOUT, 'Update check');
  } catch {
    // the next run tries again
  }
  try {
    useStore.getState().setBackground({ lastRun: now, lastResult: summary });
    await flushStore();
  } catch {
    // never throw out of the task
  }
  return { result, summary };
}

// Defined at module scope so it exists in headless runs (Android starts JS without mounting the app).
if (Platform.OS !== 'web') {
  TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
    try {
      return (await runBackgroundSync()).result;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** Registers (or unregisters) the periodic background task according to settings. */
export async function registerBackgroundSync(enabled: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (!enabled) {
      if (registered) await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
      return;
    }
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (registered) {
      // registerTaskAsync is a no-op for a registered task, so re-register if the interval changed.
      const opts = await TaskManager.getTaskOptionsAsync<BackgroundTask.BackgroundTaskOptions>(BACKGROUND_SYNC_TASK).catch(() => undefined);
      if (opts?.minimumInterval === BACKGROUND_INTERVAL_MIN) return;
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
    }
    await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: BACKGROUND_INTERVAL_MIN });
  } catch (e) {
    console.warn('background sync registration failed', e);
  }
}

export interface BackgroundSyncStatus {
  /** Android allows background tasks for eepy (false in Expo Go and on web). */
  available: boolean;
  registered: boolean;
}

export async function getBackgroundSyncStatus(): Promise<BackgroundSyncStatus> {
  if (Platform.OS === 'web') return { available: false, registered: false };
  try {
    const [status, registered] = await Promise.all([BackgroundTask.getStatusAsync(), TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)]);
    return { available: status === BackgroundTask.BackgroundTaskStatus.Available, registered };
  } catch {
    return { available: false, registered: false };
  }
}
