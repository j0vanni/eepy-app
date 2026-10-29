/**
 * When to ask "how alert are you right now?" (the alertness pings that feed calibration.ts).
 *
 * - The waking day runs from 1h after wake-up to 30 min before wind-down, split into thirds:
 *   morning, afternoon (where the post-lunch dip sits) and evening.
 * - Each ping lands at a random-but-stable time in the middle 70% of its third, seeded by the date,
 *   so re-planning during the day never moves it around (unless the wake time itself changes).
 * - 3 a day covers all thirds; 2 a day rotates the pair by date so every part of the day keeps getting
 *   sampled; 1 a day rotates through the thirds.
 * - A ping is skipped when a check-in happened in the 90 minutes before it.
 * - Taper rule: once the fit is well calibrated (≥ 40 check-ins over ≥ 14 days) pings drop to one a
 *   day, which is enough to keep the model current and keep measuring its accuracy.
 */
import { LEARNING } from './calibration';
import { rng } from './stats';
import { daysBetween, HOUR, MINUTE } from './time';

export type PingSlot = 'morning' | 'afternoon' | 'evening';

export const PING_SLOTS: PingSlot[] = ['morning', 'afternoon', 'evening'];

/** A recent check-in within this window before a ping makes the ping redundant. */
export const PING_QUIET_MS = 90 * MINUTE;

export interface PingTime {
  /** Stable id: `${date}-${slot}`. */
  id: string;
  date: string;
  slot: PingSlot;
  at: number;
}

/** Pings per day after applying the taper rule. */
export function pingsPerDay(preferred: number, calibration?: { n: number; days?: number }): number {
  if (calibration && calibration.n >= LEARNING.taperCheckins && (calibration.days ?? 0) >= LEARNING.taperDays) return 1;
  return Math.max(0, Math.min(3, Math.round(preferred)));
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Which parts of the day get a ping on `date`. */
export function slotsForDay(date: string, count: number): PingSlot[] {
  if (count >= 3) return PING_SLOTS;
  const k = mod(daysBetween('2024-01-01', date), 3);
  if (count === 2) return ([['morning', 'afternoon'], ['afternoon', 'evening'], ['morning', 'evening']] as PingSlot[][])[k];
  if (count === 1) return [PING_SLOTS[k]];
  return [];
}

/** FNV-1a string hash, used to seed the per-day jitter. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface PingDayInput {
  date: string;
  /** Wake-up time that day (actual or planned). */
  wake: number;
  /** Start of that evening's wind-down. */
  windDown: number;
  count: number;
  /** Times of existing check-ins (any source). */
  checkinTimes?: number[];
}

export function planPingTimes(input: PingDayInput): PingTime[] {
  const start = input.wake + HOUR;
  const end = input.windDown - 30 * MINUTE;
  const span = end - start;
  if (span < 3 * HOUR || span > 20 * HOUR) return [];
  const third = span / 3;
  const rand = rng(hashString(`ping:${input.date}`));
  // Always draw all three so a slot's time doesn't depend on how many pings are wanted.
  const jitter = PING_SLOTS.map(() => rand());
  const out: PingTime[] = [];
  for (const slot of slotsForDay(input.date, input.count)) {
    const k = PING_SLOTS.indexOf(slot);
    const at = Math.round((start + k * third + (0.15 + 0.7 * jitter[k]) * third) / MINUTE) * MINUTE;
    if ((input.checkinTimes ?? []).some((t) => t <= at && at - t < PING_QUIET_MS)) continue;
    out.push({ id: `${input.date}-${slot}`, date: input.date, slot, at });
  }
  return out;
}
