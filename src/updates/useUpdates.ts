/** React side of app updates: the app-open check and "is an update waiting?". */
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useStore } from '../state/store';
import { checkForUpdates, dismissInstalledUpdateNotification } from './check';
import { installedBuild } from './current';
import { removeInstalledDownloads } from './install';

/** Checks for a newer build when eepy opens or returns to the foreground (throttled). Mount once. */
export function useUpdateChecks(): void {
  const hydrated = useStore((s) => s.hydrated);
  useEffect(() => {
    if (!hydrated) return;
    // Just updated? Tidy up the APK and the "update ready" notification.
    removeInstalledDownloads(installedBuild().build);
    dismissInstalledUpdateNotification().catch(() => undefined);
    const maybeCheck = () => {
      checkForUpdates('open').catch(() => undefined);
    };
    maybeCheck();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && maybeCheck());
    return () => sub.remove();
  }, [hydrated]);
}

/** The newer build waiting to be installed, if the last check found one. Never on dev builds. */
export function usePendingUpdate(): number | undefined {
  const latestBuild = useStore((s) => s.settings.updates.latestBuild);
  const installed = installedBuild().build;
  return latestBuild !== undefined && installed !== undefined && latestBuild > installed ? latestBuild : undefined;
}
