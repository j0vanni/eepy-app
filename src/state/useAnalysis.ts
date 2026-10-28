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

/** Runs the full engine over the stored data; recomputed when data changes or every 5 minutes. */
export function useAnalysis(): Analysis | undefined {
  const data = useStore(useShallow(selectDataset));
  const preferredOrigins = useStore((s) => s.settings.preferredOrigins);
  const upcoming = useStore((s) => s.settings.upcoming);
  const now = useNow();
  const bucket = Math.floor(now / (5 * MINUTE));
  return useMemo(() => {
    if (data.sessions.length === 0) return undefined;
    const t = Date.now();
    return analyze(data, t, {
      preferredOrigins,
      upcoming: upcoming && upcoming.date === dateKey(t) ? upcoming.kind : undefined,
    });
    // `bucket` re-runs the analysis as time passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, preferredOrigins, upcoming, bucket]);
}
