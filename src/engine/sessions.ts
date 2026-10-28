import { dateKey, minutesOfDay, MINUTE } from './time';
import { isSleepStage, SleepSession, Stage, StageSegment } from './types';
import { mean, median } from './stats';

export interface Cycle {
  start: number;
  end: number;
  lengthMin: number;
  /** A cycle is complete when it ends with a REM period (or an awakening after REM). */
  complete: boolean;
  deepMin: number;
  remMin: number;
}

export interface StageMinutes {
  light: number;
  deep: number;
  rem: number;
  asleep: number;
  awake: number;
}

export interface SessionMetrics {
  id: string;
  session: SleepSession;
  start: number;
  end: number;
  segments: StageSegment[];
  /** Local date the sleep ended on — the day this sleep "belongs" to. */
  wakeDate: string;
  isNap: boolean;
  hasStages: boolean;
  timeInBedMin: number;
  totalSleepMin: number;
  sleepOnset: number;
  finalWake: number;
  latencyMin: number;
  wasoMin: number;
  awakenings: number;
  efficiency: number;
  stageMin: StageMinutes;
  /** Share of total sleep time per stage (0–1); undefined for unstaged sessions. */
  stagePct?: { light: number; deep: number; rem: number };
  midSleep: number;
  cycles: Cycle[];
  avgCycleMin?: number;
}

export interface Night {
  wakeDate: string;
  main?: SessionMetrics;
  /** Naps and any additional sleep periods that ended on this date. */
  naps: SessionMetrics[];
  /** Main sleep + naps, minutes asleep. */
  totalSleepMin: number;
}

const SHORT_GAP_MS = 10 * MINUTE;
const MIN_AWAKENING_MS = 2 * MINUTE;
const REM_MERGE_GAP_MS = 15 * MINUTE;

const minutes = (ms: number) => ms / MINUTE;

/**
 * Cleans a session's stage list: clips to the session, removes overlaps, fills gaps and merges
 * runs of the same stage. Sessions without stages become one `asleep` segment.
 */
