/**
 * Pure mapping from Health Connect records (as returned by react-native-health-connect) to eepy's
 * model. Kept free of native imports so it can be unit tested.
 */
import type { DailyStats, SleepSession, Stage, StageSegment, VitalSample, Workout } from '../engine/types';
import { dateKey, MINUTE } from '../engine/time';

/** Health Connect SleepSessionRecord.STAGE_TYPE_* constants. */
export const HC_STAGE: Record<number, Stage> = {
  0: 'asleep', // UNKNOWN — treat as unstaged sleep
  1: 'awake',
  2: 'asleep', // SLEEPING (unstaged)
  3: 'outOfBed',
  4: 'light',
  5: 'deep',
  6: 'rem',
  7: 'awake', // AWAKE_IN_BED
};

export interface HCMetadata {
  id?: string;
  dataOrigin?: string;
  lastModifiedTime?: string;
  device?: { manufacturer?: string; model?: string; type?: number };
}

export interface HCSleepRecord {
  startTime: string;
  endTime: string;
  title?: string;
  notes?: string;
  stages?: { startTime: string; endTime: string; stage: number }[];
  metadata?: HCMetadata;
}

export interface HCHeartRateRecord {
  startTime: string;
  endTime: string;
  samples: { time: string; beatsPerMinute: number }[];
  metadata?: HCMetadata;
}

export interface HCInstantRecord {
  time: string;
  metadata?: HCMetadata;
  [key: string]: unknown;
}

export interface HCExerciseRecord {
  startTime: string;
  endTime: string;
  exerciseType: number;
  title?: string;
  metadata?: HCMetadata;
}

export function mapWorkout(r: HCExerciseRecord): Workout {
  return {
    id: `hc:${r.metadata?.id ?? `${r.startTime}-${r.endTime}`}`,
    start: ms(r.startTime),
    end: ms(r.endTime),
    type: r.exerciseType,
    title: r.title,
    origin: r.metadata?.dataOrigin,
  };
}

export interface HCStepsRecord {
  startTime: string;
  endTime: string;
  count: number;
  metadata?: HCMetadata;
}

const ms = (iso: string) => new Date(iso).getTime();

