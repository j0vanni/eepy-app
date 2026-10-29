import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { DAY, HOUR, MINUTE } from '../engine/time';
import { getPermissionState, healthConnectStatus, syncHealthConnect } from '../integrations/healthConnect';
import { summarizeOrigins } from '../integrations/healthConnectMapper';
import { useStore } from './store';

export type SyncCode = 'unsupported' | 'unavailable' | 'no-permission' | 'no-background-permission' | 'suspicious-empty' | 'error';

export interface SyncOutcome {
  ok: boolean;
  message: string;
  /** Why it failed (absent on success). */
  code?: SyncCode;
  /** Sleep sessions that weren't in the store before this sync. */
  newSessions?: number;
}

export interface SyncOptions {
  /** Re-read the whole history window instead of the last couple of days. */
  full?: boolean;
  /**
   * Running from the background task: needs Health Connect's background-read permission, never
   * writes `lastSyncError` (the foreground UI shouldn't show background hiccups), and refuses to
   * wipe stored nights when Health Connect suddenly returns nothing for a window that had sleep.
   */
  background?: boolean;
}

let inFlight: Promise<SyncOutcome> | undefined;

/** Pulls new data from Health Connect into the local store. */
export function runSync(opts: SyncOptions = {}): Promise<SyncOutcome> {
  inFlight ??= doSync(opts).finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

async function doSync({ full, background }: SyncOptions): Promise<SyncOutcome> {
  const { settings, setSettings, mergeSync } = useStore.getState();
  const fail = (code: SyncCode, message: string): SyncOutcome => {
    if (!background) setSettings({ lastSyncError: message });
    return { ok: false, code, message };
  };
  if (Platform.OS !== 'android') return { ok: false, code: 'unsupported', message: 'Health Connect is only available on Android.' };
  try {
    const status = await healthConnectStatus();
    if (status !== 'available') {
      return fail(
        'unavailable',
        status === 'update-required'
          ? 'Health Connect needs an update from the Play Store.'
          : 'Health Connect is not installed. Install it from the Play Store (built in on Android 14+).',
      );
    }
    const perms = await getPermissionState();
    if (!perms.sleep) return fail('no-permission', 'Allow eepy to read sleep data in Health Connect.');
    // Without it Health Connect rejects reads while eepy isn't on screen.
    if (background && !perms.background) return fail('no-background-permission', 'Health Connect background access is off.');

    const now = Date.now();
    const from = full || !settings.lastSync ? now - settings.historyDays * DAY : settings.lastSync - 2 * DAY;
    const result = await syncHealthConnect(from, now);
    const before = useStore.getState().sessions;
    if (background && result.sessions.length === 0) {
      // Individual record reads fail soft (empty), and merging an empty window would delete the
      // nights we already have there. Leave it for the next foreground sync to decide.
      const windowStart = result.from - 12 * HOUR;
      const hadSleep = before.some((s) => s.source === 'health-connect' && s.end >= windowStart && s.start <= result.to);
      if (hadSleep) return fail('suspicious-empty', 'Health Connect returned no sleep for nights eepy already has.');
    }
    const known = new Set(before.map((s) => s.id));
    const newSessions = result.sessions.filter((s) => !known.has(s.id)).length;
    mergeSync(result);
    if (useStore.getState().settings.preferredOrigins.length === 0) {
      const origins = summarizeOrigins(result.sessions);
      const pick = origins.find((o) => o.likelyWatch) ?? origins.find((o) => o.staged) ?? origins[0];
      if (pick) setSettings({ preferredOrigins: [pick.origin] });
    }
    return {
      ok: true,
      newSessions,
      message: result.counts.sessions
        ? `Synced ${result.counts.sessions} sleep sessions and ${result.counts.heartRate.toLocaleString()} heart-rate readings.`
        : 'Connected, but no sleep found yet. Open Nothing X, let it sync your watch, and check its Health Connect sharing is on.',
    };
  } catch (e) {
    return fail('error', e instanceof Error ? e.message : String(e));
  }
}

/** Syncs on launch and whenever the app returns to the foreground (at most every 15 minutes). */
export function useAutoSync() {
  const hydrated = useStore((s) => s.hydrated);
  useEffect(() => {
    if (!hydrated || Platform.OS !== 'android') return;
    const maybeSync = () => {
      const { settings, profile } = useStore.getState();
      if (!profile.onboarded || settings.dataMode !== 'live' || !settings.autoSync) return;
      if (settings.lastSync && Date.now() - settings.lastSync < 15 * MINUTE) return;
      if (!settings.lastSync && settings.lastSyncError && Date.now() - (settings.lastSync ?? 0) < HOUR) return;
      runSync().catch(() => undefined);
    };
    maybeSync();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && maybeSync());
    return () => sub.remove();
  }, [hydrated]);
}
