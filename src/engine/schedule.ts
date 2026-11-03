import { MORNING_STARTS_MIN, shortTitle } from './calendarEvents';
import { addDays, atMinutes, clamp, clockDiff, formatDuration, formatTime, HOUR, MINUTE, minutesOfDay, normalizeMinutes, weekdayOfKey } from './time';
import { planTwoStep, retimeTwoStep, shiftTwoStep, TWO_STEP, twoStepFor, TwoStepPlan, twoStepRationale } from './twoStep';
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
  /** The morning is a free day in the calendar: no alarm. */
  noAlarm?: boolean;
  /** Lights-out was moved earlier to ease into an early morning later this week (calendar). */
  preShift?: { minutes: number; forDate: string };
  /**
   * Two-step morning (Profile.twoStepMorning, engine/twoStep.ts): a routine alarm before `wake`, back
   * to sleep, and `wake` as the final alarm. `inBedMin` includes the routine.
   */
  twoStep?: TwoStepPlan;
}

/** "I can't make it tonight": the user's own bedtime (and optionally wake-up) for one night. */
export interface TonightOverride {
  /** The morning this applies to (TonightPlan.wakeDate); ignored for any other night. */
  wakeDate: string;
  bedtime?: number;
  wake?: number;
  /** Set when one of "Options for tonight" was used (engine/planOptions.ts); the planner ignores it. */
  choice?: TonightChoice;
}

/** Which option from "Options for tonight" / "Still up?" is in use, so it can be shown and undone. */
export interface TonightChoice {
  /** PlanOption id. */
  id: string;
  title: string;
  /**
   * The morning's routine choice before the option switched the routine (`wakePlan[date].twoStep`;
   * null = what your week says). Only set when the option switched it.
   */
  routineBefore?: boolean | null;
  /** A nap planned for tomorrow: when to lie down. */
  napAt?: number;
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
  /**
   * When you've fallen asleep over the last few nights (minutes after midnight). Following the plan
   * moves this earlier faster than the four-week habit, so lights-out keeps stepping earlier.
   */
  recentOnsetMin?: number;
  /**
   * Nights from tonight to the night planned (0 = tonight). Coming nights assume the earlier
   * lights-out is kept, so each one steps `rampMinPerNight` earlier.
   */
  rampNights?: number;
  /**
   * How much earlier each coming night is assumed to be (default BODY_CLOCK.rampMinPerNight). The
   * analysis passes what your sleep onset has actually done lately (adherence.estimateAdvanceRate).
   */
  rampMinPerNight?: number;
  /** Start of tomorrow's first calendar event (epoch ms), if calendar access is on. */
  firstEventStart?: number;
  /** Title of that event, for the rationale. */
  firstEventTitle?: string;
  /** Minutes needed between waking and the first event (default 60). */
  firstEventPrepMin?: number;
  /** A prescribed sleep window (e.g. from the CBT-I programme) that overrides the computed one. */
  sleepWindow?: { bedMin: number; wakeMin: number; reason: string };
}

export interface WakeTarget {
  wakeMin: number;
  /** A morning with a fixed wake-up (a workday, or a time set in the calendar). */
  isWorkday: boolean;
  /** Set for this date in the calendar. */
  custom?: boolean;
  /** Calendar free day: no alarm that morning. */
  noAlarm?: boolean;
}

