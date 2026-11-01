/**
 * Two-step mornings: up early for a short routine (washing, moisturiser), back to bed, and up for
 * good at the day's normal wake-up — "wake at 5, face routine, back to sleep until 6:05".
 *
 * Planning (schedule.planTonight, weekPlan): total sleep = the main block (lights-out → first
 * wake-up) + the back-to-sleep stretch (routine done + a short time to fall back asleep → final
 * wake-up). The routine and falling back asleep are time awake, so lights-out moves earlier by
 * exactly that much and the two stretches together still cover the sleep need. The first alarm is
 * cycle-timed (schedule.smartAlarm, the 30 min before the first wake-up) so it catches light sleep;
 * the final alarm rings at the wake-up itself — after ~35 minutes of light, REM-ish sleep there is
 * no cycle to time.
 *
 * Which mornings: those with a fixed wake-up (a workday, or a time set in the calendar) on the
 * chosen days (default: your workdays). The gap between the two wake-ups (workday wake-up − first
 * wake-up) is kept before calendar wake-ups; free days never use it.
 *
 * Wake-up detection (wakeDetect.ts) treats the routine as a planned time awake: it isn't the final
 * wake-up as long as some sleep follows it, it doesn't count as waking in the night or as time
 * awake in bed, and with no sleep after it, it was the real wake-up.
 */
import { addDays, atMinutes, clamp, clockDiff, dateKey, formatClock, formatDuration, formatTime, MINUTE, minutesOfDay, weekdayOfKey } from './time';
import type { Profile, TwoStepMorning } from './types';

export const TWO_STEP = {
  /** Time to fall back asleep after the routine (awake, back in bed). */
  fallBackAsleepMin: 10,
  /** At least this much sleep must be left after the routine, or a second alarm isn't worth it. */
  minBackToSleepMin: 15,
  /** The first wake-up at most this long before the final one. */
  maxGapMin: 180,
  /** The first wake-up at least this long after lights-out (otherwise one alarm at the wake-up). */
  minMainSleepMin: 90,
  routineMin: { min: 5, max: 90 },
  /** Detection: the routine may start this long before the first wake-up (cycle-timed alarm window + slack). */
  detectBeforeMin: 45,
  /** … and end this long after it should have (snoozes, a slow start). */
  detectAfterMin: 30,
  /** Awake beyond routine + falling back asleep that still counts as part of the plan. */
  slackMin: 15,
  /** Sleep after the routine that means you went back to sleep (any stage — it's a short, light stretch). */
  backAsleepMin: 10,
} as const;

export const DEFAULT_TWO_STEP: TwoStepMorning = { enabled: false, firstWakeMin: 5 * 60, routineMin: 20 };

/** The setting with defaults filled in (on or off). */
export function twoStepSetting(profile: Pick<Profile, 'twoStepMorning'>): TwoStepMorning {
  return { ...DEFAULT_TWO_STEP, ...profile.twoStepMorning };
}

export interface TwoStepConfig {
  firstWakeMin: number;
  routineMin: number;
  fallBackAsleepMin: number;
  days: number[];
  /** Minutes from the first wake-up to the final one; kept before calendar wake-ups. */
  gapMin: number;
  since?: string;
}

export type TwoStepCheck = { ok: true; config: TwoStepConfig } | { ok: false; off: boolean; reason: string };

/** Validates the setting against the workday wake-up. */
export function checkTwoStep(profile: Pick<Profile, 'twoStepMorning' | 'workWakeMin' | 'workdays'>): TwoStepCheck {
  const s = twoStepSetting(profile);
  if (!s.enabled) return { ok: false, off: true, reason: 'Two-step mornings are off.' };
  const routineMin = Math.round(clamp(s.routineMin, TWO_STEP.routineMin.min, TWO_STEP.routineMin.max));
  const fallBackAsleepMin = TWO_STEP.fallBackAsleepMin;
  const gapMin = Math.round(clockDiff(s.firstWakeMin, profile.workWakeMin));
  const days = s.days ?? profile.workdays;
  if (gapMin <= 0) return { ok: false, off: false, reason: `The routine alarm has to be before your ${formatClock(profile.workWakeMin)} wake-up.` };
  if (gapMin > TWO_STEP.maxGapMin) {
    return { ok: false, off: false, reason: `That's ${formatDuration(gapMin)} before your ${formatClock(profile.workWakeMin)} wake-up — two-step mornings are for a short routine, at most 3 hours before.` };
  }
  const left = gapMin - routineMin - fallBackAsleepMin;
  if (left < TWO_STEP.minBackToSleepMin) {
    return {
      ok: false,
      off: false,
      reason: `Only ${Math.max(0, left)} min would be left to sleep after the routine before ${formatClock(profile.workWakeMin)} — set the routine alarm earlier or the routine shorter.`,
    };
  }
  if (days.length === 0) return { ok: false, off: false, reason: 'Pick at least one morning.' };
  return { ok: true, config: { firstWakeMin: s.firstWakeMin, routineMin, fallBackAsleepMin, days, gapMin, since: s.since } };
}

