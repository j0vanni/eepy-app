import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { Analysis, analyze } from '../engine/analysis';
import { dateKey, MINUTE } from '../engine/time';
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

/** Runs the full engine over the stored data; recomputed when data changes or every 5 minutes. */
export function useAnalysis(): Analysis | undefined {
  const data = useStore(useShallow(selectDataset));
  const preferredOrigins = useStore((s) => s.settings.preferredOrigins);
  const upcoming = useStore((s) => s.settings.upcoming);
  const now = useNow();
  const bucket = Math.floor(now / (5 * MINUTE));
  return useMemo(
    () =>
      sharedAnalysis(
        [data.sessions, data.vitals, data.daily, data.dayLogs, data.caffeine, data.profile, preferredOrigins, upcoming, bucket],
        () => {
          if (data.sessions.length === 0) return undefined;
          const t = Date.now();
          return analyze(data, t, {
            preferredOrigins,
            upcoming: upcoming && upcoming.date === dateKey(t) ? upcoming.kind : undefined,
          });
        },
      ),
    [data, preferredOrigins, upcoming, bucket],
  );
}
