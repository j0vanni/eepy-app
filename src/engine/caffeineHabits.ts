/**
 * Learns the user's usual morning drink from their caffeine log, so a forgotten coffee can be
 * logged at the right time with one tap (or from a nudge).
 */
import { CAFFEINE_PRESETS } from './caffeine';
import { addDays, atMinutes, circularMeanMinutes, dateKey, MINUTE, minutesOfDay } from './time';
import type { CaffeineDose } from './types';

export interface UsualCaffeine {
  /** Typical time of the first drink of the day, minutes after midnight (rounded to 5 min). */
  timeMin: number;
  mg: number;
  label: string;
  /** Share of recent days that had a morning drink (0–1). */
  share: number;
  /** Days that contributed. */
  days: number;
  /** Most recent day with a morning drink. */
  lastDate: string;
}

const LOOKBACK_DAYS = 21;
const MORNING_END_MIN = 13 * 60;
/** No "had your usual?" questions after this (minutes after midnight). */
const ASK_UNTIL_MIN = MORNING_END_MIN + 120;
/** marks key: the day the user said they skipped their usual drink. */
export const USUAL_SKIPPED_MARK = 'caffeine.usualSkipped';

/** The first-drink-of-the-day habit over the last three weeks (today excluded), if there is one. */
export function usualCaffeine(doses: CaffeineDose[], now: number): UsualCaffeine | undefined {
  const today = dateKey(now);
  const firstByDay = new Map<string, CaffeineDose>();
  for (const d of doses) {
    const key = dateKey(d.time);
    if (key >= today || key < addDays(today, -LOOKBACK_DAYS)) continue;
    if (minutesOfDay(d.time) >= MORNING_END_MIN) continue;
    const cur = firstByDay.get(key);
    if (!cur || d.time < cur.time) firstByDay.set(key, d);
  }
  const firsts = [...firstByDay.values()];
  if (firsts.length < 4) return undefined;
  const loggedDays = new Set(doses.map((d) => dateKey(d.time)).filter((k) => k < today && k >= addDays(today, -LOOKBACK_DAYS))).size;
  const mean = circularMeanMinutes(firsts.map((d) => minutesOfDay(d.time)));
  if (mean === undefined) return undefined;
  // Most common drink wins; ties go to the most recent.
  const counts = new Map<string, { n: number; last: number; mg: number }>();
  for (const d of firsts) {
    const k = `${d.label}|${d.mg}`;
    const c = counts.get(k) ?? { n: 0, last: 0, mg: d.mg };
    counts.set(k, { n: c.n + 1, last: Math.max(c.last, d.time), mg: d.mg });
  }
  const [bestKey, best] = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last)[0];
  return {
    timeMin: Math.round(mean / 5) * 5,
    mg: best.mg,
    label: bestKey.split('|')[0],
    share: firsts.length / Math.max(firsts.length, loggedDays),
    days: firsts.length,
    lastDate: [...firstByDay.keys()].sort().at(-1)!,
  };
}

/** True when today's usual drink is probably missing: nothing logged yet and it's well past the usual time. */
export function usualCaffeineMissing(doses: CaffeineDose[], now: number, usual: UsualCaffeine | undefined, graceMin = 60): boolean {
  if (!usual) return false;
  const today = dateKey(now);
  if (doses.some((d) => dateKey(d.time) === today)) return false;
  const nowMin = minutesOfDay(now);
  return nowMin >= usual.timeMin + graceMin && nowMin < ASK_UNTIL_MIN;
}

/** When to ask "had your usual?" on `date`, or undefined if that would be too late in the day. */
export function usualNudgeAt(usual: UsualCaffeine, date: string, graceMin = 60): number | undefined {
  const min = usual.timeMin + graceMin;
  return min < ASK_UNTIL_MIN ? atMinutes(date, min) : undefined;
}

/** Stable id for "logged my usual" on a day, so a repeated tap (or notification action) can't log it twice. */
export function usualDoseId(date: string): string {
  return `c-usual-${date}`;
}

/** A dose for today at the usual time (or `at`, if given) — never in the future. */
export function usualDose(usual: UsualCaffeine, now: number, at?: number): CaffeineDose {
  const time = Math.min(now, at ?? atMinutes(dateKey(now), usual.timeMin));
  return { id: usualDoseId(dateKey(time)), time, mg: usual.mg, label: usual.label };
}

/** "Now", "30 min ago" … presets for logging a drink after the fact. */
export function relativeTimeOptions(now: number): { label: string; time: number }[] {
  return [
    { label: 'Now', time: now },
    { label: '30 min ago', time: now - 30 * MINUTE },
    { label: '1 h ago', time: now - 60 * MINUTE },
    { label: '2 h ago', time: now - 120 * MINUTE },
  ];
}

export function presetFor(mg: number, label: string) {
  return CAFFEINE_PRESETS.find((p) => p.label === label) ?? CAFFEINE_PRESETS.find((p) => p.mg === mg);
}