export function wakeTargetFor(profile: Profile, dateKey: string): WakeTarget {
  const plan = profile.wakePlan?.[dateKey];
  if (plan?.wakeMin !== undefined) return { wakeMin: plan.wakeMin, isWorkday: true, custom: true };
  const freeWakeMin = profile.freeWakeMin ?? profile.workWakeMin + 60;
  if (plan?.free) return { wakeMin: freeWakeMin, isWorkday: false, custom: true, noAlarm: true };
  const weekday = weekdayOfKey(dateKey);
  const isWorkday = profile.workdays.includes(weekday);
  // A time of your own for this weekday (e.g. Tuesdays 7:30) beats the workday / other-day time.
  const own = profile.dayWake?.[weekday];
  if (own !== undefined) return { wakeMin: own, isWorkday };
  if (isWorkday) return { wakeMin: profile.workWakeMin, isWorkday };
  // Free days: sleep in by at most an hour to limit social jet lag, unless the user set a time.
  return { wakeMin: freeWakeMin, isWorkday };
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

function debtLine(extra: number, debtMin: number): string {
  return `+${formatDuration(extra)} to pay down ${formatDuration(debtMin)} of sleep debt.`;
}

/** "an hour", "2 hours", "45 min", "1h 30m". */
function prepPhrase(min: number): string {
  if (min === 60) return 'an hour';
  if (min > 0 && min % 60 === 0) return `${min / 60} hours`;
  if (min < 60) return `${min} min`;
  return formatDuration(min);
}

/**
 * How far ahead of the body clock lights-out may be planned. Lying down deep in the evening
 * wake-maintenance zone mostly means lying awake — but sleep debt builds sleep pressure that lets
 * you fall asleep sooner, and a fixed early alarm makes a 4-hour night the worse outcome.
 */
export const BODY_CLOCK = {
  /** Lights-out at most this long before when you usually fall asleep, with no sleep debt … */
  baseAdvanceMin: 60,
  /** … plus one minute per this many minutes of sleep debt … */
  debtMinPerMin: 3,
  /** … up to this much. */
  maxAdvanceMin: 120,
  /** Each coming night is assumed this much earlier than the one before (if you keep the plan). */
  rampMinPerNight: 30,
  /** On a morning with an alarm, never plan less sleep than this … */
  minSleepMin: 300,
  /** … unless that means lights-out more than this long before you usually fall asleep. */
  maxBeforeOnsetMin: 180,
  /** Holding lights-out later by less than this isn't worth it. */
  minHoldMin: 15,
} as const;

/** How far before your usual sleep onset lights-out may be planned, given the sleep debt. */
export function bodyClockAdvanceMin(debtMin: number): number {
  return Math.round(clamp(BODY_CLOCK.baseAdvanceMin + Math.max(0, debtMin) / BODY_CLOCK.debtMinPerMin, BODY_CLOCK.baseAdvanceMin, BODY_CLOCK.maxAdvanceMin));
}

export function planTonight(input: PlanInput): TonightPlan {
  const { profile, needMin, debtMin, efficiency, latencyMin } = input;
  const wakeDate = addDays(input.today, 1);
  const target = wakeTargetFor(profile, wakeDate);
  const { wakeMin, isWorkday, noAlarm } = target;
  const usualWake = atMinutes(wakeDate, wakeMin);
  // Tomorrow's first event can only bring the wake-up earlier, never later (free days keep their rule).
  const eventStart = input.firstEventStart;
  const prepMin = Math.round(clamp(input.firstEventPrepMin ?? DEFAULT_EVENT_PREP_MIN, 0, 6 * 60));
  const eventWake = eventStart !== undefined ? wakeForEvent(eventStart, prepMin, wakeDate) : undefined;
  const calendarDrove = eventWake !== undefined && eventWake < usualWake;
  const wake = calendarDrove ? eventWake : usualWake;
  const rationale: string[] = [];
  // Two-step morning: the routine and falling back asleep are time awake inside the night, so the
  // two stretches of sleep together have to cover the need (a prescribed CBT-I window wins).
  const twoStepCfg = twoStepFor(profile, wakeDate, target);
  const awakeMin = twoStepCfg && !input.sleepWindow ? twoStepCfg.routineMin + twoStepCfg.fallBackAsleepMin : 0;

  const eff = clamp(efficiency, 0.8, 0.97);
  let extra = 0;
  if (!profile.insomniaMode && debtMin >= 60) {
    extra = Math.min(60, input.payoffExtraMin ?? Math.round(debtMin / 6 / 5) * 5);
    rationale.push(debtLine(extra, debtMin));
  }
  const inBedMin = Math.round(needMin / eff + latencyMin + extra + awakeMin);
  let bedtime = wake - inBedMin * MINUTE;
  const needBedtime = bedtime;
  const needLine = `${formatDuration(needMin)} sleep need, plus ${Math.round(inBedMin - needMin - latencyMin - extra - awakeMin)} min of normal night-time waking and ${Math.round(latencyMin)} min to fall asleep.`;
  rationale.unshift(needLine);
  if (profile.insomniaMode) rationale.push('Insomnia mode: no extra time in bed — a consolidated, consistent window works better.');

  let gradual = false;
  // When you usually fall asleep: the earlier of the four-week habit and the last few nights.
  const minutesBefore = (onsetMin: number | undefined) => (onsetMin === undefined ? undefined : -clockDiff(onsetMin, minutesOfDay(bedtime)));
  const behind = [minutesBefore(input.habitualOnsetMin), minutesBefore(input.recentOnsetMin)].filter((m): m is number => m !== undefined);
  if (behind.length) {
    // How much later than the need-based bedtime you usually fall asleep — less on coming nights,
    // which assume the earlier lights-out is kept.
    const earlierBy = Math.min(...behind);
    const ramp = input.rampMinPerNight ?? BODY_CLOCK.rampMinPerNight;
    const projectedBy = earlierBy - Math.max(0, input.rampNights ?? 0) * ramp;
    const advance = bodyClockAdvanceMin(debtMin);
    if (projectedBy > advance) {
      const onset = bedtime + projectedBy * MINUTE;
      let held = onset - advance * MINUTE;
      let floored = false;
      if (!noAlarm) {
        // An alarm morning: a 4-hour night does more harm than lying awake a while — plan at least
        // BODY_CLOCK.minSleepMin, but not hours before the body clock could possibly sleep.
        const minSleepBed = wake - Math.round(BODY_CLOCK.minSleepMin / eff + latencyMin + awakeMin) * MINUTE;
        const floor = Math.max(minSleepBed, onset - BODY_CLOCK.maxBeforeOnsetMin * MINUTE);
        if (floor < held) {
          held = floor;
          floored = true;
        }
      }
      // A few minutes either way isn't worth a "too big a jump" — keep the need-based bedtime.
      if (held - bedtime >= BODY_CLOCK.minHoldMin * MINUTE) {
        const needBed = bedtime;
        bedtime = held;
        gradual = true;
        // The debt line promised extra time in bed that the body clock won't allow tonight.
        if (extra > 0) rationale.splice(rationale.indexOf(debtLine(extra, debtMin)), 1);
        // A one-off early event isn't a schedule change, so the calendar lines below explain this instead.
        if (!calendarDrove) {
          const pressure = debtMin >= 60 ? ` With ${formatDuration(debtMin)} of sleep debt you'll get sleepy sooner than usual, so` : ' So';
          rationale.push(
            `Your need puts lights out at ${formatTime(needBed)}, but you've been falling asleep around ${formatTime(onset)} — too big a jump for one night.${pressure} aim for ${formatTime(bedtime)} tonight, then about ${ramp} min earlier each night until you're there.` +
              (floored ? ` (eepy doesn't plan a night with an alarm under ${formatDuration(BODY_CLOCK.minSleepMin)} of sleep.)` : '') +
              ' Not sleepy at lights-out? Keep the lights low and read until you are.',
            `What moves your body clock earlier: bright light soon after your ${formatTime(wake)} wake-up (outside, or by a window for 15–30 min), dim light in the evening, and not sleeping in more than an hour on days off.`,
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
      const expectedSleep = Math.max(0, (wake - bedtime) / MINUTE - latencyMin - awakeMin) * eff;
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

  let twoStep: TwoStepPlan | undefined;
  if (twoStepCfg && input.sleepWindow) {
    rationale.push('Two-step morning paused while the programme sets your sleep window — getting up and going back to bed works against it.');
  } else if (twoStepCfg) {
    const plan = planTwoStep(finalWake, twoStepCfg, eff);
    // Too little sleep before the routine alarm to be worth splitting the morning: one alarm at the wake-up.
    if (plan.firstWake - bedtime >= TWO_STEP.minMainSleepMin * MINUTE) {
      twoStep = plan;
      rationale.splice(rationale.indexOf(needLine) + 1, 0, twoStepRationale(plan, finalWake, gradual));
    }
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
    ...(noAlarm ? { noAlarm } : {}),
    ...(twoStep ? { twoStep } : {}),
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
  // A two-step morning keeps its gap before a moved wake-up; lights-out too close to the routine alarm drops it.
  const { twoStep: planned, ...rest } = plan;
  const twoStep = planned ? shiftTwoStep(planned, wake - plan.wake) : undefined;
  const keepTwoStep = twoStep && twoStep.firstWake - bedtime >= TWO_STEP.minMainSleepMin * MINUTE;
  const note = [
    bedtime !== plan.bedtime ? `lights out ${formatTime(bedtime)} instead of ${formatTime(plan.bedtime)}` : '',
    wake !== plan.wake ? `up at ${formatTime(wake)} instead of ${formatTime(plan.wake)}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return {
    ...rest,
    bedtime,
    wake,
    windDownStart: bedtime - windDownMin * MINUTE,
    lastMeal: plan.lastMeal + shift,
    lastExercise: plan.lastExercise + shift,
    inBedMin: Math.round((wake - bedtime) / MINUTE),
    rationale: [`Adjusted for tonight: ${note}.`, ...plan.rationale],
    adjusted: { plannedBedtime: plan.bedtime, plannedWake: plan.wake },
    ...(keepTwoStep ? { twoStep } : {}),
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

export type SmartAlarm = ReturnType<typeof smartAlarm>;

/**
 * Tonight's cycle-timed alarm from its lights-out — never later than the wake-up. On a two-step
 * morning that's the routine alarm before the first wake-up, and the routine is re-timed to it
 * (the final alarm rings at `wake`). The analysis and "I'm in bed" (inBed.ts) both use this, so a
 * tap's confirmation shows exactly the alarm that will ring.
 */
export function timeTonight(plan: TonightPlan, cycleMin: number, latencyMin: number, efficiency: number): { tonight: TonightPlan; alarm: SmartAlarm } {
  const alarm = smartAlarm(plan.bedtime, plan.twoStep?.firstWake ?? plan.wake, cycleMin, latencyMin);
  const tonight = plan.twoStep ? { ...plan, twoStep: retimeTwoStep(plan.twoStep, alarm.alarm, plan.wake, efficiency) } : plan;
  return { tonight, alarm };
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
