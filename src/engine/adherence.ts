/**
 * Learning from what actually happens, for the nightly plan (engine/planOptions.ts, analysis.ts):
 *
 * - **Plan log**: what eepy planned each night (`planLog` in the store, written by the app and the
 *   background task while the night's lights-out is still ahead, then frozen).
 * - **Adherence**: when you actually went to bed — the "I'm in bed" tap, or what the watch saw (sleep
 *   onset minus your usual time to fall asleep, or the start of the recording if that's earlier) —
 *   against the lights-out you were aiming for. "Last 3 nights you went to bed ~35 min after the plan."
 * - **Advance rate**: how fast your sleep onset has really been moving earlier over the last week
 *   (a robust Theil–Sen slope, so one late weekend doesn't swing it). The planner's ramp for coming
 *   nights (schedule.BODY_CLOCK.rampMinPerNight, 30 min a night) is blended towards it and bounded
 *   to 15–45 min, so the week strip doesn't promise a pace you aren't keeping.
 *
 * Pure: no React or native imports.
 */
import { BODY_CLOCK, TonightPlan } from './schedule';
import type { Night } from './sessions';
import { median } from './stats';
import { addDays, clamp, clockDiff, daysBetween, MINUTE, minutesOfDay, normalizeMinutes } from './time';
import type { NightTimeline } from './wakeDetect';

/** What eepy planned for one night. */
export interface PlannedNight {
  /** The morning it ends (TonightPlan.wakeDate). */
  wakeDate: string;
  /** eepy's own lights-out (before any one-night change). */
  planned: number;
  /** The lights-out you were aiming for: your own time for that night (Adjust tonight, an option) or eepy's. */
  target: number;
  wake: number;
  /** Lights-out was held later for the body clock (the plan was easing you earlier). */
  held: boolean;
}

/** By morning (YYYY-MM-DD). */
export type PlanLog = Record<string, PlannedNight>;

export const PLAN_LOG_DAYS = 30;

const sameEntry = (a: PlannedNight, b: PlannedNight) => a.planned === b.planned && a.target === b.target && a.wake === b.wake && a.held === b.held;

/**
 * Records tonight's plan. The entry follows the plan (and your changes to it) until its lights-out
 * has passed, then stays as it was; an open "I'm in bed" session (whose tap moves tonight's
 * lights-out) never changes it. Returns `log` itself when nothing changes.
 */
export function logPlannedNight(log: PlanLog | undefined, input: { tonight: TonightPlan; now: number; inBed?: boolean }): PlanLog {
  const cur = log ?? {};
  const t = input.tonight;
  const prev = cur[t.wakeDate];
  if (input.inBed) return cur;
  if (prev && input.now >= prev.target) return cur;
  const planned = t.adjusted?.plannedBedtime ?? t.bedtime;
  // First seen after eepy's lights-out (eepy wasn't open in the evening): a time chosen just now isn't what you aimed for.
  const target = !prev && input.now >= planned ? planned : t.bedtime;
  const entry: PlannedNight = { wakeDate: t.wakeDate, planned, target, wake: t.wake, held: t.gradual };
  if (prev && sameEntry(prev, entry)) return cur;
  const oldest = addDays(t.wakeDate, -PLAN_LOG_DAYS);
  const next: PlanLog = {};
  for (const [k, v] of Object.entries(cur)) if (k >= oldest) next[k] = v;
  next[t.wakeDate] = entry;
  return next;
}

export const ADHERENCE = {
  /** Nights looked at (with a logged plan and a recorded night) … */
  windowNights: 7,
  /** … within this many days. */
  lookbackDays: 10,
  /** "Last 3 nights …" */
  recentNights: 3,
  minNights: 2,
  /** Within this many minutes counts as on time. */
  onTimeMin: 15,
  /** Later than this (median) is worth saying and planning around. */
  lateMin: 20,
  /** A difference bigger than this is a different night (travel, a party), not lateness. */
  maxAbsMin: 240,
} as const;

export interface NightAdherence {
  wakeDate: string;
  target: number;
  /** When you actually went to bed. */
  lightsOut: number;
  /** "I'm in bed" (or your own correction) vs what the watch saw. */
  source: 'tap' | 'watch';
  onset: number;
  /** lightsOut − target in minutes (positive = later than you aimed for). */
  lateMin: number;
}

export interface Adherence {
  /** Oldest first. */
  nights: NightAdherence[];
  /** Median minutes late over those nights. */
  usualLateMin: number;
  /** Median over the most recent `recentNights` of them. */
  recentLateMin: number;
  recentNights: number;
  /** Share of nights within ADHERENCE.onTimeMin of the target. */
  onTimeShare: number;
  /** When you've actually been going to bed lately (minutes after midnight, the recent nights' median). */
  recentLightsOutMin: number;
}

