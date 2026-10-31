import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { NativeSleepModeStatus } from '../../modules/eepy-alarm';
import { getSleepModeStatus, hasSleepMode, resetSleepModeMemo, syncSleepMode } from '../notifications/sleepMode';
import { useStore } from './store';
import { useAnalysis } from './useAnalysis';

/** How often an open screen re-reads the mode (it switches on and off by itself). */
const POLL_MS = 60_000;

/**
 * The native sleep-mode status (undefined until read, and on web / iOS / builds without it),
 * re-read on an interval, when eepy comes back to the front (e.g. from the access screen) and on
 * `refresh()`. When access was just granted, re-plans at once so the mode is created right away
 * (and switched on if tonight's window has already started).
 */
export function useSleepModeStatus(): { status: NativeSleepModeStatus | undefined; refresh: () => void } {
  const [status, setStatus] = useState<NativeSleepModeStatus>();
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const analysis = useAnalysis();
  const enabled = useStore((s) => s.settings.sleepMode.enabled);
  const hadAccess = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (!hasSleepMode()) return;
    let cancelled = false;
    getSleepModeStatus()
      .then((next) => {
        if (cancelled || !next) return;
        const gained = hadAccess.current === false && next.access;
        hadAccess.current = next.access;
        setStatus(next);
        if (gained && enabled) {
          // The plan was already handed over without access; send it again so the mode gets created now.
          resetSleepModeMemo();
          syncSleepMode(analysis, useStore.getState())
            .then(() => !cancelled && refresh())
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tick, analysis, enabled, refresh]);

  useEffect(() => {
    if (!hasSleepMode()) return;
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    const id = setInterval(refresh, POLL_MS);
    return () => {
      sub.remove();
      clearInterval(id);
    };
  }, [refresh]);

  return { status, refresh };
}
