/**
 * "I'm in bed" → "I'm up": the night's sleep session, started with one tap.
 *
 * - The tap is tonight's real lights-out. When it is ≥ 10 min off the plan it becomes the one-night
 *   override (`settings.tonight`, schedule.applyTonightOverride), so the cycle-timed alarm counts its
 *   cycles from the tap — still never later than the wake-up (smartAlarm stays in the 30 minutes
 *   before it), and the wake-up itself doesn't move. On a two-step morning the routine alarm is the
 *   cycle-timed first ring and the final alarm stays at the wake-up.
 * - While the session is open, tonight's wind-down, lights-out and screens-off reminders stay quiet
 *   (`inBedTonight`, checked by the planners).
 * - "I'm up" closes it (Today, the wake alarm, the watch buzz); one nobody closed closes itself once
 *   it's stale (`staleInBed`).
 * - The taps are evidence for wake-up detection (wakeDetect.ts rules 14–15) and, when no watch night
 *   arrives, can be saved as last night (`nightFromTaps`).
 *
 * Pure: the store, sleep mode, sounds and notifications are handled in src/state/inBed.ts.
 */
import { applyTonightOverride, SmartAlarm, timeTonight, TonightOverride, TonightPlan } from './schedule';
import { TAPS_ORIGIN } from './sessions';
import { atMinutes, clamp, formatTime, HOUR, MINUTE } from './time';
import type { SleepSession } from './types';

export const IN_BED = {
  /** A tap this close to tonight's lights-out keeps the plan as it is (alarm, reminders). */
  retimeMin: 10,
  /** An open session closes by itself this long after that morning's wake-up … */
  staleAfterWakeH: 3,
  /** … at noon that day at the latest … */
  staleAtMin: 12 * 60,
  /** … and in any case this long after "I'm in bed". */
  maxOpenH: 18,
  /** An alarm's "I'm up" sooner than this after "I'm in bed" isn't the morning (ignored). */
  minNightMin: 60,
  /** The confirmation (with Undo) shows this long after a tap. */
  confirmMin: 2,
  /** A night saved from taps: in bed → up at least / at most this long. */
  tapsNight: { minMin: 180, maxMin: 16 * 60 },
  /** Estimated time to fall asleep for a night saved from taps (your usual, within these bounds). */
  latency: { minMin: 5, maxMin: 60 },
} as const;

/** One night's session, kept in `settings.session` (persisted) until the next one starts. */
export interface InBedSession {
  /** When you tapped "I'm in bed" (to the minute). */
  inBedAt: number;
  /** The morning it belongs to (YYYY-MM-DD, TonightPlan.wakeDate). */
  wakeDate: string;
  /** That morning's (final) wake-up target when the session started. */
  wakeAt: number;
  /** The tap moved tonight's lights-out (`settings.tonight` was set from it). */
  retimed: boolean;
  /** `settings.tonight` before the tap, put back by Cancel / Undo (only when `retimed`). */
  prevTonight?: TonightOverride;
  /** Sleep cycles to the cycle-timed alarm when the session started (on a cycle boundary). */
  cycles?: number;
  /** A two-step morning: `cycles` count to the routine alarm; the final alarm is at the wake-up. */
  twoStep?: boolean;
  /** The default sleep sound was started by the tap. */
  soundsStarted?: boolean;
  /** What was started, e.g. "Brown noise · 45 min". */
  sounds?: string;
  /** The phone's sleep mode was switched on by the tap … */
  sleepModeStarted?: boolean;
  /** … or was already on (bedtime autopilot). */
  sleepModeOn?: boolean;
  /** "I'm up" (or the alarm's / watch buzz's "I'm up"). */
  upAt?: number;
  /** How it ended: you said you were up, or eepy closed it once stale. */
  closed?: 'up' | 'auto';
  closedAt?: number;
  /** "I'm up" switched the phone's sleep mode off; it was to stay on until then (Undo switches it on again). */
  sleepModeStopped?: number;
  /** Saved as last night ("Save last night from your taps"): the manual session's id. */
  savedId?: string;
  /** "Not now" on that offer. */
  dismissed?: boolean;
}