/** Joins back-to-back segments of the same stage (some devices write one record per minute). */
export function mergeRuns(stages: StageSegment[]): StageSegment[] {
  const out: StageSegment[] = [];
  for (const s of [...stages].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && last.stage === s.stage && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

export function mapSleepRecord(r: HCSleepRecord): SleepSession {
  const device = [r.metadata?.device?.manufacturer, r.metadata?.device?.model].filter(Boolean).join(' ') || undefined;
  const isNap = /\bnap\b/i.test(r.title ?? '');
  return {
    id: `hc:${r.metadata?.id ?? `${r.startTime}-${r.endTime}`}`,
    source: 'health-connect',
    origin: r.metadata?.dataOrigin,
    device,
    start: ms(r.startTime),
    end: ms(r.endTime),
    stages: mergeRuns(
      (r.stages ?? []).map((s) => ({ stage: HC_STAGE[s.stage] ?? 'asleep', start: ms(s.startTime), end: ms(s.endTime) })),
    ),
    kind: isNap ? 'nap' : undefined,
    notes: r.notes,
    updatedAt: r.metadata?.lastModifiedTime ? ms(r.metadata.lastModifiedTime) : undefined,
  };
}

export function flattenHeartRate(records: HCHeartRateRecord[]): VitalSample[] {
  const out: VitalSample[] = [];
  for (const r of records) for (const s of r.samples ?? []) out.push({ time: ms(s.time), value: s.beatsPerMinute });
  return out.sort((a, b) => a.time - b.time);
}

/** Extracts a numeric field from instantaneous records (HRV, SpO2, respiratory rate, resting HR). */
export function instantSamples(records: HCInstantRecord[], field: string): VitalSample[] {
  return records
    .map((r) => ({ time: ms(r.time), value: Number(r[field]) }))
    .filter((s) => Number.isFinite(s.value))
    .sort((a, b) => a.time - b.time);
}

/** Sums step records per local day (records spanning midnight are split proportionally). */
export function stepsPerDay(records: HCStepsRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    const start = ms(r.startTime);
    const end = Math.max(start + 1, ms(r.endTime));
    let t = start;
    while (t < end) {
      const d = new Date(t);
      const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const segEnd = Math.min(end, nextMidnight);
      const key = dateKey(t);
      out[key] = (out[key] ?? 0) + (r.count * (segEnd - t)) / (end - start);
      t = segEnd;
    }
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

/** Step records longer than this are too coarse to tell when you got up (e.g. hourly totals). */
export const STEP_CURVE_MAX_RECORD_MIN = 30;

/**
 * Steps around one sleep session in 10-minute bins, from its start to 30 min past its end:
 * [minutes since session start, steps], empty bins left out (like NightVitals.hrCurve). Each record is
 * spread over the bins it covers. Undefined when no usable step record touches the window.
 * Used by engine/wakeDetect.ts to see when you got up.
 */
export function stepCurve(records: HCStepsRecord[], start: number, end: number, afterMin = 30): [number, number][] | undefined {
  const BIN = 10 * MINUTE;
  const until = end + afterMin * MINUTE;
  const bins = new Map<number, number>();
  let seen = false;
  for (const r of records) {
    const a = ms(r.startTime);
    const b = Math.max(a + 1, ms(r.endTime));
    if (b <= start || a >= until || b - a > STEP_CURVE_MAX_RECORD_MIN * MINUTE) continue;
    seen = true;
    for (let t = start + Math.floor((Math.max(a, start) - start) / BIN) * BIN; t < Math.min(b, until); t += BIN) {
      const o = Math.min(b, t + BIN, until) - Math.max(a, t);
      if (o > 0) bins.set(t, (bins.get(t) ?? 0) + (r.count * o) / (b - a));
    }
  }
  if (!seen) return undefined;
  return [...bins.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([t, v]): [number, number] => [Math.round((t - start) / MINUTE), Math.round(v)])
    .filter(([, v]) => v > 0);
}

/** Folds steps / resting HR / HRV samples into per-day stats. */
export function buildDailyStats(
  steps: Record<string, number>,
  restingHr: VitalSample[],
  hrv: VitalSample[],
): Record<string, DailyStats> {
  const out: Record<string, DailyStats> = {};
  const get = (date: string) => (out[date] ??= { date });
  for (const [date, count] of Object.entries(steps)) get(date).steps = count;
  const group = (xs: VitalSample[]) => {
    const g: Record<string, number[]> = {};
    for (const s of xs) (g[dateKey(s.time)] ??= []).push(s.value);
    return g;
  };
  for (const [date, vals] of Object.entries(group(restingHr))) get(date).restingHr = Math.round(Math.min(...vals));
  for (const [date, vals] of Object.entries(group(hrv))) get(date).hrv = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  return out;
}

export interface OriginSummary {
  origin: string;
  label: string;
  sessions: number;
  staged: boolean;
  likelyWatch: boolean;
}

/** Friendly labels for apps commonly found writing sleep to Health Connect. */
export function originLabel(origin: string): { label: string; likelyWatch: boolean } {
  const o = origin.toLowerCase();
  // Nothing X (com.nothing.smartcenter) is the companion app for the CMF Watch 3 Pro.
  if (o === 'com.nothing.smartcenter') return { label: 'Nothing X (CMF Watch)', likelyWatch: true };
  if (o.includes('cmf') || o.includes('nothing')) return { label: 'Nothing / CMF', likelyWatch: true };
  if (o.includes('gadgetbridge')) return { label: 'Gadgetbridge', likelyWatch: true };
  if (o.includes('google.android.apps.fitness')) return { label: 'Google Fit', likelyWatch: false };
  if (o.includes('samsung')) return { label: 'Samsung Health', likelyWatch: true };
  if (o.includes('fitbit')) return { label: 'Fitbit', likelyWatch: true };
  if (o.includes('sleep') && o.includes('urbandroid')) return { label: 'Sleep as Android', likelyWatch: false };
  if (o.includes('healthdata') || o === 'android') return { label: 'Health Connect (manual)', likelyWatch: false };
  if (o.includes('eepy')) return { label: 'eepy (manual logs)', likelyWatch: false };
  return { label: origin, likelyWatch: false };
}

export function summarizeOrigins(sessions: SleepSession[]): OriginSummary[] {
  const by = new Map<string, OriginSummary>();
  for (const s of sessions) {
    if (!s.origin) continue;
    const cur = by.get(s.origin) ?? { origin: s.origin, ...originLabel(s.origin), sessions: 0, staged: false };
    cur.sessions++;
    if (s.stages.some((x) => x.stage === 'light' || x.stage === 'deep' || x.stage === 'rem')) cur.staged = true;
    by.set(s.origin, cur);
  }
  return [...by.values()].sort((a, b) => Number(b.likelyWatch) - Number(a.likelyWatch) || b.sessions - a.sessions);
}

/** Health Connect insert payload for a manually logged sleep. */
export function toHealthConnectSleep(s: SleepSession) {
  const stageCode: Record<Stage, number> = { awake: 1, asleep: 2, outOfBed: 3, light: 4, deep: 5, rem: 6 };
  return {
    recordType: 'SleepSession' as const,
    startTime: new Date(s.start).toISOString(),
    endTime: new Date(s.end).toISOString(),
    title: s.kind === 'nap' ? 'Nap' : 'Sleep',
    notes: s.notes,
    stages: s.stages.map((x) => ({ startTime: new Date(x.start).toISOString(), endTime: new Date(x.end).toISOString(), stage: stageCode[x.stage] })),
  };
}
