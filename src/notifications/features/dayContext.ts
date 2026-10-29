/**
 * Today's context for adaptive notifications: naps taken, a running nap timer, caffeine logged,
 * and the lights-out time after accounting for naps. Pure — shared by reminders and the live
 * wind-down so both agree on when "lights out" is.
 */
import { bedtimeDelayMin, Interval } from '../../engine/alertness';
import type { Analysis } from '../../engine/analysis';
import { HOUR, MINUTE, startOfDateKey } from '../../engine/time';
import type { AppState } from '../../state/store';

/** Naps never move the lights-out reminder by more than this. */
export const MAX_NAP_SHIFT_MIN = 30;
/** A running nap timer still counts as "napping" this long after its alarm. */
const NAP_TIMER_GRACE = 15 * MINUTE;

export interface DayContext {
  adaptive: boolean;
  /** Minutes asleep in naps that ended today. */
  napsTodayMin: number;
  /** Interval covered by a nap timer that is still running (start → alarm + grace). */
  napTimer?: Interval;
  /** Caffeine logged since the start of today (mg). */
  caffeineTodayMg: number;
  /** Projected caffeine in the first hours of sleep tonight from what's been logged (mg). */
  caffeineAtBedtimeMg: number;
  /** Enough caffeine logged that it will still be noticeable at bedtime. */
  lateCaffeine: boolean;
  /** How far today's naps push sleepiness back tonight (minutes, rounded to 5, capped). */
  napShiftMin: number;
  /** The engine's planned bedtime. */
  bedtime: number;
  /** When reminders say "lights out": the bedtime, moved later after a long nap (adaptive only). */
  lightsOut: number;
  highDebt: boolean;
}

function todaysNaps(a: Analysis, now: number) {
  return (a.nights.find((n) => n.wakeDate === a.day)?.naps ?? []).filter((m) => m.end <= now);
}

/** Minutes by which today's naps delay tonight's sleepiness (two-process model, same as the nap coach). */
export function napBedtimeShiftMin(a: Analysis, now: number): number {
  const naps = todaysNaps(a, now).map((m) => ({ start: m.sleepOnset, end: m.finalWake }));
  if (naps.length === 0) return 0;
  const overlapsNap = (iv: Interval) => naps.some((n) => iv.start < n.end && iv.end > n.start);
  let base = a.sleeps.filter((iv) => !overlapsNap(iv));
  // A rested schedule: only pressure a nap removes below the normal bedtime level delays sleep.
  const reference: Interval[] = [];
  for (let d = 0; d <= 4; d++) {
    const w = a.wakeTime - d * 24 * HOUR;
    reference.push({ start: w - a.need.needMin * MINUTE, end: w });
  }
  let shift = 0;
  for (const n of naps) {
    shift += bedtimeDelayMin(base, n, a.tonight.bedtime, reference);
    base = [...base, n];
  }
  return shift;
}

export function dayContext(a: Analysis, state: AppState, now: number): DayContext {
  const adaptive = state.settings.notifications.adaptiveReminders;
  const dayStart = startOfDateKey(a.day);
  const caffeineTodayMg = state.caffeine.filter((d) => d.time >= dayStart && d.time <= now).reduce((s, d) => s + d.mg, 0);
  const limit = state.profile.caffeineBedtimeLimitMg;
  const caffeineAtBedtimeMg = a.caffeine.cutoff.atBedtimeMg;
  const timer = state.settings.napTimer;
  const napTimer = timer && timer.alarmAt + NAP_TIMER_GRACE > now ? { start: timer.start, end: timer.alarmAt + NAP_TIMER_GRACE } : undefined;
  const rawShift = adaptive ? napBedtimeShiftMin(a, now) : 0;
  const napShiftMin = rawShift < 10 ? 0 : Math.min(MAX_NAP_SHIFT_MIN, Math.round(rawShift / 5) * 5);
  const bedtime = a.tonight.bedtime;
  return {
    adaptive,
    napsTodayMin: Math.round(todaysNaps(a, now).reduce((s, m) => s + m.totalSleepMin, 0)),
    napTimer,
    caffeineTodayMg,
    caffeineAtBedtimeMg,
    lateCaffeine: a.caffeine.cutoff.overLimit || caffeineAtBedtimeMg >= limit * 0.6,
    napShiftMin,
    bedtime,
    lightsOut: bedtime + napShiftMin * MINUTE,
    highDebt: a.debt.category === 'high' || a.debt.category === 'severe',
  };
}

/** True when a running nap timer covers time `t` (adaptive mode suppresses reminders then). */
export function duringNap(ctx: DayContext, t: number): boolean {
  return !!ctx.napTimer && t >= ctx.napTimer.start && t <= ctx.napTimer.end;
}
