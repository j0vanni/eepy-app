/**
 * Time-of-day helpers that shape the Today screen:
 *   morning – from this morning's wake-up for 3 hours
 *   day     – the rest of the waking day
 *   evening – from 2 hours before wind-down until lights-out
 *   night   – from lights-out until the next wake-up (and before this morning's wake-up)
 * plus "where am I on today's energy curve" and "if I fall asleep now, when should I wake?".
 */
import type { AlertnessPoint, EnergyForecast } from './alertness';
import type { Analysis } from './analysis';
import { CycleOption, wakesForBedtime, wakeTargetFor } from './schedule';
import { atMinutes, HOUR, MINUTE } from './time';
import type { Profile } from './types';

export type DayPhase = 'morning' | 'day' | 'evening' | 'night';

export const PHASE = {
  morningH: 3,
  /** Evening starts this long before wind-down. */
  eveningLeadH: 2,
  /** With no synced night yet, being up this long before the planned wake still counts as morning. */
  earlyWakeGraceMin: 60,
};

export interface DayPhaseInput {
  /** This morning's wake-up: the recorded one, or the planned one if last night hasn't synced. */
  wakeTime: number;
  /** False when `wakeTime` is only the plan (you may have got up a little earlier). Default true. */
  wakeRecorded?: boolean;
  /** Tonight's wind-down start and lights-out. */
  windDownStart: number;
  bedtime: number;
  /** The wake-up tonight's plan is heading for. */
  nextWake: number;
}

export function dayPhase(now: number, i: DayPhaseInput): DayPhase {
  if (now >= i.bedtime) {
    if (now < i.nextWake) return 'night';
    // A stale plan (the next wake has passed): treat it as the following morning.
    return now < i.nextWake + PHASE.morningH * HOUR ? 'morning' : 'day';
  }
  const grace = i.wakeRecorded === false ? PHASE.earlyWakeGraceMin * MINUTE : 0;
  // The day rolled over at 4am but you aren't up yet.
  if (now < i.wakeTime - grace) return 'night';
  if (now < i.wakeTime + PHASE.morningH * HOUR) return 'morning';
  if (now >= i.windDownStart - PHASE.eveningLeadH * HOUR) return 'evening';
  return 'day';
}

/** The wake-up the current night is heading for: tomorrow's after lights-out, otherwise this morning's. */
export function nightWakeTarget(now: number, i: DayPhaseInput): number {
  return now >= i.bedtime ? i.nextWake : i.wakeTime;
}

/** Phase inputs from the engine output. Before last night syncs, this morning's wake is today's wake target. */
export function phaseInputFor(a: Pick<Analysis, 'day' | 'wakeTime' | 'lastNightIsCurrent' | 'tonight' | 'alarm'>, profile: Profile): DayPhaseInput {
  const plannedWake = atMinutes(a.day, wakeTargetFor(profile, a.day).wakeMin);
  return {
    wakeTime: a.lastNightIsCurrent ? a.wakeTime : plannedWake,
    wakeRecorded: a.lastNightIsCurrent,
    windDownStart: a.tonight.windDownStart,
    bedtime: a.tonight.bedtime,
    nextWake: a.alarm.alarm,
  };
}

/** Energy (0–100) at time t, linearly interpolated between forecast points; undefined outside the curve. */
export function energyAt(points: AlertnessPoint[], t: number): number | undefined {
  if (points.length === 0 || t < points[0].t || t > points[points.length - 1].t) return undefined;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  if (b.t === a.t) return a.energy;
  return a.energy + ((b.energy - a.energy) * (t - a.t)) / (b.t - a.t);
}

export interface CurvePosition {
  energy: number;
  /** Direction over the next 30 minutes. */
  trend: 'rising' | 'falling' | 'steady';
  /** The next notable point on today's curve. */
  next?: { kind: 'peak' | 'dip' | 'bedtime'; t: number; energy?: number };
  inDip: boolean;
  inFocus: boolean;
}

export function curvePosition(f: EnergyForecast, now: number): CurvePosition | undefined {
  const energy = energyAt(f.points, now);
  if (energy === undefined) return undefined;
  const ahead = energyAt(f.points, Math.min(now + 30 * MINUTE, f.points[f.points.length - 1].t)) ?? energy;
  const delta = ahead - energy;
  const trend = delta > 2 ? 'rising' : delta < -2 ? 'falling' : 'steady';
  const events: NonNullable<CurvePosition['next']>[] = [
    ...f.peaks.map((p) => ({ kind: 'peak' as const, t: p.t, energy: p.energy })),
    ...(f.dip ? [{ kind: 'dip' as const, t: f.dip.t, energy: f.dip.energy }] : []),
    { kind: 'bedtime' as const, t: f.bedtime },
  ];
  const next = events.filter((e) => e.t > now).sort((a, b) => a.t - b.t)[0];
  return {
    energy,
    trend,
    next,
    inDip: !!f.dip && now >= f.dip.start && now <= f.dip.end,
    inFocus: f.focusWindows.some((w) => now >= w.start && now <= w.end),
  };
}

export interface FallAsleepOption extends CycleOption {
  /** Wakes no later than the latest wake-up. */
  fitsBeforeWake: boolean;
  /** The longest option that still fits (or, with no latest wake-up, the one that covers your need). */
  best: boolean;
}

/** "If I fall asleep now, wake at…": whole sleep cycles from now, judged against the latest acceptable wake-up. */
export function fallAsleepNowOptions(
  now: number,
  opts: { cycleMin: number; latencyMin: number; needMin: number; latestWake?: number },
): FallAsleepOption[] {
  const all = wakesForBedtime(now, opts.cycleMin, opts.latencyMin, opts.needMin);
  // 1–2 cycles are useful late at night too.
  const short = [1, 2].map((cycles) => {
    const sleepMin = cycles * opts.cycleMin;
    return { bedtime: now, wake: now + (sleepMin + opts.latencyMin) * MINUTE, cycles, sleepMin, meetsNeed: false, recommended: false };
  });
  const limit = opts.latestWake;
  const list = [...short, ...all].map((o) => ({ ...o, fitsBeforeWake: limit === undefined || o.wake <= limit, best: false }));
  const fitting = list.filter((o) => o.fitsBeforeWake);
  const best = limit === undefined ? list.find((o) => o.recommended) : fitting[fitting.length - 1];
  if (best) best.best = true;
  return list;
}