/** The setting when it's on and valid. */
export function twoStepConfig(profile: Pick<Profile, 'twoStepMorning' | 'workWakeMin' | 'workdays'>): TwoStepConfig | undefined {
  const c = checkTwoStep(profile);
  return c.ok ? c.config : undefined;
}

/** What wakeTargetFor (schedule.ts) says about a morning. */
export interface MorningTarget {
  wakeMin: number;
  isWorkday: boolean;
  noAlarm?: boolean;
}

/** The two-step setting for one morning, if that morning uses it: a fixed wake-up on one of its days. */
export function twoStepFor(profile: Pick<Profile, 'twoStepMorning' | 'workWakeMin' | 'workdays'>, wakeDate: string, target: MorningTarget): TwoStepConfig | undefined {
  const c = twoStepConfig(profile);
  if (!c || !target.isWorkday || target.noAlarm) return undefined;
  return c.days.includes(weekdayOfKey(wakeDate)) ? c : undefined;
}

/** A planned two-step morning (all times epoch ms); the final wake-up is the plan's `wake`. */
export interface TwoStepPlan {
  /** First wake-up target; the cycle-timed routine alarm rings in the 30 min before it. */
  firstWake: number;
  /** When the routine alarm rings: `firstWake` until the analysis times it to a sleep cycle. */
  firstAlarm: number;
  /** Routine done, back in bed. */
  routineEnd: number;
  /** Expected to be asleep again. */
  backToSleep: number;
  routineMin: number;
  fallBackAsleepMin: number;
  /** Planned time awake in the middle of the night: the routine + falling back asleep. */
  awakeMin: number;
  /** Expected sleep in the back-to-sleep stretch (backToSleep → final wake-up), minutes. */
  backToSleepMin: number;
}

const effOf = (efficiency: number) => clamp(efficiency, 0.8, 0.97);

/** The routine and the back-to-sleep stretch when the routine alarm rings at `firstAlarm`. */
export function retimeTwoStep(p: TwoStepPlan, firstAlarm: number, finalWake: number, efficiency: number): TwoStepPlan {
  const routineEnd = firstAlarm + p.routineMin * MINUTE;
  const backToSleep = routineEnd + p.fallBackAsleepMin * MINUTE;
  return { ...p, firstAlarm, routineEnd, backToSleep, backToSleepMin: Math.max(0, Math.round(((finalWake - backToSleep) / MINUTE) * effOf(efficiency))) };
}

/** The two-step morning before a final wake-up at `finalWake`. */
export function planTwoStep(finalWake: number, c: TwoStepConfig, efficiency: number): TwoStepPlan {
  const firstWake = finalWake - c.gapMin * MINUTE;
  const base: TwoStepPlan = {
    firstWake,
    firstAlarm: firstWake,
    routineEnd: firstWake,
    backToSleep: firstWake,
    routineMin: c.routineMin,
    fallBackAsleepMin: c.fallBackAsleepMin,
    awakeMin: c.routineMin + c.fallBackAsleepMin,
    backToSleepMin: 0,
  };
  return retimeTwoStep(base, firstWake, finalWake, efficiency);
}

/** The same morning moved by `deltaMs` (the wake-up moved for one night); the stretches keep their length. */
export function shiftTwoStep(p: TwoStepPlan, deltaMs: number): TwoStepPlan {
  if (deltaMs === 0) return p;
  return {
    ...p,
    firstWake: p.firstWake + deltaMs,
    firstAlarm: p.firstAlarm + deltaMs,
    routineEnd: p.routineEnd + deltaMs,
    backToSleep: p.backToSleep + deltaMs,
  };
}

export interface TwoStepSleep {
  /** Lights-out → routine alarm, minutes asleep. */
  mainMin: number;
  /** Back to sleep → final wake-up. */
  backMin: number;
  totalMin: number;
}

