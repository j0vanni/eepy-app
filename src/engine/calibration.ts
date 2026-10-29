/**
 * Learns the person's own circadian timing from momentary sleepiness ratings (KSS check-ins):
 * fits CircadianParams so the alertness model's predicted KSS matches what they report.
 *
 * Method
 * - For each check-in, the homeostatic process S, sleep inertia W and the sleep-debt penalty are
 *   simulated once from the person's real recorded sleep. None of them depends on the circadian
 *   parameters, so only C changes between candidates. C for a phase shift is a rotation of
 *   precomputed cos/sin terms, which makes a candidate cost a few multiply-adds per check-in.
 * - The estimate is a MAP fit: squared KSS error (rating noise σ ≈ 1.1 points) plus Gaussian priors
 *   centred on the population model (phase ±60 min, amplitude ±25%, dip ±50%, KSS offset ±0.75).
 *   A handful of ratings can only nudge the rhythm; around 20–30 the data dominates.
 * - Search: a coarse grid over phase × amplitude × dip (the KSS offset is solved in closed form at
 *   each grid point), then a pattern search that refines all four parameters.
 * - Accuracy is measured out of sample: leave-one-out (small n) or 5-fold cross-validation. The
 *   number shown is the share of held-out check-ins predicted within ±1 KSS point. If the personal
 *   fit doesn't beat the population model's mean error on held-out check-ins, it isn't applied.
 */
import { CircadianParams, DEFAULT_CIRCADIAN, Interval, KSS_PER_ALERTNESS, kssFromAlertness, simulateAlertness, TPM } from './alertness';
import { analyzeChronotype } from './chronotype';
import { wakeTargetFor } from './schedule';
import { analyzeSessions, buildNights } from './sessions';
import { debtOnDate } from './sleepDebt';
import { estimateSleepNeed } from './sleepNeed';
import { addDays, clamp, DAY, dateKey, HOUR, MINUTE, minutesOfDay, normalizeMinutes } from './time';
import { AlertnessCheckIn, isSleepStage, SleepDataset } from './types';

export const LEARNING = {
  /** Fewest usable check-ins before a personal fit is attempted. */
  minCheckins: 6,
  /** Check-ins for a confident fit (progress bars fill up here). */
  confidentCheckins: 24,
  /** Once this well calibrated, pings taper to one a day (see engine/pingPlan.ts). */
  taperCheckins: 40,
  taperDays: 14,
  /** Older check-ins are ignored: body clocks drift with seasons and routines. */
  maxAgeDays: 60,
  maxCheckins: 200,
};

/** Bump when the model or fit changes so stored results are refitted. */
export const CALIBRATION_VERSION = 1;

/** Search bounds for each parameter. */
export const PARAM_BOUNDS = {
  phaseShiftMin: [-180, 180],
  ampScale: [0.5, 1.6],
  dipScale: [0, 2.5],
  kssOffset: [-2, 2],
} as const;

const PRIOR = { phaseSdMin: 60, ampSd: 0.25, dipSd: 0.5, offsetSd: 0.75 };
/** Typical scatter of a single KSS rating around the person's true sleepiness. */
const NOISE_SD = 1.1;

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export interface CalibrationResult {
  /** Parameters in effect: the personal fit, or the population defaults while it doesn't beat them. */
  params: CircadianParams;
  /** Check-ins used for the fit. */
  n: number;
  /** Mean absolute KSS error of the population model vs. the personal model (out of sample). */
  maeBefore?: number;
  maeAfter?: number;
  /**
   * 0–100 "forecast accuracy" shown to the user: the share of check-ins the model in effect predicted
   * within ±1 KSS point, measured on check-ins held out of the fit.
   */
  accuracy?: number;
  fittedAt: number;
  /** The personal estimate, even when not (yet) applied. */
  fitted?: CircadianParams;
  /** Whether the personal fit predicted held-out check-ins at least as well as the population model. */
  applied?: boolean;
  /** Population-model accuracy on the same check-ins (same 0–100 scale). */
  accuracyBefore?: number;
  /** Share of check-ins predicted within ±1 KSS point (personal, out of sample / population). */
  withinOne?: number;
  withinOneBefore?: number;
  /** Distinct days with check-ins. */
  days?: number;
  confidence?: 'low' | 'medium' | 'high';
  /** Check-ins per part of the day — the fit needs all three. */
  coverage?: Record<TimeOfDay, number>;
  /** Check-ins left out because the sleep before them wasn't recorded (or they fell inside a sleep). */
  skipped?: number;
  /** Signature of the inputs (set by the state layer) so it only refits when something changed. */
  key?: string;
  version?: number;
}

