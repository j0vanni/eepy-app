/**
 * Recovery early warning: resting HR up + HRV down + breathing rate up for 2+ nights
 * vs. the personal baseline suggests illness, overreaching or a lot of stress.
 *
 * Rules (per signal, each night compared with the 30 nights before the recent window):
 * - heart rate (sleeping minimum, else daily resting HR) ≥ baseline + max(4 bpm, 1.5 SD)
 * - ln(HRV) ≤ baseline − max(1 SD, 0.1)   (0.1 in ln units ≈ a 10% drop)
 * - respiratory rate ≥ baseline + max(1 breath/min, 1.5 SD)
 * A signal is "off" when it's off on ≥ 2 of the last 3 nights. Two signals off → 'watch',
 * all three → 'warning'. The copy is deliberately non-diagnostic.
 */
import type { Night } from './sessions';
import { mean, sd } from './stats';
import { addDays, daysBetween } from './time';
import type { DailyStats, NightVitals } from './types';

export type RecoverySignalKey = 'hr' | 'hrv' | 'resp';

export interface RecoverySignal {
  key: RecoverySignalKey;
  label: string;
  /** Personal baseline in display units (bpm, ms, breaths/min). */
  baseline: number;
  /** Average over the off nights. */
  recent: number;
  /** Change vs baseline in display units: bpm, percent (HRV) or breaths/min. */
  delta: number;
  /** Display-ready change, e.g. "+6 bpm", "−25%", "+1.4/min". */
  change: string;
  nightsOff: number;
  nightsChecked: number;
  off: boolean;
}

export interface RecoveryAlert {
  level: 'watch' | 'warning';
  title: string;
  detail: string;
  /** Wake dates that triggered the alert. */
  nights: string[];
  signals?: RecoverySignal[];
  advice?: string[];
}

const BASELINE_DAYS = 30;
const MIN_BASELINE = 7;
const RECENT_NIGHTS = 3;
const MIN_OFF = 2;

interface SeriesDef {
  key: RecoverySignalKey;
  label: string;
  /** Value for a night (already transformed: ln for HRV). */
  get: (n: Night) => number | undefined;
  isOff: (v: number, base: { mean: number; sd: number }) => boolean;
  delta: (recent: number, baseline: number) => number;
  unit: string;
  digits: number;
  display: (v: number) => number;
}

function pickSeries(
  nights: Night[],
  primary: (n: Night) => number | undefined,
  fallback: (n: Night) => number | undefined,
): (n: Night) => number | undefined {
  const count = (f: (n: Night) => number | undefined) => nights.filter((n) => f(n) !== undefined).length;
  return count(primary) >= count(fallback) ? primary : fallback;
}

const positive = (x: number | undefined) => (x !== undefined && Number.isFinite(x) && x > 0 ? x : undefined);
const fmtSigned = (x: number, digits = 0) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;

