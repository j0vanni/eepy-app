import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { DAY, HOUR, MINUTE } from '../engine/time';
import { getPermissionState, healthConnectStatus, syncHealthConnect } from '../integrations/healthConnect';
import { summarizeOrigins } from '../integrations/healthConnectMapper';
import { useStore } from './store';

export interface SyncOutcome {
  ok: boolean;
  message: string;
}

let inFlight: Promise<SyncOutcome> | undefined;

/** Pulls new data from Health Connect into the local store. */
export function runSync(opts: { full?: boolean } = {}): Promise<SyncOutcome> {
  inFlight ??= doSync(opts).finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

async function doSync({ full }: { full?: boolean }): Promise<SyncOutcome> {
  const { settings, setSettings, mergeSync } = useStore.getState();
  if (Platform.OS !== 'android') return { ok: false, message: 'Health Connect is only available on Android.' };
  const status = await healthConnectStatus();
  if (status !== 'available') {
    const message =
      status === 'update-required'
        ? 'Health Connect needs an update from the Play Store.'
        : 'Health Connect is not installed. Install it from the Play Store (built in on Android 14+).';
    setSettings({ lastSyncError: message });
    return { ok: false, message };
  }
  const perms = await getPermissionState();
  if (!perms.sleep) {
    const message = 'Allow eepy to read sleep data in Health Connect.';
    setSettings({ lastSyncError: message });
    return { ok: false, message };
  }
  const now = Date.now();
  const from = full || !settings.lastSync ? now - settings.historyDays * DAY : settings.lastSync - 2 * DAY;
  try {
    const result = await syncHealthConnect(from, now);
    mergeSync(result);
    if (useStore.getState().settings.preferredOrigins.length === 0) {
      const origins = summarizeOrigins(result.sessions);
      const pick = origins.find((o) => o.likelyWatch) ?? origins.find((o) => o.staged) ?? origins[0];
      if (pick) setSettings({ preferredOrigins: [pick.origin] });
    }
    return {
      ok: true,
      message: result.counts.sessions
        ? `Synced ${result.counts.sessions} sleep sessions and ${result.counts.heartRate.toLocaleString()} heart-rate readings.`
        : 'Connected, but no sleep found yet. Open the CMF Watch app and make sure Health Connect sync is on.',
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    setSettings({ lastSyncError: message });
    return { ok: false, message };
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