export interface CalibrationInput {
  checkins: AlertnessCheckIn[];
  /** Asleep intervals covering the check-in period (and ~3 days before the first one). */
  sleeps: Interval[];
  midSleepMin: number;
  /** Sleep debt used when a check-in's day isn't in `debtByDate`. */
  debtMin: number;
  now: number;
  /** Sleep debt (sleepDebt.debtOnDate) per "living day" date key of the check-ins. */
  debtByDate?: Record<string, number>;
  /** Ignore check-ins before this time (after "Reset learned rhythm"). */
  since?: number;
}

type FullParams = Required<CircadianParams>;

const POPULATION: FullParams = { ...DEFAULT_CIRCADIAN, kssOffset: 0 };
/** Switches C off, leaving S + W − debt penalty. */
const NO_CIRCADIAN: CircadianParams = { phaseShiftMin: 0, ampScale: 0, dipScale: 0, kssOffset: 0 };
const STEP = 5 * MINUTE;

/** The calendar day a moment belongs to (before 4am counts as the previous day), as in analysis.ts. */
export function livingDay(t: number): string {
  return minutesOfDay(t) < 240 ? addDays(dateKey(t), -1) : dateKey(t);
}

export function timeOfDay(t: number): TimeOfDay {
  const m = minutesOfDay(t);
  if (m >= 240 && m < 12 * 60) return 'morning';
  if (m >= 12 * 60 && m < 17 * 60) return 'afternoon';
  return 'evening';
}

/** Check-ins eligible for the fit: valid, in the past, recent enough and after a reset. */
export function eligibleCheckins(checkins: AlertnessCheckIn[], now: number, since?: number): AlertnessCheckIn[] {
  const from = Math.max(since ?? -Infinity, now - LEARNING.maxAgeDays * DAY);
  return checkins
    .filter((c) => c.time <= now && c.time >= from && Number.isFinite(c.kss) && c.kss >= 1 && c.kss <= 9)
    .sort((a, b) => a.time - b.time)
    .slice(-LEARNING.maxCheckins);
}

// ---------------------------------------------------------------------------
// Per-check-in precomputation
// ---------------------------------------------------------------------------

interface Sample {
  t: number;
  kss: number;
  /** S + W − debt penalty at the check-in. */
  base: number;
  c24: number;
  s24: number;
  c12: number;
  s12: number;
}

function sortedIntervals(list: Interval[]): Interval[] {
  return list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
}

/** Is there enough recorded sleep before `t` to trust the simulated sleep pressure? */
function hasSleepData(sleeps: Interval[], t: number): boolean {
  let recentEnd = false;
  let asleep = 0;
  for (const i of sleeps) {
    if (i.start >= t) break;
    if (i.end > t - 20 * HOUR) recentEnd = true;
    const s = Math.max(i.start, t - 30 * HOUR);
    const e = Math.min(i.end, t);
    if (e > s) asleep += e - s;
  }
  return recentEnd && asleep >= 3 * HOUR;
}

/**
 * Builds a predictor of KSS at arbitrary times from recorded sleep. Returns undefined at times the
 * model can't speak to (asleep, or the preceding sleep wasn't recorded).
 */