export interface InBedInput {
  /** analysis.tonight (it already follows any "Adjust tonight"). */
  tonight: TonightPlan;
  cycleMin: number;
  latencyMin: number;
  efficiency: number;
  windDownMin: number;
  /** `settings.tonight` at the tap. */
  override?: TonightOverride;
  /**
   * Tapped after 4am before this morning's wake-up: the analysis already plans the next night, so
   * the session belongs to this morning (its alarm is held by fullScreenAlarm.nextWakeAlarm) and
   * nothing is re-timed.
   */
  morning?: { wakeDate: string; wakeAt: number };
}

export interface InBedStart {
  session: InBedSession;
  /** `settings.tonight` after the tap (the same value when nothing moves). */
  override: TonightOverride | undefined;
  /** Tonight as the analysis will plan it after the tap, with its cycle-timed alarm (not for `morning`). */
  projected?: { tonight: TonightPlan; alarm: SmartAlarm };
}

const toMinute = (t: number) => Math.floor(t / MINUTE) * MINUTE;

/** What one "I'm in bed" tap at `now` does to tonight. */
export function planInBed(input: InBedInput, now: number): InBedStart {
  const at = toMinute(now);
  if (input.morning) {
    return { session: { inBedAt: at, wakeDate: input.morning.wakeDate, wakeAt: input.morning.wakeAt, retimed: false }, override: input.override };
  }
  const t = input.tonight;
  const prev = input.override;
  // Keep a wake-up you moved yourself; only lights-out follows the tap.
  const keepWake = prev?.wakeDate === t.wakeDate && prev.wake !== undefined ? { wake: prev.wake } : {};
  const next: TonightOverride = { wakeDate: t.wakeDate, bedtime: at, ...keepWake };
  const moved = applyTonightOverride(t, next, input.windDownMin);
  const retimed = Math.abs(at - t.bedtime) >= IN_BED.retimeMin * MINUTE && moved !== t;
  const projected = timeTonight(retimed ? moved : t, input.cycleMin, input.latencyMin, input.efficiency);
  const session: InBedSession = {
    inBedAt: at,
    wakeDate: t.wakeDate,
    wakeAt: projected.tonight.wake,
    retimed,
    ...(retimed && prev ? { prevTonight: prev } : {}),
    ...(projected.alarm.onBoundary && !t.noAlarm ? { cycles: projected.alarm.cycles } : {}),
    ...(projected.tonight.twoStep ? { twoStep: true } : {}),
  };
  return { session, override: retimed ? next : prev, projected };
}

/** A session that hasn't ended. */
export function isOpen(s: InBedSession | undefined): s is InBedSession & { closed?: undefined } {
  return !!s && !s.closed;
}

/** You're in bed for the night ending on `wakeDate`: the planners keep that night's evening reminders quiet. */
export function inBedTonight(s: InBedSession | undefined, wakeDate: string): boolean {
  return isOpen(s) && s.wakeDate === wakeDate;
}

/** The session ended at `at` — "I'm up" (`up`) or closed by eepy (`auto`, no up time). */
export function closeInBed(s: InBedSession, at: number, how: 'up' | 'auto'): InBedSession {
  return { ...s, closed: how, closedAt: at, ...(how === 'up' ? { upAt: toMinute(at) } : {}) };
}

/** Undo of "I'm up": open again. */
export function reopenInBed(s: InBedSession): InBedSession {
  const { closed: _c, closedAt: _a, upAt: _u, sleepModeStopped: _s, ...rest } = s;
  return rest;
}

/** Nobody said "I'm up": close it a few hours after that morning's wake-up (by noon at the latest). */
export function staleInBed(s: InBedSession | undefined, now: number): boolean {
  if (!isOpen(s)) return false;
  return now >= atMinutes(s.wakeDate, IN_BED.staleAtMin) || now >= s.wakeAt + IN_BED.staleAfterWakeH * HOUR || now >= s.inBedAt + IN_BED.maxOpenH * HOUR;
}

/** The Undo / confirmation window right after a tap at `t`. */
export function justNow(t: number | undefined, now: number): boolean {
  return t !== undefined && now >= t - MINUTE && now - t < IN_BED.confirmMin * MINUTE;
}

