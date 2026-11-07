/**
 * Naps you took without eepy's nap timer ("Took a nap? Log it"): a manual nap session, so sleep
 * pressure, tonight's plan, the nap coach and the trends count it. Naps the watch recorded count
 * already; the timer's naps are logged when you stop it (notifications/napTimer.ts).
 */
import { dateKey, MINUTE, minutesOfDay } from '../engine/time';
import type { SleepSession } from '../engine/types';
import { useStore } from './store';

export const NAP_LOG = {
  /** In bed at least / at most this long. */
  minMin: 5,
  maxMin: 4 * 60,
  /** Time to fall asleep assumed for a logged nap (none for a very short one). */
  fallAsleepMin: 5,
  /** How far back a nap can be logged. */
  backH: 24,
};

export interface NapEntry {
  id: string;
  start: number;
  end: number;
  minutes: number;
  /** Logged here or by the nap timer (can be removed); otherwise recorded by the watch. */
  manual: boolean;
}

/** The nap session for "lay down at `start`, up after `minutes`". */
export function napSession(start: number, minutes: number): SleepSession {
  const m = Math.round(Math.min(NAP_LOG.maxMin, Math.max(NAP_LOG.minMin, minutes)));
  const end = start + m * MINUTE;
  const asleep = m >= 15 ? start + NAP_LOG.fallAsleepMin * MINUTE : start;
  return {
    id: `nap-log-${start}`,
    source: 'manual',
    start,
    end,
    kind: 'nap',
    stages: [...(asleep > start ? [{ stage: 'awake' as const, start, end: asleep }] : []), { stage: 'light', start: asleep, end }],
  };
}

/** Where a logged nap can start: within the last day, and finished by now. */
export function clampNapStart(start: number, minutes: number, now: number): number {
  const step = 5 * MINUTE;
  const latest = Math.floor((now - minutes * MINUTE) / step) * step;
  return Math.max(now - NAP_LOG.backH * 3600_000, Math.min(latest, start));
}

/** Logs a nap; returns its id (for Undo). */
export function logNap(start: number, minutes: number, now = Date.now()): string {
  const s = napSession(clampNapStart(start, minutes, now), minutes);
  useStore.getState().addManualSession(s);
  return s.id;
}

/** Removes a nap you logged (or the timer logged). */
export function removeNap(id: string): void {
  useStore.getState().deleteSession(id);
}

/** Today's naps (by when they ended), oldest first. */
export function napsOn(sessions: SleepSession[], date: string): NapEntry[] {
  return sessions
    // Logged naps, and the watch's short daytime sleeps (roughly how engine/sessions.ts tells them apart).
    .filter((s) => dateKey(s.end) === date && (s.kind === 'nap' || (s.kind === undefined && s.end - s.start < 150 * MINUTE && minutesOfDay(s.start) >= 9 * 60 && minutesOfDay(s.start) < 21 * 60)))
    .map((s) => ({ id: s.id, start: s.start, end: s.end, minutes: Math.round((s.end - s.start) / MINUTE), manual: s.source === 'manual' }))
    .sort((a, b) => a.start - b.start);
}
