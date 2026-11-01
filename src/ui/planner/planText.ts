/**
 * Plain-language text for the Planner and the month calendar ("Thursday: lights out 11:05 PM →
 * alarm 6:05 AM · 7h 10m sleep"). Pure: no React, so it is unit-tested.
 */
import { addDays, formatDuration, formatTime, getClockFormat, weekdayOfKey } from '../../engine/time';
import type { UpcomingNight } from '../../engine/weekPlan';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "6:30a" (12-hour) or "06:30" (24-hour), for small calendar cells and the week strip. */
export function compactTime(t: number): string {
  const s = formatTime(t);
  // formatClock puts a no-break space before AM/PM; \s matches it.
  return getClockFormat() === '12h' ? s.replace(/\s(AM|PM)$/, (_, p: string) => p[0].toLowerCase()) : s;
}

/** How a coming morning wakes you: the usual alarm, a time you set, a free day (no alarm), or a skipped alarm. */
export type MorningKind = 'alarm' | 'set' | 'free' | 'skipped';

export function morningKind(n: Pick<UpcomingNight, 'wakeDate' | 'noAlarm' | 'custom'>, skippedDate?: string): MorningKind {
  if (n.noAlarm) return 'free';
  if (skippedDate !== undefined && skippedDate === n.wakeDate) return 'skipped';
  return n.custom ? 'set' : 'alarm';
}

/** The night before a morning: "Wednesday night". */
export function nightBefore(wakeDate: string): string {
  return `${DAY_NAMES[weekdayOfKey(addDays(wakeDate, -1))]} night`;
}

/** "Lights out 11:05 PM → alarm 6:05 AM" (or "→ no alarm, up around 8:00 AM" / "→ alarm skipped"). */
export function planLine(n: Pick<UpcomingNight, 'bedtime' | 'wake' | 'alarm' | 'twoStep'>, kind: MorningKind): string {
  const bed = `Lights out ${formatTime(n.bedtime)}`;
  if (kind === 'free') return `${bed} → no alarm, up around ${formatTime(n.wake)}`;
  if (kind === 'skipped') return `${bed} → alarm skipped, sleep in`;
  if (n.twoStep) return `${bed} → routine ${formatTime(n.alarm ?? n.twoStep.firstWake)} → back to sleep → up ${formatTime(n.wake)}`;
  return `${bed} → alarm ${formatTime(n.alarm ?? n.wake)}`;
}

/** "Thursday: lights out 11:05 PM → alarm 6:05 AM · 7h 10m sleep". */
export function planSentence(n: Pick<UpcomingNight, 'wakeDate' | 'bedtime' | 'wake' | 'alarm' | 'sleepMin' | 'twoStep'>, kind: MorningKind): string {
  const line = planLine(n, kind);
  return `${DAY_NAMES[weekdayOfKey(n.wakeDate)]}: ${line.charAt(0).toLowerCase()}${line.slice(1)} · ${formatDuration(n.sleepMin)} sleep`;
}

/** One line under the wake-up choice, so each option says what it does. */
export function wakeChoiceHint(mode: 'usual' | 'custom' | 'free', usual: { wakeMin: number; isWorkday: boolean }, usualLabel: string, freeLabel: string): string {
  if (mode === 'custom') return 'For a morning you must be up at a set time — work, a flight, an appointment.';
  if (mode === 'free') return `No alarm that morning — sleep in, up around ${freeLabel}.`;
  return usual.isWorkday
    ? `Your usual workday alarm, ${usualLabel}. Change it under "Your usual week".`
    : `Not a workday: the alarm rings later, at ${usualLabel}. Change it under "Your usual week".`;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}
