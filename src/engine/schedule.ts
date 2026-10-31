import { MORNING_STARTS_MIN, shortTitle } from './calendarEvents';
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
  /** How tomorrow's first calendar event shaped the plan (only when an event was passed in). */
  calendar?: CalendarAdjustment;
  /** Set when the user moved tonight's times ("Adjust tonight"): what the plan had been. */
  adjusted?: { plannedBedtime: number; plannedWake: number };
}

/** "I can't make it tonight": the user's own bedtime (and optionally wake-up) for one night. */
export interface TonightOverride {
  /** The morning this applies to (TonightPlan.wakeDate); ignored for any other night. */
  wakeDate: string;
  bedtime?: number;
  wake?: number;
}

export interface CalendarAdjustment {
  eventStart: number;
  eventTitle?: string;
  /** Minutes the user wants between waking and the event. */
  prepMin: number;
  /** Wake target and bedtime the plan would have used without the event. */
  usualWake: number;
  usualBedtime: number;
  /** The event moved the wake-up (and with it the bedtime) earlier. */
  drove: boolean;
  /** The final wake-up still leaves `prepMin` before the event (false when e.g. a CBT-I window wins). */
  fits: boolean;
  /** Expected sleep falls short of the need by this many minutes (0 = covered). */
  shortByMin: number;
  /** Rationale lines that exist because of the event. */
  reasons: string[];
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
  /** Start of tomorrow's first calendar event (epoch ms), if calendar access is on. */
  firstEventStart?: number;
  /** Title of that event, for the rationale. */
  firstEventTitle?: string;
  /** Minutes needed between waking and the first event (default 60). */
  firstEventPrepMin?: number;
  /** A prescribed sleep window (e.g. from the CBT-I programme) that overrides the computed one. */
  sleepWindow?: { bedMin: number; wakeMin: number; reason: string };
}

export function wakeTargetFor(profile: Profile, dateKey: string): { wakeMin: number; isWorkday: boolean } {
  const isWorkday = profile.workdays.includes(weekdayOfKey(dateKey));
  if (isWorkday) return { wakeMin: profile.workWakeMin, isWorkday };
  // Free days: sleep in by at most an hour to limit social jet lag, unless the user set a time.
  return { wakeMin: profile.freeWakeMin ?? profile.workWakeMin + 60, isWorkday };
}

/** Default minutes between waking and tomorrow's first event. */
export const DEFAULT_EVENT_PREP_MIN = 60;

/**
 * Latest wake-up (rounded down to 5 min) that leaves `prepMin` before an event, or undefined when
 * the event isn't a morning-or-later event on `wakeDate` (events before 03:00 belong to tonight).
 */
export function wakeForEvent(eventStart: number, prepMin: number, wakeDate: string): number | undefined {
  if (!Number.isFinite(eventStart)) return undefined;
  if (eventStart < atMinutes(wakeDate, MORNING_STARTS_MIN) || eventStart >= atMinutes(addDays(wakeDate, 1), 0)) return undefined;
  const step = 5 * MINUTE;
  return Math.floor((eventStart - prepMin * MINUTE) / step) * step;
}

/** "an hour", "2 hours", "45 min", "1h 30m". */
function prepPhrase(min: number): string {
  if (min === 60) return 'an hour';
  if (min > 0 && min % 60 === 0) return `${min / 60} hours`;
  if (min < 60) return `${min} min`;
  return formatDuration(min);
}