export function createKssPredictor(sleeps: Interval[], midSleepMin: number, debtAt: (t: number) => number) {
  const sorted = sortedIntervals(sleeps);
  const acro0 = midSleepMin / 60 + TPM.acrophaseOffsetH;
  const dip0 = midSleepMin / 60 + TPM.dipOffsetH;

  const sample = (time: number, kss: number): Sample | undefined => {
    const t = Math.round(time / STEP) * STEP;
    if (!hasSleepData(sorted, t)) return undefined;
    const near = sorted.filter((i) => i.end > t - 80 * HOUR && i.start <= t + STEP);
    const [p] = simulateAlertness(near, t, t, { midSleepMin, debtMin: debtAt(time), circadian: NO_CIRCADIAN });
    if (!p || p.asleep) return undefined;
    const h = minutesOfDay(t) / 60;
    const x24 = (2 * Math.PI * (h - acro0)) / 24;
    const x12 = (2 * Math.PI * (h - dip0)) / 12;
    return { t, kss, base: p.alertness, c24: Math.cos(x24), s24: Math.sin(x24), c12: Math.cos(x12), s12: Math.sin(x12) };
  };

  return {
    sample,
    /** Model KSS at `time` with the given parameters. */
    kssAt(time: number, params: CircadianParams = DEFAULT_CIRCADIAN): number | undefined {
      const s = sample(time, NaN);
      return s ? predict(s, full(params), trig(params.phaseShiftMin)) : undefined;
    },
  };
}

function full(p: CircadianParams): FullParams {
  return { phaseShiftMin: p.phaseShiftMin, ampScale: p.ampScale, dipScale: p.dipScale, kssOffset: p.kssOffset ?? 0 };
}

interface Trig {
  c24: number;
  s24: number;
  c12: number;
  s12: number;
}

function trig(phaseShiftMin: number): Trig {
  const d24 = (2 * Math.PI * (phaseShiftMin / 60)) / 24;
  const d12 = (2 * Math.PI * (phaseShiftMin / 60)) / 12;
  return { c24: Math.cos(d24), s24: Math.sin(d24), c12: Math.cos(d12), s12: Math.sin(d12) };
}

/** Circadian term without the KSS offset: same formula as alertness.circadian(), rotated by the phase shift. */
function circ(s: Sample, p: FullParams, g: Trig): number {
  const cos24 = s.c24 * g.c24 + s.s24 * g.s24;
  const cos12 = s.c12 * g.c12 + s.s12 * g.s12;
  return TPM.circAmp * p.ampScale * cos24 - TPM.dipAmp * p.dipScale * cos12;
}

function predict(s: Sample, p: FullParams, g: Trig): number {
  return kssFromAlertness(s.base + circ(s, p, g) - p.kssOffset / KSS_PER_ALERTNESS);
}

// ---------------------------------------------------------------------------
// MAP fit
// ---------------------------------------------------------------------------

function priorCost(p: FullParams): number {
  return (
    (p.phaseShiftMin / PRIOR.phaseSdMin) ** 2 +
    ((p.ampScale - 1) / PRIOR.ampSd) ** 2 +
    ((p.dipScale - 1) / PRIOR.dipSd) ** 2 +
    (p.kssOffset / PRIOR.offsetSd) ** 2
  );
}

function cost(samples: Sample[], p: FullParams): number {
  const g = trig(p.phaseShiftMin);
  let sse = 0;
  for (const s of samples) sse += (predict(s, p, g) - s.kss) ** 2;
  return sse / NOISE_SD ** 2 + priorCost(p);
}

/** Best KSS offset for fixed phase/amplitude/dip (closed form, ignoring the 1–9 clamp). */
function bestOffset(samples: Sample[], p: FullParams, g: Trig): number {
  let sum = 0;
  for (const s of samples) sum += s.kss - kssFromAlertness(s.base + circ(s, p, g));
  const o = sum / (samples.length + (NOISE_SD / PRIOR.offsetSd) ** 2);
  return clamp(o, PARAM_BOUNDS.kssOffset[0], PARAM_BOUNDS.kssOffset[1]);
}

