/**
 * The next two weeks of nights, for the calendar and the recovery plan.
 *
 * Each night is planned by the same planner as tonight (schedule.planTonight): wake-up from the
 * weekly pattern or the calendar (Profile.wakePlan), bedtime from your sleep need, efficiency and
 * time to fall asleep, held back when it would be far earlier than your body clock allows. While
 * there is sleep debt each night gets a little extra — spread over several nights (at most +30
 * min a night) rather than one big catch-up ("recovery autopilot"). Before an early morning, the nights before it move earlier
 * gradually (at most 45 min a night), because the body clock can't jump earlier in one go.
 * Tonight (index 0) comes from the full planner in schedule.ts.
 */
import { smartAlarm, TonightPlan } from './schedule';
import { addDays, clamp, formatDuration, formatTime, MINUTE, startOfDateKey, weekdayOfKey } from './time';
import type { Profile } from './types';

/** How much earlier one night may be than the next (minutes): the body clock advances slowly. */
export const MAX_ADVANCE_PER_NIGHT_MIN = 45;
/** Recovery: at most this much extra time in bed per night while paying back debt. */
export const MAX_RECOVERY_EXTRA_MIN = 30;

export interface UpcomingNight {
  /** The morning this night ends. */
  wakeDate: string;
  wake: number;
  bedtime: number;
  windDownStart: number;
  /** Cycle-timed alarm; undefined on a calendar free day. */
  alarm?: number;
  cycles?: number;
  /** Expected sleep if the plan is followed. */
  sleepMin: number;
  isWorkday: boolean;
  /** Wake-up set for this date in the calendar. */
  custom: boolean;
  noAlarm: boolean;
  /** Extra time in bed for sleep debt. */
  extraForDebtMin: number;
  /** Moved earlier to ease into an early morning on `preShiftFor`. */
  preShiftMin: number;
  preShiftFor?: string;
  /** Projected sleep debt the morning after (approximate: assumes the plan is followed). */
  debtAfterMin: number;
}

export interface UpcomingInput {
  /** Tonight's plan (night 0). */
  first: TonightPlan;
  /**
   * The full nightly planner (schedule.planTonight) for the night before `wakeDate`, given the
   * sleep debt expected by then and the extra minutes to pay back per night.
   */
  planNight: (wakeDate: string, debtMin: number, payoffExtraMin: number) => TonightPlan;
  profile: Profile;
  needMin: number;
  latencyMin: number;
  efficiency: number;
  cycleMin: number;
  debtMin: number;
  days: number;
  /** Keep night 0 exactly as given (e.g. the user adjusted tonight). */
  lockFirst?: boolean;
  /** A fixed sleep window (CBT-I): no easing into early mornings. */
  fixedWindow?: boolean;
}

/** Extra minutes in bed for a night, from the debt still left (none under 30 min of debt). */
export function recoveryExtraMin(debtMin: number): number {
  if (debtMin < 30) return 0;
  return clamp(Math.round(debtMin / 4 / 5) * 5, 10, MAX_RECOVERY_EXTRA_MIN);
}

export function planUpcomingNights(input: UpcomingInput): UpcomingNight[] {
  const { first, profile, needMin, latencyMin, cycleMin } = input;
  const eff = clamp(input.efficiency, 0.8, 0.97);
  const days = Math.max(1, input.days);
  const sleepOf = (bed: number, wake: number) => Math.max(0, Math.round(((wake - bed) / MINUTE - latencyMin) * eff));

  // 1) Wake-ups and need-based bedtimes, paying debt back gradually.
  const nights: UpcomingNight[] = [];
  /** Nights the planner already held later because lights-out would be too early for the body clock. */
  const heldBack: boolean[] = [];
  let debt = input.debtMin;
  for (let k = 0; k < days; k++) {
    const wakeDate = addDays(first.wakeDate, k);
    let wake: number;
    let bedtime: number;
    let extra: number;
    let isWorkday: boolean;
    let noAlarm: boolean;
    let held: boolean;
    if (k === 0) {
      wake = first.wake;
      bedtime = first.bedtime;
      extra = first.extraForDebtMin;
      isWorkday = first.isWorkday;
      noAlarm = !!first.noAlarm;
      held = first.gradual;
    } else {
      const plan = input.planNight(wakeDate, debt, recoveryExtraMin(debt));
      wake = plan.wake;
      bedtime = plan.bedtime;
      extra = plan.extraForDebtMin;
      isWorkday = plan.isWorkday;
      noAlarm = !!plan.noAlarm;
      held = plan.gradual;
    }
    heldBack.push(held);
    debt = Math.max(0, debt - (sleepOf(bedtime, wake) - needMin));
    nights.push({
      wakeDate,
      wake,
      bedtime,
      windDownStart: bedtime,
      sleepMin: 0,
      isWorkday,
      custom: !!profile.wakePlan?.[wakeDate],
      noAlarm,
      extraForDebtMin: extra,
      preShiftMin: 0,
      debtAfterMin: 0,
    });
  }

  // 2) Ease into early mornings: no night may be more than MAX_ADVANCE earlier (clock time) than the one before.
  const clockOf = (n: UpcomingNight) => n.bedtime - startOfDateKey(n.wakeDate);
  for (let k = nights.length - 2; k >= (input.lockFirst ? 1 : 0) && !input.fixedWindow && !profile.insomniaMode; k--) {
    if (heldBack[k]) continue;
    const next = nights[k + 1];
    const limit = clockOf(next) + MAX_ADVANCE_PER_NIGHT_MIN * MINUTE;
    const over = clockOf(nights[k]) - limit;
    if (over > 0) {
      nights[k].bedtime -= over;
      nights[k].preShiftMin += Math.round(over / MINUTE);
      nights[k].preShiftFor = next.preShiftFor ?? next.wakeDate;
    }
  }

  // 3) Final times, alarms and the projected debt.
  debt = input.debtMin;
  for (const n of nights) {
    n.windDownStart = n.bedtime - profile.windDownMin * MINUTE;
    n.sleepMin = sleepOf(n.bedtime, n.wake);
    if (!n.noAlarm) {
      const a = smartAlarm(n.bedtime, n.wake, cycleMin, latencyMin);
      n.alarm = a.alarm;
      n.cycles = a.cycles;
    }
    debt = Math.max(0, debt - (n.sleepMin - needMin));
    n.debtAfterMin = Math.round(debt);
  }
  return nights;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Tonight's lights-out moved earlier to ease into an early morning later on (keeps its wake-up). */
export function preShiftTonight(plan: TonightPlan, minutes: number, forDate: string, forWake: number): TonightPlan {
  if (minutes < 5) return plan;
  const shift = minutes * MINUTE;
  return {
    ...plan,
    bedtime: plan.bedtime - shift,
    windDownStart: plan.windDownStart - shift,
    lastMeal: plan.lastMeal - shift,
    lastExercise: plan.lastExercise - shift,
    inBedMin: plan.inBedMin + minutes,
    rationale: [
      ...plan.rationale,
      `${formatDuration(minutes)} earlier than usual to ease into ${WEEKDAY[weekdayOfKey(forDate)]}'s ${formatTime(forWake)} start — the body clock moves earlier only gradually.`,
    ],
    preShift: { minutes, forDate },
  };
}
