import { HOUR, MINUTE } from './time';
import type { CaffeineDose } from './types';

export interface DrinkPreset {
  label: string;
  mg: number;
}

/** Common drinks, mg of caffeine per serving (typical values; brands vary a lot). */
export const CAFFEINE_PRESETS: DrinkPreset[] = [
  { label: 'Espresso shot', mg: 63 },
  { label: 'Coffee (8 oz / 240 ml)', mg: 95 },
  // ~1 rounded tsp of granules per cup; strength varies a lot with how much you use.
  { label: 'Instant coffee (8 oz)', mg: 62 },
  { label: 'Decaf coffee (8 oz)', mg: 3 },
  { label: 'Large coffee (16 oz)', mg: 190 },
  { label: 'Cold brew (16 oz)', mg: 200 },
  { label: 'Black tea', mg: 47 },
  { label: 'Green tea', mg: 28 },
  { label: 'Matcha', mg: 70 },
  { label: 'Cola (12 oz)', mg: 34 },
  { label: 'Energy drink (8 oz)', mg: 80 },
  { label: 'Energy drink (16 oz)', mg: 160 },
  { label: 'Pre-workout scoop', mg: 200 },
  { label: 'Dark chocolate (1 oz)', mg: 24 },
];

/** First-order absorption rate (1/h): peak blood level ~45–60 min after a drink. */
const KA = 4;

/**
 * Caffeine still in the body (mg) at time t, using a one-compartment model with first-order
 * absorption and elimination (half-life is personal: ~3h smokers, ~5h typical, 7h+ slow metabolisers).
 */
export function caffeineAt(doses: CaffeineDose[], t: number, halfLifeH: number): number {
  const ke = Math.LN2 / halfLifeH;
  let total = 0;
  for (const d of doses) {
    const dt = (t - d.time) / HOUR;
    if (dt <= 0) continue;
    total += ((d.mg * KA) / (KA - ke)) * (Math.exp(-ke * dt) - Math.exp(-KA * dt));
  }
  return total;
}

export function caffeineCurve(
  doses: CaffeineDose[],
  from: number,
  to: number,
  halfLifeH: number,
  stepMin = 15,
): { t: number; mg: number }[] {
  const out: { t: number; mg: number }[] = [];
  for (let t = from; t <= to; t += stepMin * MINUTE) out.push({ t, mg: caffeineAt(doses, t, halfLifeH) });
  return out;
}

/** Peak caffeine during the first 3 hours of the sleep period — what actually disturbs deep sleep. */
export function caffeineDuringEarlySleep(doses: CaffeineDose[], bedtime: number, halfLifeH: number): number {
  let peak = 0;
  for (let t = bedtime; t <= bedtime + 3 * HOUR; t += 15 * MINUTE) peak = Math.max(peak, caffeineAt(doses, t, halfLifeH));
  return peak;
}

export interface CaffeineCutoff {
  /** Latest time a standard drink keeps early-sleep caffeine under the limit; undefined if already over. */
  cutoff?: number;
  /** Projected early-sleep caffeine from what has already been logged. */
  atBedtimeMg: number;
  overLimit: boolean;
  doseMg: number;
}

export function caffeineCutoff(
  doses: CaffeineDose[],
  bedtime: number,
  halfLifeH: number,
  limitMg: number,
  doseMg = 95,
): CaffeineCutoff {
  const atBedtimeMg = caffeineDuringEarlySleep(doses, bedtime, halfLifeH);
  if (atBedtimeMg > limitMg) return { atBedtimeMg, overLimit: true, doseMg };
  // Walk back from bedtime until a hypothetical drink no longer pushes early-sleep caffeine over the limit.
  for (let t = bedtime; t >= bedtime - 24 * HOUR; t -= 5 * MINUTE) {
    const hypothetical: CaffeineDose = { id: 'x', time: t, mg: doseMg, label: '' };
    if (caffeineDuringEarlySleep([...doses, hypothetical], bedtime, halfLifeH) <= limitMg) {
      return { cutoff: t, atBedtimeMg, overLimit: false, doseMg };
    }
  }
  return { atBedtimeMg, overLimit: false, doseMg };
}

export const HALF_LIFE_OPTIONS = [
  { label: 'Fast (≈3h)', hours: 3, hint: 'Smokers and some people with a fast CYP1A2 gene variant.' },
  { label: 'Typical (≈5h)', hours: 5, hint: 'Population average for healthy adults.' },
  { label: 'Slow (≈7h)', hours: 7, hint: 'Slow metabolisers, hormonal contraceptives, late pregnancy, some medications.' },
];
