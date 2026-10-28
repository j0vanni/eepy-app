import { addDays, atMinutes, clamp, clockDiff, formatDuration, formatTime, HOUR, MINUTE, minutesOfDay, normalizeMinutes, weekdayOfKey } from './time';
import type { Profile } from './types';

export interface CycleOption {
  bedtime: number;
  wake: number;
  cycles: number;
  sleepMin: number;
  meetsNeed: boolean;
  recommended: boolean;
}

/** "I need to wake at X — when should I go to bed?" Options land on sleep-cycle boundaries. */
export function bedtimesForWake(wake: number, cycleMin: number, latencyMin: number, needMin: number): CycleOption[] {
  const opts: CycleOption[] = [];
  for (let cycles = 7; cycles >= 3; cycles--) {
    const sleepMin = cycles * cycleMin;
    opts.push({
      bedtime: wake - (sleepMin + latencyMin) * MINUTE,
      wake,
      cycles,
      sleepMin,
      meetsNeed: sleepMin >= needMin - 15,
      recommended: false,
    });
  }
  markRecommended(opts, needMin);
  return opts;
}

/** "If I go to bed at X, when should I wake up?" */
export function wakesForBedtime(bedtime: number, cycleMin: number, latencyMin: number, needMin: number): CycleOption[] {
  const opts: CycleOption[] = [];
  for (let cycles = 3; cycles <= 7; cycles++) {
    const sleepMin = cycles * cycleMin;
    opts.push({
      bedtime,
      wake: bedtime + (sleepMin + latencyMin) * MINUTE,
      cycles,
      sleepMin,
      meetsNeed: sleepMin >= needMin - 15,
      recommended: false,
    });
  }
  markRecommended(opts, needMin);
  return opts;
}

function markRecommended(opts: CycleOption[], needMin: number) {
  // Smallest whole number of cycles that covers the need (within 15 min).
  const covering = opts.filter((o) => o.meetsNeed).sort((a, b) => a.cycles - b.cycles)[0];
  const pick = covering ?? opts.reduce((a, b) => (b.sleepMin > a.sleepMin ? b : a));
  pick.recommended = true;
}

export interface TonightPlan {
  /** The date whose morning this plan's wake-up belongs to. */
  wakeDate: string;
  isWorkday: boolean;
  wake: number;
  bedtime: number;
  windDownStart: number;
  lastMeal: number;
  lastExercise: number;
  inBedMin: number;
  extraForDebtMin: number;
  /** Bedtime was held back because it was much earlier than the body clock allows. */
  gradual: boolean;
  rationale: string[];
}

export interface PlanInput {
  profile: Profile;
  /** Today's date key; the plan covers tonight and tomorrow morning. */
  today: string;
  needMin: number;
  debtMin: number;
  payoffExtraMin?: number;
  efficiency: number;
  latencyMin: number;
  habitualOnsetMin?: number;
}

export function wakeTargetFor(profile: Profile, dateKey: string): { wakeMin: number; isWorkday: boolean } {
  const isWorkday = profile.workdays.includes(weekdayOfKey(dateKey));
  if (isWorkday) return { wakeMin: profile.workWakeMin, isWorkday };
  // Free days: sleep in by at most an hour to limit social jet lag, unless the user set a time.
  return { wakeMin: profile.freeWakeMin ?? profile.workWakeMin + 60, isWorkday };
}

