/**
 * Calendar access: tomorrow's first event drives the alarm/bedtime plan.
 * OWNER: calendar & workouts workstream. Stub — returns no event until implemented.
 */
import { useEffect, useState } from 'react';

import type { CalendarSettings } from './store';

/** Start (epoch ms) of the first timed event tomorrow in the selected calendars. */
export async function getFirstEventTomorrow(_settings: CalendarSettings, _now = Date.now()): Promise<number | undefined> {
  return undefined;
}

/** React hook wrapper around getFirstEventTomorrow, refreshed when settings change. */
export function useFirstEventTomorrow(settings: CalendarSettings): number | undefined {
  const [start, setStart] = useState<number>();
  useEffect(() => {
    let cancelled = false;
    if (!settings.enabled) {
      setStart(undefined);
      return;
    }
    getFirstEventTomorrow(settings)
      .then((t) => !cancelled && setStart(t))
      .catch(() => !cancelled && setStart(undefined));
    return () => {
      cancelled = true;
    };
  }, [settings]);
  return start;
}
