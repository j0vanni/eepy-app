/** Remembers when eepy is on screen in the evening, at night and in the morning (evidence for engine/wakeDetect.ts). */
import { useEffect } from 'react';
import { AppState as RNAppState } from 'react-native';

import { logAppUse } from '../engine/wakeDetect';
import { useStore } from './store';

function note(start: number, end: number) {
  useStore.getState().updateWakeLog((log) => logAppUse(log, start, end));
}

/** Mount once (root layout): logs each time eepy comes to the foreground and when it leaves. */
export function useAppUseLog(): void {
  useEffect(() => {
    let since = Date.now();
    if (RNAppState.currentState === 'active') note(since, since);
    const sub = RNAppState.addEventListener('change', (state) => {
      const t = Date.now();
      if (state === 'active') {
        since = t;
        note(t, t);
      } else if (state === 'background') {
        note(since, t);
      }
    });
    return () => sub.remove();
  }, []);
}