function range(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

const GRID = {
  phase: range(PARAM_BOUNDS.phaseShiftMin[0], PARAM_BOUNDS.phaseShiftMin[1], 30),
  amp: range(PARAM_BOUNDS.ampScale[0], PARAM_BOUNDS.ampScale[1], 0.1),
  dip: range(PARAM_BOUNDS.dipScale[0], PARAM_BOUNDS.dipScale[1], 0.25),
};

type Key = keyof FullParams;
const KEYS: Key[] = ['phaseShiftMin', 'ampScale', 'dipScale', 'kssOffset'];
const START_STEP: FullParams = { phaseShiftMin: 15, ampScale: 0.05, dipScale: 0.125, kssOffset: 0.25 };
const MIN_STEP: FullParams = { phaseShiftMin: 1, ampScale: 0.005, dipScale: 0.01, kssOffset: 0.01 };

function fitParams(samples: Sample[]): FullParams {
  // Coarse grid (offset solved per point).
  let best: FullParams = { ...POPULATION };
  let bestCost = cost(samples, best);
  for (const phase of GRID.phase) {
    const g = trig(phase);
    for (const amp of GRID.amp) {
      for (const dip of GRID.dip) {
        const p: FullParams = { phaseShiftMin: phase, ampScale: amp, dipScale: dip, kssOffset: 0 };
        p.kssOffset = bestOffset(samples, p, g);
        const c = cost(samples, p);
        if (c < bestCost) {
          bestCost = c;
          best = p;
        }
      }
    }
  }
  // Pattern search over all four.
  const step = { ...START_STEP };
  for (let iter = 0; iter < 400; iter++) {
    let improved = false;
    for (const k of KEYS) {
      for (const dir of [1, -1]) {
        const v = clamp(best[k] + dir * step[k], PARAM_BOUNDS[k][0], PARAM_BOUNDS[k][1]);
        if (v === best[k]) continue;
        const cand = { ...best, [k]: v };
        const c = cost(samples, cand);
        if (c < bestCost - 1e-12) {
          bestCost = c;
          best = cand;
          improved = true;
          break;
        }
      }
    }
    if (!improved) {
      if (KEYS.every((k) => step[k] <= MIN_STEP[k])) break;
      for (const k of KEYS) step[k] = Math.max(MIN_STEP[k], step[k] / 2);
    }
  }
  return {
    phaseShiftMin: Math.round(best.phaseShiftMin),
    ampScale: Math.round(best.ampScale * 1000) / 1000,
    dipScale: Math.round(best.dipScale * 1000) / 1000,
    kssOffset: Math.round(best.kssOffset * 100) / 100,
  };
}

/** Held-out absolute errors: leave-one-out for small n, otherwise 5 interleaved folds. */
function crossValidatedErrors(samples: Sample[]): number[] {
  const n = samples.length;
  const k = n <= 20 ? n : 5;
  const errors = new Array<number>(n);
  for (let f = 0; f < k; f++) {
    const train = samples.filter((_, i) => i % k !== f);
    const p = fitParams(train);
    const g = trig(p.phaseShiftMin);
    samples.forEach((s, i) => {
      if (i % k === f) errors[i] = Math.abs(predict(s, p, g) - s.kss);
    });
  }
  return errors;
}

const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** Share of absolute errors within one KSS point. */
const withinOne = (errors: number[]) => errors.filter((e) => e <= 1 + 1e-9).length / errors.length;

/** Converts check-ins into model samples (dropping those the model can't evaluate). */
function prepareSamples(input: CalibrationInput): { samples: Sample[]; skipped: number } {
  const checkins = eligibleCheckins(input.checkins, input.now, input.since);
  const predictor = createKssPredictor(input.sleeps, input.midSleepMin, (t) => input.debtByDate?.[livingDay(t)] ?? input.debtMin);
  const samples: Sample[] = [];
  for (const c of checkins) {
    const s = predictor.sample(c.time, c.kss);
    if (s) samples.push(s);
  }
  return { samples, skipped: checkins.length - samples.length };
}

export function fitCircadian(input: CalibrationInput): CalibrationResult | undefined {
  const { samples, skipped } = prepareSamples(input);
  const n = samples.length;
  if (n < LEARNING.minCheckins) return undefined;

  const fitted = fitParams(samples);
  const g0 = trig(0);
  const popErrors = samples.map((s) => Math.abs(predict(s, POPULATION, g0) - s.kss));
  const cvErrors = crossValidatedErrors(samples);
  const maeBefore = meanOf(popErrors);
  const maeAfter = meanOf(cvErrors);
  // Small tolerance: an essentially equal fit is still worth applying (it is shrunk toward defaults anyway).
  const applied = maeAfter <= maeBefore + 0.02;

  const coverage: Record<TimeOfDay, number> = { morning: 0, afternoon: 0, evening: 0 };
  for (const s of samples) coverage[timeOfDay(s.t)]++;
  const days = new Set(samples.map((s) => livingDay(s.t))).size;
  const confidence = n >= LEARNING.confidentCheckins && days >= 7 ? 'high' : n >= 12 ? 'medium' : 'low';
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const inEffect = applied ? cvErrors : popErrors;

  return {
    params: applied ? fitted : { ...DEFAULT_CIRCADIAN },
    fitted,
    applied,
    n,
    maeBefore: round2(maeBefore),
    maeAfter: round2(maeAfter),
    accuracy: Math.round(100 * withinOne(inEffect)),
    accuracyBefore: Math.round(100 * withinOne(popErrors)),
    withinOne: round2(withinOne(inEffect)),
    withinOneBefore: round2(withinOne(popErrors)),
    days,
    confidence,
    coverage,
    skipped,
    fittedAt: input.now,
    version: CALIBRATION_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Inputs from the stored dataset (mirrors analysis.ts so the phase anchor matches the forecast)
// ---------------------------------------------------------------------------

/** analysis.ts ANALYSIS_WINDOW_DAYS — same history so need, debt and habitual mid-sleep agree. */
const HISTORY_DAYS = 120;

export interface CalibrationContext {
  /** Recorded asleep intervals (stage level). */
  sleeps: Interval[];
  midSleepMin: number;
  needMin: number;
  /** Sleep debt as of the morning of a date key. */
  debtOn(date: string): number;
}

/** Sleep, phase anchor and debt as the forecast sees them (same pipeline as analysis.ts). */
export function calibrationContext(data: SleepDataset, now: number, opts: { preferredOrigins?: string[]; sleepsFrom?: number } = {}): CalibrationContext {
  const { profile, dayLogs } = data;
  const day = livingDay(now);
  const metrics = analyzeSessions(
    data.sessions.filter((s) => s.start < now && s.end > now - HISTORY_DAYS * DAY),
    { preferredOrigins: opts.preferredOrigins },
  );
  const nights = buildNights(metrics).filter((n) => n.wakeDate <= dateKey(now));
  const needMin = estimateSleepNeed({ nights, dayLogs, profile, asOfDate: day }).needMin;
  const chronotype = analyzeChronotype({ nights, profile, dayLogs });
  const midSleepMin = chronotype.habitual?.midSleepMin ?? normalizeMinutes(wakeTargetFor(profile, day).wakeMin - needMin / 2);
  const sleeps: Interval[] = [];
  for (const m of metrics) {
    if (opts.sleepsFrom !== undefined && m.end < opts.sleepsFrom) continue;
    for (const seg of m.segments) if (isSleepStage(seg.stage)) sleeps.push({ start: seg.start, end: seg.end });
  }
  const debts = new Map<string, number>();
  const debtOn = (date: string) => {
    let d = debts.get(date);
    if (d === undefined) {
      d = debtOnDate(nights, needMin, date);
      debts.set(date, d);
    }
    return d;
  };
  return { sleeps, midSleepMin, needMin, debtOn };
}

export function calibrationInputFromDataset(
  data: SleepDataset,
  now: number,
  opts: { preferredOrigins?: string[]; since?: number } = {},
): CalibrationInput {
  const checkins = eligibleCheckins(data.checkins ?? [], now, opts.since);
  const earliest = checkins[0]?.time ?? now;
  const ctx = calibrationContext(data, now, { preferredOrigins: opts.preferredOrigins, sleepsFrom: earliest - 4 * DAY });
  const debtByDate: Record<string, number> = {};
  for (const c of checkins) {
    const d = livingDay(c.time);
    debtByDate[d] ??= ctx.debtOn(d);
  }
  return { checkins, sleeps: ctx.sleeps, midSleepMin: ctx.midSleepMin, debtMin: ctx.debtOn(livingDay(now)), now, debtByDate, since: opts.since };
}

// ---------------------------------------------------------------------------
// Plain-language description
// ---------------------------------------------------------------------------

export interface RhythmFinding {
  id: 'dip' | 'phase' | 'amplitude' | 'offset' | 'average';
  text: string;
}

const about = (min: number) => {
  const r = Math.round(Math.abs(min) / 5) * 5;
  return r >= 60 ? `about ${Math.round((r / 60) * 10) / 10}h` : `about ${r} min`;
};

/** What the learned parameters mean, in words. */
export function describeRhythm(params: CircadianParams): RhythmFinding[] {
  const p = full(params);
  const out: RhythmFinding[] = [];
  const shifted = Math.abs(p.phaseShiftMin) >= 15;
  const dipWord = p.dipScale >= 1.3 ? 'stronger than average' : p.dipScale <= 0.7 ? 'milder than average' : 'about average';
  const dipTiming = shifted ? ` and ${about(p.phaseShiftMin)} ${p.phaseShiftMin > 0 ? 'later' : 'earlier'} than typical for your sleep times` : '';
  if (dipWord !== 'about average' || shifted) {
    out.push({ id: 'dip', text: `Your afternoon dip is ${dipWord}${dipTiming}.` });
  }
  if (Math.abs(p.phaseShiftMin) >= 20) {
    out.push({
      id: 'phase',
      text:
        p.phaseShiftMin > 0
          ? `Your body clock runs ${about(p.phaseShiftMin)} later than your sleep schedule suggests: peak focus and the evening second wind come later, and early nights may be hard.`
          : `Your body clock runs ${about(p.phaseShiftMin)} earlier than your sleep schedule suggests: you're sharpest early and fade sooner in the evening.`,
    });
  }
  if (p.ampScale >= 1.2) {
    out.push({ id: 'amplitude', text: 'Your daily swing is bigger than average: higher highs in the late morning and early evening, and a steeper slide toward bedtime.' });
  } else if (p.ampScale <= 0.8) {
    out.push({ id: 'amplitude', text: 'Your energy is steadier across the day than average, with smaller peaks and troughs.' });
  }
  if (Math.abs(p.kssOffset) >= 0.6) {
    const pts = Math.round(Math.abs(p.kssOffset) * 10) / 10;
    out.push({
      id: 'offset',
      text:
        p.kssOffset > 0
          ? `You rate yourself about ${pts} points sleepier than the model expects at the same hour. That can be sleep debt the watch doesn't see, or just how you use the scale — eepy adjusts for it.`
          : `You rate yourself about ${pts} points more alert than the model expects at the same hour — eepy adjusts for it.`,
    });
  }
  if (out.length === 0) out.push({ id: 'average', text: 'So far your rhythm looks close to the population average.' });
  return out;
}
