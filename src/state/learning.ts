/**
 * Keeps the learned body clock (store.calibration) in sync with the check-ins and sleep data.
 *
 * - `refitCalibration(state)` refits when its inputs changed (check-ins, synced nights, profile,
 *   reset) or once a day, and stores the result with `setCalibration`. Safe to call often.
 * - `useLearning()` calls it from React whenever those inputs change (mount it once, app-wide).
 * - `resetLearning()` restarts learning: check-ins before the reset are kept (for history and
 *   nap advice) but no longer feed the fit.
 */
import { useEffect } from 'react';

import {
  CALIBRATION_VERSION,
  calibrationInputFromDataset,
  CalibrationResult,
  eligibleCheckins,
  fitCircadian,
  LEARNING,
} from '../engine/calibration';
import { hashString } from '../engine/pingPlan';
import { dateKey, MINUTE } from '../engine/time';
import type { AlertnessCheckIn } from '../engine/types';
import { AppState, selectDataset, useStore } from './store';
import { useNow } from './useAnalysis';

/** settings.marks key holding the time of the last "Reset learned rhythm". */
export const LEARNING_RESET_MARK = 'learning.resetAt';

export function learningSince(state: AppState): number | undefined {
  const v = state.settings.marks[LEARNING_RESET_MARK];
  return typeof v === 'number' ? v : undefined;
}

/** Check-ins that count toward the fit right now. */
export function learningCheckins(state: AppState, now = Date.now()): AlertnessCheckIn[] {
  return eligibleCheckins(state.checkins, now, learningSince(state));
}

/** Everything the fit depends on, compressed into a string (plus the date, for a daily refresh). */
export function calibrationKey(state: AppState, now = Date.now()): string {
  const checkins = hashString(state.checkins.map((c) => `${c.id}|${c.time}|${c.kss}`).join(','));
  const last = state.sessions[state.sessions.length - 1];
  const profile = hashString(JSON.stringify(state.profile));
  return [
    CALIBRATION_VERSION,
    dateKey(now),
    state.checkins.length,
    checkins,
    state.sessions.length,
    last?.end ?? 0,
    last?.updatedAt ?? 0,
    profile,
    learningSince(state) ?? 0,
    state.settings.preferredOrigins.join(','),
  ].join(':');
}

let lastKey: string | undefined;

/**
 * Refits the personal circadian parameters if anything they depend on changed, and stores the
 * result (or clears it when there are too few usable check-ins). Returns the calibration in effect.
 */
export function refitCalibration(state: AppState = useStore.getState(), opts: { now?: number; force?: boolean } = {}): CalibrationResult | undefined {
  if (!state.hydrated) return state.calibration;
  const now = opts.now ?? Date.now();
  const key = calibrationKey(state, now);
  if (!opts.force && (key === lastKey || state.calibration?.key === key)) {
    lastKey = key;
    return state.calibration;
  }
  lastKey = key;

  let result: CalibrationResult | undefined;
  if (learningCheckins(state, now).length >= LEARNING.minCheckins && state.sessions.length > 0) {
    const input = calibrationInputFromDataset(selectDataset(state), now, {
      preferredOrigins: state.settings.preferredOrigins,
      since: learningSince(state),
    });
    const fit = fitCircadian(input);
    result = fit ? { ...fit, key } : undefined;
  }
  if (result || state.calibration) state.setCalibration(result);
  return result;
}

/** Forgets the learned rhythm and starts collecting from scratch. */
export function resetLearning(): void {
  const { setMark, setCalibration } = useStore.getState();
  setMark(LEARNING_RESET_MARK, Date.now());
  setCalibration(undefined);
  lastKey = undefined;
}

/** Refits in the background whenever check-ins, nights, the profile or the day change. */
export function useLearning(): void {
  const hydrated = useStore((s) => s.hydrated);
  const checkins = useStore((s) => s.checkins);
  const sessions = useStore((s) => s.sessions);
  const profile = useStore((s) => s.profile);
  const origins = useStore((s) => s.settings.preferredOrigins);
  const resetAt = useStore((s) => s.settings.marks[LEARNING_RESET_MARK]);
  const day = dateKey(useNow(30 * MINUTE));
  useEffect(() => {
    if (!hydrated) return;
    // Let the screen paint first; the fit takes tens of milliseconds.
    const id = setTimeout(() => {
      try {
        refitCalibration(useStore.getState());
      } catch (e) {
        console.warn('calibration refit failed', e);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [hydrated, checkins, sessions, profile, origins, resetAt, day]);
}