/** When you went to bed on a recorded night: the tap (or your correction), else the watch, never later than onset − your usual latency. */
export function actualLightsOut(main: Night['main'], timeline: NightTimeline | undefined, latencyMin: number): { time: number; source: 'tap' | 'watch' } | undefined {
  if (!main) return undefined;
  const src = timeline?.inBed.source;
  if (timeline && (src === 'inbed' || src === 'you')) return { time: timeline.inBed.time, source: 'tap' };
  const recorded = timeline?.inBed.time ?? main.start;
  return { time: Math.min(recorded, main.sleepOnset - Math.max(0, latencyMin) * MINUTE), source: 'watch' };
}

/** Minutes after midnight, as a median that works across midnight (relative to noon). */
function clockMedian(times: number[]): number {
  return normalizeMinutes(median(times.map((t) => normalizeMinutes(minutesOfDay(t) - 12 * 60))) + 12 * 60);
}

/** How late you've been going to bed against your plan, from nights that have a logged plan. */
export function estimateAdherence(input: { nights: Night[]; timelines: Record<string, NightTimeline>; planLog: PlanLog | undefined; latencyMin: number; today: string }): Adherence | undefined {
  const log = input.planLog;
  if (!log) return undefined;
  const from = addDays(input.today, -ADHERENCE.lookbackDays);
  const rows: NightAdherence[] = [];
  for (const n of input.nights) {
    if (!n.main || n.wakeDate <= from || n.wakeDate > input.today) continue;
    const plan = log[n.wakeDate];
    if (!plan) continue;
    const lo = actualLightsOut(n.main, input.timelines[n.main.id], input.latencyMin);
    if (!lo) continue;
    const lateMin = Math.round((lo.time - plan.target) / MINUTE);
    if (Math.abs(lateMin) > ADHERENCE.maxAbsMin) continue;
    rows.push({ wakeDate: n.wakeDate, target: plan.target, lightsOut: lo.time, source: lo.source, onset: n.main.sleepOnset, lateMin });
  }
  const nights = rows.sort((a, b) => (a.wakeDate < b.wakeDate ? -1 : 1)).slice(-ADHERENCE.windowNights);
  if (nights.length < ADHERENCE.minNights) return undefined;
  const recent = nights.slice(-ADHERENCE.recentNights);
  return {
    nights,
    usualLateMin: Math.round(median(nights.map((r) => r.lateMin))),
    recentLateMin: Math.round(median(recent.map((r) => r.lateMin))),
    recentNights: recent.length,
    onTimeShare: nights.filter((r) => Math.abs(r.lateMin) <= ADHERENCE.onTimeMin).length / nights.length,
    recentLightsOutMin: Math.round(clockMedian(recent.map((r) => r.lightsOut))),
  };
}

export const ADVANCE = {
  /** Recent nights the slope is measured over … */
  windowNights: 7,
  /** … within this many days. */
  lookbackDays: 10,
  minNights: 4,
  /** The default ramp counts like this many nights of evidence (so a few nights only nudge it). */
  priorNights: 2,
  minRampMin: 15,
  maxRampMin: 45,
} as const;

export interface AdvanceRate {
  /** Minutes per night your sleep onset has moved earlier lately (negative = later). */
  observedMinPerNight: number;
  nights: number;
  /** What the planner assumes for coming nights: the default ramp blended with what you've done, 15–45 min. */
  rampMinPerNight: number;
  /** Differs from the default ramp (BODY_CLOCK.rampMinPerNight). */
  adapted: boolean;
}

/** Theil–Sen slope: the median of the pairwise slopes (robust to an odd night or two). */
function robustSlope(points: { x: number; y: number }[]): number | undefined {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      if (dx > 0) slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  return slopes.length ? median(slopes) : undefined;
}

/**
 * How fast your sleep onset has actually been moving earlier over the last week, and the ramp the
 * planner should assume for coming nights. Undefined with fewer than ADVANCE.minNights nights.
 */
export function estimateAdvanceRate(nights: Night[], today: string): AdvanceRate | undefined {
  const from = addDays(today, -ADVANCE.lookbackDays);
  const recent = nights.filter((n) => n.main && n.wakeDate > from && n.wakeDate <= today).slice(-ADVANCE.windowNights);
  if (recent.length < ADVANCE.minNights) return undefined;
  const first = recent[0].wakeDate;
  // Minutes after noon, so a night either side of midnight stays on one line.
  const points = recent.map((n) => ({ x: daysBetween(first, n.wakeDate), y: normalizeMinutes(minutesOfDay(n.main!.sleepOnset) - 12 * 60) }));
  const slope = robustSlope(points);
  if (slope === undefined) return undefined;
  const observed = Math.round(-slope * 10) / 10;
  const w = recent.length / (recent.length + ADVANCE.priorNights);
  const base = BODY_CLOCK.rampMinPerNight;
  const ramp = Math.round(clamp(base + w * (observed - base), ADVANCE.minRampMin, ADVANCE.maxRampMin) / 5) * 5;
  return { observedMinPerNight: observed, nights: recent.length, rampMinPerNight: ramp, adapted: ramp !== base };
}

/** Clock minutes `t` is before `refMin` (positive = earlier), across midnight. */
export function minutesBeforeClock(t: number, refMin: number): number {
  return Math.round(clockDiff(minutesOfDay(t), refMin));
}