export function detectRecoveryAlert(input: {
  nights: Night[];
  vitals: Record<string, NightVitals>;
  daily: Record<string, DailyStats>;
  asOfDate: string;
}): RecoveryAlert | undefined {
  const { vitals, daily, asOfDate } = input;
  const withMain = input.nights.filter((n) => n.main && n.wakeDate <= asOfDate);
  // The last 3 recorded nights, as long as they're recent (within the last 4 days).
  const recent = withMain.filter((n) => daysBetween(n.wakeDate, asOfDate) <= RECENT_NIGHTS).slice(-RECENT_NIGHTS);
  if (recent.length < MIN_OFF) return undefined;
  const firstRecent = recent[0].wakeDate;
  const base = withMain.filter((n) => n.wakeDate < firstRecent && n.wakeDate >= addDays(firstRecent, -BASELINE_DAYS));
  const pool = [...base, ...recent];

  const hrOf = pickSeries(
    pool,
    (n) => positive(vitals[n.main!.id]?.hrMin),
    (n) => positive(daily[n.wakeDate]?.restingHr),
  );
  const hrvOf = pickSeries(
    pool,
    (n) => positive(vitals[n.main!.id]?.hrvRmssd),
    (n) => positive(daily[n.wakeDate]?.hrv),
  );
  const series: SeriesDef[] = [
    {
      key: 'hr',
      label: 'Resting heart rate',
      get: hrOf,
      isOff: (v, b) => v >= b.mean + Math.max(4, 1.5 * b.sd),
      delta: (r, b) => r - b,
      unit: ' bpm',
      digits: 0,
      display: (v) => v,
    },
    {
      key: 'hrv',
      label: 'HRV',
      get: (n) => {
        const v = hrvOf(n);
        return v !== undefined ? Math.log(v) : undefined;
      },
      isOff: (v, b) => v <= b.mean - Math.max(b.sd, 0.1),
      delta: (r, b) => (Math.exp(r - b) - 1) * 100,
      unit: '%',
      digits: 0,
      display: (v) => Math.exp(v),
    },
    {
      key: 'resp',
      label: 'Breathing rate',
      get: (n) => positive(vitals[n.main!.id]?.respRate),
      isOff: (v, b) => v >= b.mean + Math.max(1, 1.5 * b.sd),
      delta: (r, b) => r - b,
      unit: '/min',
      digits: 1,
      display: (v) => v,
    },
  ];

  const signals: RecoverySignal[] = [];
  const offDates = new Set<string>();
  for (const s of series) {
    const values = base.map(s.get).filter((x): x is number => x !== undefined);
    if (values.length < MIN_BASELINE) continue;
    const b = { mean: mean(values), sd: Math.max(sd(values), 1e-6) };
    const checked = recent.map((n) => ({ date: n.wakeDate, v: s.get(n) })).filter((x): x is { date: string; v: number } => x.v !== undefined);
    if (checked.length < MIN_OFF) continue;
    const offNights = checked.filter((x) => s.isOff(x.v, b));
    const off = offNights.length >= MIN_OFF;
    const recentMean = mean((off ? offNights : checked).map((x) => x.v));
    if (off) for (const x of offNights) offDates.add(x.date);
    const delta = s.delta(recentMean, b.mean);
    signals.push({
      key: s.key,
      label: s.label,
      baseline: Math.round(s.display(b.mean) * 10) / 10,
      recent: Math.round(s.display(recentMean) * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      change: `${fmtSigned(delta, s.digits)}${s.unit}`,
      nightsOff: offNights.length,
      nightsChecked: checked.length,
      off,
    });
  }

  const off = signals.filter((s) => s.off);
  if (off.length < 2) return undefined;
  const level: RecoveryAlert['level'] = off.length >= 3 ? 'warning' : 'watch';
  const nightsOff = Math.max(...off.map((s) => s.nightsOff));
  const phrase = (s: RecoverySignal) =>
    s.key === 'hr'
      ? `resting HR up ${Math.round(s.delta)} bpm`
      : s.key === 'hrv'
        ? `HRV down ${Math.round(Math.abs(s.delta))}%`
        : `breathing ${Math.abs(s.delta).toFixed(1)}/min faster`;
  const list = off.map(phrase);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
  const detail = `${joined.charAt(0).toUpperCase()}${joined.slice(1)} on ${nightsOff} of the last ${recent.length} nights compared with your usual. That pattern can mean your body is fighting something off, overreaching from training, or carrying a lot of stress. Take it easy: keep sleep regular, go lighter on exercise and alcohol, and see how you feel.`;
  return {
    level,
    title: level === 'warning' ? 'Your body may be under strain' : 'Recovery looks a little off',
    detail,
    nights: [...offDates].sort(),
    signals,
    advice: [
      'Keep bedtime and wake time regular — an early night helps more than a lie-in.',
      'Swap hard training for a walk or easy movement until the numbers settle.',
      'Skip alcohol and late meals; drink enough water.',
      'This is not a diagnosis — if you feel unwell or it persists, check in with a doctor.',
    ],
  };
}
