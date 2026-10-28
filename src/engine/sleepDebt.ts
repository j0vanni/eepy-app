import type { Night } from './sessions';
import { addDays } from './time';

export const DEBT_WINDOW_NIGHTS = 14;
/** Extra sleep beyond need that can count toward repaying debt, per night (minutes). */
const MAX_SURPLUS_PER_NIGHT = 120;

export type DebtCategory = 'none' | 'low' | 'moderate' | 'high' | 'severe';

export interface DebtNight {
  wakeDate: string;
  /** Total sleep (main + naps); null when no main sleep was recorded. */
  sleepMin: number | null;
  /** need − sleep (positive = deficit). */
  deltaMin: number | null;
  weight: number;
}

export interface PayoffPlan {
  extraMinPerNight: number;
  nights: number;
  alternatives: { extraMinPerNight: number; nights: number }[];
}

export interface SleepDebtResult {
  debtMin: number;
  category: DebtCategory;
  nights: DebtNight[];
  /** Fraction of the window with data. */
  coverage: number;
  /** Debt change over the last 7 days (positive = growing). */
  trendMin?: number;
  payoff?: PayoffPlan;
}

/** Recent nights count more: weight 1.0 for last night down to 0.35 two weeks ago. */
export function nightWeight(index: number): number {
  return 1 - index / 20;
}

export function debtCategory(debtMin: number): DebtCategory {
  const h = debtMin / 60;
  if (h < 0.5) return 'none';
  if (h < 2) return 'low';
  if (h < 5) return 'moderate';
  if (h < 10) return 'high';
  return 'severe';
}

type NightLookup = Map<string, { totalSleepMin: number; hasMain: boolean }>;

function lookup(nights: Night[]): NightLookup {
  const m: NightLookup = new Map();
  for (const n of nights) m.set(n.wakeDate, { totalSleepMin: n.totalSleepMin, hasMain: !!n.main });
  return m;
}

function debtFromLookup(map: NightLookup, needMin: number, asOfDate: string) {
  const rows: DebtNight[] = [];
  let debt = 0;
  let present = 0;
  for (let i = 0; i < DEBT_WINDOW_NIGHTS; i++) {
    const wakeDate = addDays(asOfDate, -i);
    const n = map.get(wakeDate);
    const weight = nightWeight(i);
    if (!n || !n.hasMain) {
      rows.push({ wakeDate, sleepMin: null, deltaMin: null, weight });
      continue;
    }
    present++;
    const delta = Math.max(-MAX_SURPLUS_PER_NIGHT, needMin - n.totalSleepMin);
    debt += weight * delta;
    rows.push({ wakeDate, sleepMin: n.totalSleepMin, deltaMin: delta, weight });
  }
  return { debtMin: Math.max(0, debt), rows, coverage: present / DEBT_WINDOW_NIGHTS };
}

/** Sleep debt as of the morning of `asOfDate` (includes the night that ended that morning). */
export function computeSleepDebt(nights: Night[], needMin: number, asOfDate: string): SleepDebtResult {
  const map = lookup(nights);
  const now = debtFromLookup(map, needMin, asOfDate);
  const weekAgo = debtFromLookup(map, needMin, addDays(asOfDate, -7));
  return {
    debtMin: now.debtMin,
    category: debtCategory(now.debtMin),
    nights: now.rows,
    coverage: now.coverage,
    trendMin: weekAgo.coverage > 0.3 ? now.debtMin - weekAgo.debtMin : undefined,
    payoff: planPayoff(map, needMin, asOfDate, now.debtMin),
  };
}

/** Simulates future nights at need + extra to find how fast the debt gets back under an hour. */
function planPayoff(map: NightLookup, needMin: number, asOfDate: string, debtMin: number): PayoffPlan | undefined {
  if (debtMin < 60) return undefined;
  const options = [20, 30, 45, 60, 90];
  const alternatives = options.map((extra) => {
    const sim: NightLookup = new Map(map);
    for (let k = 1; k <= 21; k++) {
      const d = addDays(asOfDate, k);
      sim.set(d, { totalSleepMin: needMin + extra, hasMain: true });
      if (debtFromLookup(sim, needMin, d).debtMin < 60) return { extraMinPerNight: extra, nights: k };
    }
    return { extraMinPerNight: extra, nights: 22 };
  });
  const pick = alternatives.find((a) => a.nights <= 7) ?? alternatives[alternatives.length - 1];
  return { ...pick, alternatives };
}

/** Debt as of an arbitrary morning (used by the sleep-need estimator's debt correction). */
export function debtOnDate(nights: Night[], needMin: number, asOfDate: string): number {
  return debtFromLookup(lookup(nights), needMin, asOfDate).debtMin;
}