export function normalizeSegments(session: SleepSession): StageSegment[] {
  const { start, end } = session;
  if (end <= start) return [];
  const raw = session.stages
    .map((s) => ({ stage: s.stage, start: Math.max(start, s.start), end: Math.min(end, s.end) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (raw.length === 0) return [{ stage: 'asleep', start, end }];

  const out: StageSegment[] = [];
  let cursor = start;
  for (const seg of raw) {
    let s = seg.start;
    if (s < cursor) s = cursor; // overlap with previous: previous wins
    if (seg.end <= s) continue;
    if (s > cursor) {
      // Gap: short gaps continue the previous stage, longer (or leading) gaps are wakefulness.
      const prev = out[out.length - 1];
      const gapStage: Stage = prev && s - cursor <= SHORT_GAP_MS ? prev.stage : 'awake';
      push(out, { stage: gapStage, start: cursor, end: s });
    }
    push(out, { stage: seg.stage === 'outOfBed' ? 'awake' : seg.stage, start: s, end: seg.end });
    cursor = seg.end;
  }
  if (cursor < end) push(out, { stage: 'awake', start: cursor, end });
  return out;
}

function push(out: StageSegment[], seg: StageSegment) {
  const last = out[out.length - 1];
  if (last && last.stage === seg.stage && last.end === seg.start) last.end = seg.end;
  else out.push({ ...seg });
}

/** Sleep cycles, delimited by the end of each REM period. */
export function detectCycles(segments: StageSegment[], onset: number, finalWake: number): Cycle[] {
  const inSleep = segments.filter((s) => s.end > onset && s.start < finalWake);
  const remPeriods: { start: number; end: number }[] = [];
  for (const s of inSleep) {
    if (s.stage !== 'rem') continue;
    const last = remPeriods[remPeriods.length - 1];
    if (last && s.start - last.end <= REM_MERGE_GAP_MS) last.end = s.end;
    else remPeriods.push({ start: s.start, end: s.end });
  }
  const cycles: Cycle[] = [];
  let cycleStart = onset;
  for (const rem of remPeriods) {
    if (rem.end - cycleStart < 40 * MINUTE) continue; // too short to be its own cycle
    cycles.push(makeCycle(inSleep, cycleStart, rem.end, true));
    cycleStart = rem.end;
  }
  if (finalWake - cycleStart >= 30 * MINUTE) cycles.push(makeCycle(inSleep, cycleStart, finalWake, false));
  return cycles;
}

function makeCycle(segs: StageSegment[], start: number, end: number, complete: boolean): Cycle {
  let deep = 0;
  let rem = 0;
  for (const s of segs) {
    const o = Math.min(end, s.end) - Math.max(start, s.start);
    if (o <= 0) continue;
    if (s.stage === 'deep') deep += o;
    if (s.stage === 'rem') rem += o;
  }
  return { start, end, lengthMin: minutes(end - start), complete, deepMin: minutes(deep), remMin: minutes(rem) };
}

/** Per-session sleep metrics. `isNap` is provisional; {@link analyzeSessions} finalises it. */
export function computeSessionMetrics(session: SleepSession): SessionMetrics | undefined {
  const segments = normalizeSegments(session);
  if (segments.length === 0) return undefined;
  const sleepSegs = segments.filter((s) => isSleepStage(s.stage));
  if (sleepSegs.length === 0) return undefined;

  const sleepOnset = sleepSegs[0].start;
  const finalWake = sleepSegs[sleepSegs.length - 1].end;
  const stageMs = { light: 0, deep: 0, rem: 0, asleep: 0, awake: 0 };
  let wasoMs = 0;
  let awakenings = 0;
  for (const s of segments) {
    const d = s.end - s.start;
    if (s.stage === 'awake' || s.stage === 'outOfBed') {
      stageMs.awake += d;
      if (s.start >= sleepOnset && s.end <= finalWake) {
        wasoMs += d;
        if (d >= MIN_AWAKENING_MS) awakenings++;
      }
    } else {
      stageMs[s.stage] += d;
    }
  }
  const tstMs = stageMs.light + stageMs.deep + stageMs.rem + stageMs.asleep;
  const tibMs = session.end - session.start;
  const hasStages = stageMs.light + stageMs.deep + stageMs.rem > 0;
  const staged = stageMs.light + stageMs.deep + stageMs.rem;
  const cycles = hasStages ? detectCycles(segments, sleepOnset, finalWake) : [];
  const usable = cycles.filter((c) => c.complete && c.lengthMin >= 60 && c.lengthMin <= 150);

  return {
    id: session.id,
    session,
    start: session.start,
    end: session.end,
    segments,
    wakeDate: dateKey(finalWake),
    isNap: session.kind === 'nap',
    hasStages,
    timeInBedMin: minutes(tibMs),
    totalSleepMin: minutes(tstMs),
    sleepOnset,
    finalWake,
    latencyMin: minutes(sleepOnset - session.start),
    wasoMin: minutes(wasoMs),
    awakenings,
    efficiency: tibMs > 0 ? tstMs / tibMs : 0,
    stageMin: {
      light: minutes(stageMs.light),
      deep: minutes(stageMs.deep),
      rem: minutes(stageMs.rem),
      asleep: minutes(stageMs.asleep),
      awake: minutes(stageMs.awake),
    },
    stagePct: hasStages
      ? { light: stageMs.light / staged, deep: stageMs.deep / staged, rem: stageMs.rem / staged }
      : undefined,
    midSleep: sleepOnset + (finalWake - sleepOnset) / 2,
    cycles,
    avgCycleMin: usable.length > 0 ? mean(usable.map((c) => c.lengthMin)) : undefined,
  };
}

/** Minutes of overlap between a session and the 02:00–05:00 local "core night" window. */
function coreNightOverlapMin(s: SleepSession): number {
  let total = 0;
  for (let t = s.start; t < s.end; t += 5 * MINUTE) {
    const m = minutesOfDay(t);
    if (m >= 120 && m < 300) total += 5;
  }
  return total;
}

function overlapMs(a: SleepSession, b: SleepSession): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

export interface SessionAnalyzeOptions {
  /** Origins (package names / bundle ids) to prefer when sources overlap, most preferred first. */
  preferredOrigins?: string[];
  /** Max awake gap (minutes) between two night sessions that should be merged into one sleep. */
  mergeGapMin?: number;
}

/**
 * Removes duplicate recordings of the same sleep (e.g. phone + watch both writing to Health Connect),
 * keeping the most trustworthy one.
 */
export function dedupeSessions(sessions: SleepSession[], preferredOrigins: string[] = []): SleepSession[] {
  const score = (s: SleepSession) => {
    const idx = s.origin ? preferredOrigins.indexOf(s.origin) : -1;
    const pref = idx >= 0 ? 1000 - idx * 10 : 0;
    const manual = s.source === 'manual' ? 500 : 0; // explicit user edits win over automatic data
    const staged = s.stages.some((x) => x.stage === 'light' || x.stage === 'deep' || x.stage === 'rem') ? 100 : 0;
    return pref + manual + staged + (s.end - s.start) / (60 * MINUTE);
  };
  const ranked = [...sessions].filter((s) => s.end > s.start).sort((a, b) => score(b) - score(a));
  const kept: SleepSession[] = [];
  for (const s of ranked) {
    const clash = kept.some((k) => {
      const shorter = Math.min(k.end - k.start, s.end - s.start);
      return overlapMs(k, s) > 0.3 * shorter;
    });
    if (!clash) kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Joins night-time sessions split by a short awakening into one sleep period. */
export function mergeFragmented(sessions: SleepSession[], maxGapMin = 45): SleepSession[] {
  const out: SleepSession[] = [];
  for (const s of [...sessions].sort((a, b) => a.start - b.start)) {
    const prev = out[out.length - 1];
    const gap = prev ? s.start - prev.end : Infinity;
    const gapMid = prev ? minutesOfDay(prev.end + gap / 2) : 0;
    const atNight = gapMid >= 20 * 60 || gapMid <= 10 * 60;
    if (prev && gap >= 0 && gap <= maxGapMin * MINUTE && atNight && prev.kind !== 'nap' && s.kind !== 'nap') {
      out[out.length - 1] = {
        ...prev,
        id: `${prev.id}+${s.id}`,
        end: s.end,
        stages: [
          ...(prev.stages.length ? prev.stages : [{ stage: 'asleep' as Stage, start: prev.start, end: prev.end }]),
          ...(gap > 0 ? [{ stage: 'awake' as Stage, start: prev.end, end: s.start }] : []),
          ...(s.stages.length ? s.stages : [{ stage: 'asleep' as Stage, start: s.start, end: s.end }]),
        ],
        kind: prev.kind ?? s.kind,
      };
    } else {
      out.push(s);
    }
  }
  return out;
}

/** Full pipeline: dedupe → merge fragments → metrics → main-sleep / nap classification. */
export function analyzeSessions(sessions: SleepSession[], opts: SessionAnalyzeOptions = {}): SessionMetrics[] {
  const cleaned = mergeFragmented(dedupeSessions(sessions, opts.preferredOrigins), opts.mergeGapMin);
  const metrics: SessionMetrics[] = [];
  for (const s of cleaned) {
    const m = computeSessionMetrics(s);
    if (!m) continue;
    if (s.kind === 'nap') m.isNap = true;
    else if (s.kind === 'main') m.isNap = false;
    else m.isNap = m.totalSleepMin < 150 && m.timeInBedMin < 240 && coreNightOverlapMin(s) < 60;
    metrics.push(m);
  }
  return metrics.sort((a, b) => a.start - b.start);
}

/** Groups sessions by the date they ended on. The longest non-nap sleep is that date's main sleep. */
export function buildNights(metrics: SessionMetrics[]): Night[] {
  const byDate = new Map<string, SessionMetrics[]>();
  for (const m of metrics) {
    const list = byDate.get(m.wakeDate) ?? [];
    list.push(m);
    byDate.set(m.wakeDate, list);
  }
  const nights: Night[] = [];
  for (const [wakeDate, list] of byDate) {
    const mains = list.filter((m) => !m.isNap).sort((a, b) => b.totalSleepMin - a.totalSleepMin);
    const main = mains[0];
    const naps = list.filter((m) => m !== main).sort((a, b) => a.start - b.start);
    const totalSleepMin = list.reduce((s, m) => s + m.totalSleepMin, 0);
    nights.push({ wakeDate, main, naps, totalSleepMin });
  }
  return nights.sort((a, b) => (a.wakeDate < b.wakeDate ? -1 : 1));
}

/** Personal sleep-onset latency for planning (falls back when the device can't see time in bed). */
export function personalLatencyMin(nights: Night[], fallback = 15): number {
  const lat = nights
    .slice(-30)
    .map((n) => n.main?.latencyMin)
    .filter((x): x is number => x !== undefined && x >= 0 && x < 120);
  if (lat.length < 5) return fallback;
  const m = median(lat);
  return m < 3 ? fallback : m;
}

/** Personal sleep-cycle length (minutes) from staged nights; population default 90. */
export function personalCycleMin(nights: Night[], fallback = 90): number {
  const cyc = nights
    .slice(-30)
    .map((n) => n.main?.avgCycleMin)
    .filter((x): x is number => x !== undefined);
  if (cyc.length < 5) return fallback;
  return Math.round(median(cyc));
}

/**
 * Typical share of the sleep period (first sleep → final wake) actually spent asleep. Used to turn
 * sleep need into time in bed; time to fall asleep is added separately.
 */
export function personalEfficiency(nights: Night[]): number {
  const eff = nights
    .slice(-30)
    .map((n) => (n.main ? n.main.totalSleepMin / ((n.main.finalWake - n.main.sleepOnset) / MINUTE) : undefined))
    .filter((x): x is number => x !== undefined && x > 0.3);
  if (eff.length < 5) return 0.9;
  return Math.min(0.97, Math.max(0.75, median(eff)));
}