/** Expected sleep in each stretch if the night goes to plan. */
export function twoStepSleep(bedtime: number, p: TwoStepPlan, latencyMin: number, efficiency: number): TwoStepSleep {
  const mainMin = Math.max(0, Math.round(((p.firstAlarm - bedtime) / MINUTE - latencyMin) * effOf(efficiency)));
  return { mainMin, backMin: p.backToSleepMin, totalMin: mainMin + p.backToSleepMin };
}

/** The plan's rationale line. */
export function twoStepRationale(p: TwoStepPlan, finalWake: number): string {
  return (
    `Two-step morning: routine alarm by ${formatTime(p.firstWake)} (cycle-timed), back in bed ~${formatTime(p.routineEnd)} ` +
    `and asleep again ~${formatTime(p.backToSleep)} until ${formatTime(finalWake)}. Lights out ${p.awakeMin} min earlier so the two stretches ` +
    `still add up to your need — the ${p.routineMin}-min routine and falling back asleep are time awake.`
  );
}

/** "Lights out 23:05 → 04:47 routine alarm → back to sleep ~05:17 → up 06:05 · 7h 10m sleep" */
export function twoStepLine(night: { bedtime: number; wake: number; twoStep: TwoStepPlan }, latencyMin: number, efficiency: number): string {
  const p = night.twoStep;
  const sleep = twoStepSleep(night.bedtime, p, latencyMin, efficiency);
  return `Lights out ${formatTime(night.bedtime)} → ${formatTime(p.firstAlarm)} routine alarm → back to sleep ~${formatTime(p.backToSleep)} → up ${formatTime(night.wake)} · ${formatDuration(sleep.totalMin)} sleep`;
}

/** Where wake-up detection looks for the routine on one morning (wakeDetect.ts). */
export interface RoutineWindow {
  start: number;
  end: number;
  /** First and final wake-up targets of that morning. */
  firstWake: number;
  finalWake: number;
  routineMin: number;
  /** Awake minutes from the start of the routine that count as planned (routine + falling back asleep + slack). */
  allowanceMin: number;
}

/** The first morning a setting switched on at `now` applies to: this morning until noon, else tomorrow. */
export function twoStepSince(now: number): string {
  return minutesOfDay(now) < 12 * 60 ? dateKey(now) : addDays(dateKey(now), 1);
}

/**
 * The setting after switching it on or off at `now`. Switching on starts a new period (`since`);
 * switching off remembers the period that ends (`past`, up to and including this morning), so
 * those nights are still read as two-step mornings.
 */
export function switchTwoStep(s: TwoStepMorning, enabled: boolean, now: number): TwoStepMorning {
  if (enabled === s.enabled) return s;
  if (enabled) return { ...s, enabled, since: twoStepSince(now) };
  const until = addDays(dateKey(now), 1);
  const since = s.since;
  const past = since && since < until ? [...(s.past ?? []), [since, until] as [string, string]].slice(-12) : s.past;
  return { ...s, enabled, ...(past ? { past } : {}) };
}

/** Whether a morning falls in a period the setting was on (now, or before it was switched off). */
function wasOn(s: TwoStepMorning, wakeDate: string): boolean {
  if (s.enabled && (!s.since || wakeDate >= s.since)) return true;
  return (s.past ?? []).some(([a, b]) => wakeDate >= a && wakeDate < b);
}

/**
 * The routine window for a morning, if it was a two-step morning: on one of its days while the
 * setting was on (from `since`, or in a `past` period), with the current times.
 */
export function routineWindowFor(profile: Pick<Profile, 'twoStepMorning' | 'workWakeMin' | 'workdays'>, wakeDate: string, target: MorningTarget): RoutineWindow | undefined {
  const s = twoStepSetting(profile);
  if (!wasOn(s, wakeDate)) return undefined;
  const c = twoStepFor({ ...profile, twoStepMorning: { ...s, enabled: true } }, wakeDate, target);
  if (!c) return undefined;
  const finalWake = atMinutes(wakeDate, target.wakeMin);
  const firstWake = finalWake - c.gapMin * MINUTE;
  return {
    start: firstWake - TWO_STEP.detectBeforeMin * MINUTE,
    end: Math.min(firstWake + (c.routineMin + c.fallBackAsleepMin + TWO_STEP.detectAfterMin) * MINUTE, finalWake - 10 * MINUTE),
    firstWake,
    finalWake,
    routineMin: c.routineMin,
    allowanceMin: c.routineMin + c.fallBackAsleepMin + TWO_STEP.slackMin,
  };
}