/** Estimated time to fall asleep for a night from taps: your usual, within sensible bounds. */
export function tapsLatencyMin(latencyMin: number): number {
  return Math.round(clamp(Number.isFinite(latencyMin) ? latencyMin : 15, IN_BED.latency.minMin, IN_BED.latency.maxMin));
}

/**
 * Last night from your taps: in bed → up as a manual session, awake for your usual time to fall
 * asleep, then asleep. Undefined without an up time or when it doesn't look like a night.
 */
export function nightFromTaps(s: InBedSession, latencyMin: number): SleepSession | undefined {
  if (s.upAt === undefined) return undefined;
  const min = (s.upAt - s.inBedAt) / MINUTE;
  if (min < IN_BED.tapsNight.minMin || min > IN_BED.tapsNight.maxMin) return undefined;
  const onset = s.inBedAt + Math.min(tapsLatencyMin(latencyMin), min - 60) * MINUTE;
  return {
    id: `manual-${s.inBedAt}`,
    source: 'manual',
    origin: TAPS_ORIGIN,
    kind: 'main',
    start: s.inBedAt,
    end: s.upAt,
    stages: [
      { stage: 'awake', start: s.inBedAt, end: onset },
      { stage: 'asleep', start: onset, end: s.upAt },
    ],
    notes: 'From your “I’m in bed” and “I’m up” taps',
  };
}

/**
 * Today's "Save last night from your taps": this morning's session ended with "I'm up", the watch's
 * night hasn't arrived, and it wasn't saved or dismissed yet.
 */
export function tapsNightOffer(s: InBedSession | undefined, ctx: { day: string; lastNightIsCurrent: boolean; latencyMin: number }): SleepSession | undefined {
  if (!s || s.closed !== 'up' || s.wakeDate !== ctx.day || ctx.lastNightIsCurrent || s.savedId || s.dismissed) return undefined;
  return nightFromTaps(s, ctx.latencyMin);
}

/** The alarm side of a session, as eepy will ring it (src/state/inBed.ts works it out). */
export interface SessionAlarm {
  /**
   * 'set': eepy's alarm rings at `at`; 'skipped' / 'off': not this morning; 'own': eepy's alarm is off
   * (your own alarm); 'past': that morning's alarm has rung — only the wake-up is worth saying.
   */
  state: 'set' | 'skipped' | 'off' | 'own' | 'past';
  /** First ring of the (final) alarm; with 'own', the best cycle-end wake-up. */
  at?: number;
  /** Two-step morning: the routine alarm's first ring (before `at`). */
  routineAt?: number;
  /** Sleep cycles to the cycle-timed alarm (the routine alarm on a two-step morning). */
  cycles?: number;
  /** The wake-up target. */
  wake: number;
}

const cyclesNote = (n: number | undefined) => (n ? ` (${n} cycle${n === 1 ? '' : 's'})` : '');

/** "alarm 6:52 AM (5 cycles)", "routine alarm 4:47 AM (4 cycles) · up 6:05 AM", "no alarm (skipped)". */
export function alarmPhrase(x: SessionAlarm): string {
  switch (x.state) {
    case 'set':
      if (x.routineAt !== undefined && x.at !== undefined) return `routine alarm ${formatTime(x.routineAt)}${cyclesNote(x.cycles)} · up ${formatTime(x.at)}`;
      return x.at !== undefined ? `alarm ${formatTime(x.at)}${cyclesNote(x.cycles)}` : `up ${formatTime(x.wake)}`;
    case 'skipped':
      return 'no alarm (skipped)';
    case 'off':
      return 'alarm off';
    case 'past':
      return `wake-up ${formatTime(x.wake)}`;
    case 'own':
      return x.at !== undefined && x.cycles ? `best wake-up ${formatTime(x.at)}${cyclesNote(x.cycles)}` : `wake-up ${formatTime(x.wake)}`;
  }
}

/** The details line under a session: "alarm 6:52 AM (5 cycles) · sleep mode on · Brown noise · 45 min". */
export function sessionDetails(s: InBedSession, alarm: SessionAlarm, opts: { soundsPlaying?: boolean } = {}): string {
  return [alarmPhrase(alarm), s.sleepModeOn ? 'sleep mode on' : undefined, opts.soundsPlaying && s.sounds ? s.sounds : undefined].filter(Boolean).join(' · ');
}