export function planTonight(input: PlanInput): TonightPlan {
  const { profile, needMin, debtMin, efficiency, latencyMin } = input;
  const wakeDate = addDays(input.today, 1);
  const { wakeMin, isWorkday } = wakeTargetFor(profile, wakeDate);
  const usualWake = atMinutes(wakeDate, wakeMin);
  // Tomorrow's first event can only bring the wake-up earlier, never later (free days keep their rule).
  const eventStart = input.firstEventStart;
  const prepMin = Math.round(clamp(input.firstEventPrepMin ?? DEFAULT_EVENT_PREP_MIN, 0, 6 * 60));
  const eventWake = eventStart !== undefined ? wakeForEvent(eventStart, prepMin, wakeDate) : undefined;
  const calendarDrove = eventWake !== undefined && eventWake < usualWake;
  const wake = calendarDrove ? eventWake : usualWake;
  const rationale: string[] = [];

  const eff = clamp(efficiency, 0.8, 0.97);
  let extra = 0;
  if (!profile.insomniaMode && debtMin >= 60) {
    extra = Math.min(60, input.payoffExtraMin ?? Math.round(debtMin / 6 / 5) * 5);
    rationale.push(`+${formatDuration(extra)} to pay down ${formatDuration(debtMin)} of sleep debt.`);
  }
  const inBedMin = Math.round(needMin / eff + latencyMin + extra);
  let bedtime = wake - inBedMin * MINUTE;
  const needBedtime = bedtime;
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
        // A one-off early event isn't a schedule change, so the calendar lines below explain this instead.
        if (!calendarDrove) {
          rationale.push(
            `That's ${formatDuration(earlierBy)} earlier than your body clock is used to, so aim for ${formatTime(bedtime)} tonight and move earlier by 15–30 min each night.`,
          );
        }
      }
    }
  }

  let calendar: CalendarAdjustment | undefined;
  const title = shortTitle(input.firstEventTitle);
  const what = eventStart !== undefined ? `First event at ${formatTime(eventStart)}${title ? ` (“${title}”)` : ''}` : '';
  if (eventStart !== undefined && eventWake !== undefined) {
    const usual = planTonight({ ...input, firstEventStart: undefined, sleepWindow: undefined });
    const reasons: string[] = [];
    let shortByMin = 0;
    if (calendarDrove) {
      if (profile.insomniaMode) {
        // CBT-I: going to bed early to make up for an early start mostly means lying awake.
        bedtime = Math.max(bedtime, usual.bedtime);
      } else if (input.habitualOnsetMin === undefined && bedtime < usual.bedtime - 90 * MINUTE) {
        // No body-clock data yet: don't plan lights-out more than 90 min before the usual bedtime.
        bedtime = usual.bedtime - 90 * MINUTE;
        gradual = true;
      }
      reasons.push(`${what} — waking ${formatTime(wake)} to have ${prepPhrase(prepMin)} before it.`);
      const expectedSleep = Math.max(0, (wake - bedtime) / MINUTE - latencyMin) * eff;
      const shortBy = Math.round(needMin - expectedSleep);
      const earlier = Math.round((usual.bedtime - bedtime) / MINUTE);
      const moved = earlier >= 10 ? ` (${formatDuration(earlier)} earlier than usual)` : '';
      if (shortBy > 10) {
        shortByMin = shortBy;
        const why = profile.insomniaMode
          ? `Keeping your usual ${formatTime(bedtime)} lights-out — going to bed early to make up for it tends to mean lying awake.`
          : earlier < 10
            ? `Lights out stays at ${formatTime(bedtime)} — much earlier and your body clock is unlikely to let you fall asleep.`
            : `Your full need would mean lights out at ${formatTime(needBedtime)}, too early for your body clock to fall asleep, so aim for ${formatTime(bedtime)}${moved}.`;
        reasons.push(`${why} That's about ${formatDuration(expectedSleep)} of sleep, ${formatDuration(shortBy)} short of your need — one short night is fine; get daylight soon after you wake.`);
      } else {
        reasons.push(`Lights out at ${formatTime(bedtime)}${moved} still covers your sleep need.`);
      }
      rationale.unshift(reasons[0]);
      rationale.push(reasons[1]);
    }
    calendar = {
      eventStart,
      eventTitle: title,
      prepMin,
      usualWake,
      usualBedtime: usual.bedtime,
      drove: calendarDrove,
      fits: true,
      shortByMin,
      reasons,
    };
  }

  let finalWake = wake;
  if (input.sleepWindow) {
    // A prescribed window (CBT-I) wins over everything computed above.
    finalWake = atMinutes(wakeDate, input.sleepWindow.wakeMin);
    const bedDate = input.sleepWindow.bedMin >= 12 * 60 ? input.today : wakeDate;
    bedtime = atMinutes(bedDate, input.sleepWindow.bedMin);
    gradual = false;
    rationale.splice(0, rationale.length, input.sleepWindow.reason);
  }

  if (calendar) {
    const fits = finalWake + calendar.prepMin * MINUTE <= calendar.eventStart + MINUTE;
    if (input.sleepWindow) {
      // The prescribed window decided the wake-up; only warn if it leaves too little time.
      const reasons: string[] = [];
      if (!fits) {
        const gap = Math.round((calendar.eventStart - finalWake) / MINUTE);
        reasons.push(
          gap > 0
            ? `Heads-up: ${what} is only ${formatDuration(gap)} after this wake-up.`
            : `Heads-up: ${what} is before this wake-up — set a separate alarm.`,
        );
        rationale.push(reasons[0]);
      }
      calendar = { ...calendar, drove: false, shortByMin: 0, reasons, fits };
    } else {
      calendar.fits = fits;
    }
  }

  return {
    wakeDate,
    isWorkday,
    wake: finalWake,
    bedtime,
    windDownStart: bedtime - profile.windDownMin * MINUTE,
    lastMeal: bedtime - 3 * HOUR,
    lastExercise: bedtime - 2 * HOUR,
    inBedMin: Math.round((finalWake - bedtime) / MINUTE),
    extraForDebtMin: extra,
    gradual,
    rationale,
    ...(calendar ? { calendar } : {}),
  };
}

/** Minimum time between an adjusted bedtime and wake-up that still counts as a night. */
const MIN_ADJUSTED_NIGHT_MIN = 90;

/**
 * Applies the user's one-night adjustment to tonight's plan: bedtime (and with it wind-down, last
 * meal and exercise) and/or wake-up move; everything downstream — alarm, caffeine cut-off,
 * reminders, energy forecast — follows because it is computed from the adjusted plan. A stale
 * override (another night) or an impossible one (wake before bedtime) leaves the plan unchanged.
 */
export function applyTonightOverride(plan: TonightPlan, override: TonightOverride | undefined, windDownMin: number): TonightPlan {
  if (!override || override.wakeDate !== plan.wakeDate) return plan;
  const bedtime = override.bedtime ?? plan.bedtime;
  const wake = override.wake ?? plan.wake;
  if (wake - bedtime < MIN_ADJUSTED_NIGHT_MIN * MINUTE) return plan;
  if (bedtime === plan.bedtime && wake === plan.wake) return plan;
  const shift = bedtime - plan.bedtime;
  const note = [
    bedtime !== plan.bedtime ? `lights out ${formatTime(bedtime)} instead of ${formatTime(plan.bedtime)}` : '',
    wake !== plan.wake ? `up at ${formatTime(wake)} instead of ${formatTime(plan.wake)}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return {
    ...plan,
    bedtime,
    wake,
    windDownStart: bedtime - windDownMin * MINUTE,
    lastMeal: plan.lastMeal + shift,
    lastExercise: plan.lastExercise + shift,
    inBedMin: Math.round((wake - bedtime) / MINUTE),
    rationale: [`Adjusted for tonight: ${note}.`, ...plan.rationale],
    adjusted: { plannedBedtime: plan.bedtime, plannedWake: plan.wake },
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
