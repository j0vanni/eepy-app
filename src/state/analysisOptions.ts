import type { AnalyzeOptions } from '../engine/analysis';
import { dateKey } from '../engine/time';
import type { AppState } from './store';

/** Everything from app state that personalises the engine run (used by the UI and the background task). */
export function analyzeOptionsFor(state: AppState, extras: { now: number; firstEventTomorrow?: number }): AnalyzeOptions {
  const upcoming = state.settings.upcoming;
  return {
    preferredOrigins: state.settings.preferredOrigins,
    upcoming: upcoming && upcoming.date === dateKey(extras.now) ? upcoming.kind : undefined,
    circadian: state.calibration?.params,
    firstEventTomorrow: extras.firstEventTomorrow,
    cbti: state.cbti?.active ? state.cbti : undefined,
  };
}