export function planTonight(input: PlanInput): TonightPlan {
  const { profile, needMin, debtMin, efficiency, latencyMin } = input;
  const wakeDate = addDays(input.today, 1);
  const { wakeMin, isWorkday } = wakeTargetFor(profile, wakeDate);
  const wake = atMinutes(wakeDate, wakeMin);
  const rationale: string[] = [];

  const eff = clamp(efficiency, 0.8, 0.97);
  let extra = 0;
  if (!profile.insomniaMode && debtMin >= 60) {
    extra = Math.min(60, input.payoffExtraMin ?? Math.round(debtMin / 6 / 5) * 5);
    rationale.push(`+${formatDuration(extra)} to pay down ${formatDuration(debtMin)} of sleep debt.`);
  }
  const inBedMin = Math.round(needMin / eff + latencyMin + extra);
  let bedtime = wake - inBedMin * MINUTE;
  rationale.unshift(
    `${formatDuration(needMin)} sleep need, plus ${Math.round(inBedMin - needMin - latencyMin - extra)} min of normal night-time waking and ${Math.round(latencyMin)} min to fall asleep.`,
  );
  if (profile.insomniaMode) rationale.push('Insomnia mode: no extra time in bed — a consolidated, consistent window works better.');

  let gradual = false;
  if (input.habitualOnsetMin !== undefined) {
    const earlierBy = -clockDiff(input.habitualOnsetMin, minutesOfDay(bedtime));
    if (earlierBy > 75) {
      // Lying down deep in the evening wake-maintenance zone mostly means lying awake.
      // The habitual onset nearest the planned bedtime (it may fall after midnight).
      const habitualOnset = bedtime + earlierBy * MINUTE;
      const held = habitualOnset - 45 * MINUTE;
      if (held < wake - 4 * HOUR) {
        bedtime = held;
        gradual = true;
        rationale.push(
          `That's ${formatDuration(earlierBy)} earlier than your body clock is used to, so aim for ${formatTime(bedtime)} tonight and move earlier by 15–30 min each night.`,
        );
      }
    }
  }

  return {
    wakeDate,
    isWorkday,
    wake,
    bedtime,
    windDownStart: bedtime - profile.windDownMin * MINUTE,
    lastMeal: bedtime - 3 * HOUR,
    lastExercise: bedtime - 2 * HOUR,
    inBedMin: Math.round((wake - bedtime) / MINUTE),
    extraForDebtMin: extra,
    gradual,
    rationale,
  };
}

/**
 * Cycle-aware alarm: the latest predicted cycle boundary (light sleep) inside the wake window,
 * so the alarm rarely catches you in deep sleep.
 */
export function smartAlarm(
  bedtime: number,
  latestWake: number,
  cycleMin: number,
  latencyMin: number,
  windowMin = 30,
): { alarm: number; cycles: number; onBoundary: boolean } {
  const onset = bedtime + latencyMin * MINUTE;
  const earliest = latestWake - windowMin * MINUTE;
  let best: { alarm: number; cycles: number } | undefined;
  for (let k = 1; k <= 8; k++) {
    const t = onset + k * cycleMin * MINUTE;
    if (t >= earliest && t <= latestWake) best = { alarm: t, cycles: k };
  }
  if (best) return { ...best, onBoundary: true };
  return { alarm: latestWake, cycles: Math.floor((latestWake - onset) / (cycleMin * MINUTE)), onBoundary: false };
}

export interface ShiftDay {
  date: string;
  wakeMin: number;
  bedtimeMin: number;
  seekLight: { startMin: number; endMin: number };
  avoidLight: { startMin: number; endMin: number };
}

/**
 * Gradually moves the sleep schedule toward a new wake time. Advancing (earlier) is harder for the
 * body clock than delaying, so it uses smaller daily steps.
 */
export function shiftSchedule(
  currentWakeMin: number,
  targetWakeMin: number,
  needInBedMin: number,
  startDate: string,
): { direction: 'earlier' | 'later' | 'none'; days: ShiftDay[] } {
  const total = clockDiff(currentWakeMin, targetWakeMin);
  if (Math.abs(total) < 10) return { direction: 'none', days: [] };
  const direction = total < 0 ? 'earlier' : 'later';
  const step = direction === 'earlier' ? 20 : 30;
  const n = Math.ceil(Math.abs(total) / step);
  const days: ShiftDay[] = [];
  for (let i = 1; i <= n; i++) {
    const wakeMin = normalizeMinutes(currentWakeMin + Math.sign(total) * Math.min(Math.abs(total), i * step));
    const cbtMin = wakeMin - 120; // body-temperature minimum ≈ 2h before habitual wake
    days.push({
      date: addDays(startDate, i - 1),
      wakeMin,
      bedtimeMin: normalizeMinutes(wakeMin - needInBedMin),
      // Light after the temperature minimum advances the clock; light before it delays it.
      seekLight:
        direction === 'earlier'
          ? { startMin: normalizeMinutes(wakeMin), endMin: normalizeMinutes(wakeMin + 120) }
          : { startMin: normalizeMinutes(wakeMin - needInBedMin - 240), endMin: normalizeMinutes(wakeMin - needInBedMin - 60) },
      avoidLight:
        direction === 'earlier'
          ? { startMin: normalizeMinutes(wakeMin - needInBedMin - 180), endMin: normalizeMinutes(wakeMin - needInBedMin) }
          : { startMin: normalizeMinutes(cbtMin + 120), endMin: normalizeMinutes(cbtMin + 300) },
    });
  }
  return { direction, days };
}
