import type { Night, SessionMetrics } from './sessions';
import { addDays, clamp, daysBetween, MINUTE, startOfDateKey } from './time';
import { isSleepStage } from './types';

export interface RegularityResult {
  /** Sleep Regularity Index (Phillips et al. 2017), −100…100; higher = more regular. */
  sri?: number;
  label: 'very regular' | 'regular' | 'somewhat irregular' | 'irregular' | 'not enough data';
  dayPairs: number;
  /** Simple 0–100 consistency score from mid-sleep variability (for users without SRI coverage). */
  consistencyScore?: number;
}

/**
 * SRI: the probability of being in the same state (asleep/awake) at any two time points 24 h apart,
 * rescaled to −100…100. A day is considered observed when the nights on both sides were recorded.
 */
export function sleepRegularityIndex(
  metrics: SessionMetrics[],
  nights: Night[],
  fromDate: string,
  toDate: string,
  epochMin = 5,
): { sri?: number; dayPairs: number } {
  const recorded = new Set(nights.filter((n) => n.main).map((n) => n.wakeDate));
  const nDays = daysBetween(fromDate, toDate) + 1;
  if (nDays < 2) return { dayPairs: 0 };
  const epochs = Math.round(1440 / epochMin);
  const days: (Uint8Array | null)[] = [];
  for (let i = 0; i < nDays; i++) {
    const key = addDays(fromDate, i);
    days.push(recorded.has(key) && recorded.has(addDays(key, 1)) ? new Uint8Array(epochs) : null);
  }
  for (const m of metrics) {
    for (const seg of m.segments) {
      if (!isSleepStage(seg.stage)) continue;
      // Epoch midpoints covered by this segment.
      for (let t = seg.start; t < seg.end; t += epochMin * MINUTE) {
        const dayIdx = daysBetween(fromDate, keyOf(t));
        if (dayIdx < 0 || dayIdx >= nDays) continue;
        const arr = days[dayIdx];
        if (!arr) continue;
        const sinceMidnight = t - startOfDateKey(addDays(fromDate, dayIdx));
        const e = Math.floor(sinceMidnight / (epochMin * MINUTE));
        if (e >= 0 && e < epochs) arr[e] = 1;
      }
    }
  }
  let same = 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i + 1 < nDays; i++) {
    const a = days[i];
    const b = days[i + 1];
    if (!a || !b) continue;
    pairs++;
    for (let e = 0; e < epochs; e++) {
      total++;
      if (a[e] === b[e]) same++;
    }
  }
  if (pairs === 0) return { dayPairs: 0 };
  return { sri: -100 + (200 * same) / total, dayPairs: pairs };
}

function keyOf(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function regularityLabel(sri: number | undefined): RegularityResult['label'] {
  if (sri === undefined) return 'not enough data';
  if (sri >= 85) return 'very regular';
  if (sri >= 75) return 'regular';
  if (sri >= 60) return 'somewhat irregular';
  return 'irregular';
}

export function analyzeRegularity(
  metrics: SessionMetrics[],
  nights: Night[],
  asOfDate: string,
  midSleepSdMin: number | undefined,
  windowDays = 14,
): RegularityResult {
  const { sri, dayPairs } = sleepRegularityIndex(metrics, nights, addDays(asOfDate, -windowDays), addDays(asOfDate, -1));
  const usable = dayPairs >= 5 ? sri : undefined;
  return {
    sri: usable,
    label: regularityLabel(usable),
    dayPairs,
    consistencyScore: midSleepSdMin !== undefined ? Math.round(clamp(100 - (midSleepSdMin - 15) * 1.1, 0, 100)) : undefined,
  };
}
