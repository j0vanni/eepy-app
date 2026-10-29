import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { Analysis, analyze } from '../engine/analysis';
import { MINUTE } from '../engine/time';
import { analyzeOptionsFor } from './analysisOptions';
import { useFirstEventTomorrowDetails } from './calendar';
import { selectDataset, useStore } from './store';

/** Current time, refreshed on an interval so time-dependent advice stays fresh. */
export function useNow(intervalMs = MINUTE): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Every mounted screen asks for the analysis; share one result per input set instead of recomputing.
let cache: { key: unknown[]; value: Analysis | undefined } | undefined;

function sharedAnalysis(key: unknown[], compute: () => Analysis | undefined): Analysis | undefined {
  if (cache && cache.key.length === key.length && cache.key.every((k, i) => k === key[i])) return cache.value;
  const value = compute();
  cache = { key, value };
  return value;
}

/** Runs the full engine over the stored data; recomputed when inputs change or every 5 minutes. */
export function useAnalysis(): Analysis | undefined {
  const data = useStore(useShallow(selectDataset));
  const settings = useStore((s) => s.settings);
  const calibration = useStore((s) => s.calibration);
  const cbti = useStore((s) => s.cbti);
  const firstEventInfo = useFirstEventTomorrowDetails(settings.calendar);
  const firstEvent = firstEventInfo?.start;
  const firstEventTitle = firstEventInfo?.title;
  const prepMin = settings.calendar.prepMin;
  const now = useNow();
  const bucket = Math.floor(now / (5 * MINUTE));
  return useMemo(
    () =>
      sharedAnalysis(
        [data.sessions, data.vitals, data.daily, data.dayLogs, data.caffeine, data.profile, data.checkins, data.workouts, settings.preferredOrigins, settings.upcoming, calibration, cbti, firstEvent, firstEventTitle, prepMin, bucket],
        () => {
          if (data.sessions.length === 0) return undefined;
          const t = Date.now();
          return analyze(data, t, analyzeOptionsFor(useStore.getState(), { now: t, firstEventTomorrow: firstEvent, firstEventTitle }));
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, settings.preferredOrigins, settings.upcoming, calibration, cbti, firstEvent, firstEventTitle, prepMin, bucket],
  );
}
