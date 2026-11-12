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
 * - With watch signals (watchSignals.ts) the same fit also learns how much last night's recovery
 *   signals, today's heart rate, caffeine and the watch's body-clock shift count for this person:
 *   priors centred on the population defaults, and for a fixed clock shape the offset and the weights
 *   are a ridge regression solved in closed form.
 * - Accuracy is measured out of sample: leave-one-out (small n) or 5-fold cross-validation. The
 *   number shown is the share of held-out check-ins predicted within ±1 KSS point. Up to four
 *   models are scored that way (CalibrationTier) and the one in effect is whichever predicted
 *   held-out check-ins best — a model that uses the watch only wins when it is at least as good.
 */
import { CircadianParams, DEFAULT_CIRCADIAN, ENERGY_PER_ALERTNESS, Interval, KSS_AT_ZERO, KSS_PER_ALERTNESS, kssFromAlertness, simulateAlertness, TPM } from './alertness';
import { solve } from './bodyClock';
import { analyzeChronotype } from './chronotype';
import { wakeTargetFor } from './schedule';
import { buildNights } from './sessions';
import { debtOnDate } from './sleepDebt';
import { estimateSleepNeed } from './sleepNeed';
import { clamp, DAY, dateKey, HOUR, livingDay, MINUTE, minutesOfDay, normalizeMinutes } from './time';
import { AlertnessCheckIn, isSleepStage, SleepDataset } from './types';
import {
  boostFrom,
  buildSignalSource,
  DEFAULT_WEIGHTS,
  EnergyWeights,
  NO_WEIGHTS,
  SIGNAL_KEYS,
  SignalKey,
  SignalSource,
  WEIGHT_BOUNDS,
  WEIGHT_PRIOR_SD,
} from './watchSignals';
import { correctedMetrics } from './wakeDetect';

export { livingDay };

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
export const CALIBRATION_VERSION = 2;

/**
 * Which model is in effect:
 * - population       sleep timing only, population body clock (the forecast before any learning)
 * - personal         sleep timing only, body clock fitted to the check-ins
 * - watch            population body clock + the watch signals at their default weights
 * - personal+watch   body clock and signal weights fitted together
 */
export type CalibrationTier = 'population' | 'personal' | 'watch' | 'personal+watch';

export interface TierScore {
  /** Mean absolute KSS error on held-out check-ins. */
  mae: number;
  /** Share of held-out check-ins predicted within one KSS point (0–1). */
  withinOne: number;
}

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
  /** The model in effect (only when the fit had watch signals to work with). */
  tier?: CalibrationTier;
  /** Weights of the watch signals in effect, and the personal estimate even when it isn't applied. */
  weights?: EnergyWeights;
  fittedWeights?: EnergyWeights;
  /** How each model did on held-out check-ins. */
  tiers?: Record<CalibrationTier, TierScore>;
  /** How much each signal moved the predictions (SD, energy points) under the weights in effect. */
  signalUse?: Partial<Record<SignalKey | 'clock', number>>;
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
  /** What the watch adds (watchSignals.ts). Without it the fit is sleep timing only. */
  signals?: SignalSource;
}

type FullParams = Required<CircadianParams>;

const POPULATION: FullParams = { ...DEFAULT_CIRCADIAN, kssOffset: 0 };
/** Switches C off, leaving S + W − debt penalty. */
const NO_CIRCADIAN: CircadianParams = { phaseShiftMin: 0, ampScale: 0, dipScale: 0, kssOffset: 0 };
const STEP = 5 * MINUTE;

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
  /** Angles of the 24h and 12h circadian terms at the check-in, before any phase shift. */
  a24: number;
  a12: number;
  /** Watch signals at the check-in (SIGNAL_KEYS order) and the body-clock shift (minutes). */
  x: number[];
  shift: number;
}

/** Radians of 24h / 12h rhythm per minute of phase shift. */
const K24 = (2 * Math.PI) / (60 * 24);
const K12 = (2 * Math.PI) / (60 * 12);
const NO_SIGNALS = SIGNAL_KEYS.map(() => 0);

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
 * Builds a predictor of KSS at arbitrary times from recorded sleep (and, with `signals`, what the
 * watch adds). Returns undefined at times the model can't speak to (asleep, or the preceding sleep
 * wasn't recorded).
 */
export function createKssPredictor(sleeps: Interval[], midSleepMin: number, debtAt: (t: number) => number, signals?: SignalSource) {
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
    return {
      t,
      kss,
      base: p.alertness,
      a24: (2 * Math.PI * (h - acro0)) / 24,
      a12: (2 * Math.PI * (h - dip0)) / 12,
      x: signals ? signals.features(t) : NO_SIGNALS,
      shift: signals ? signals.clockShiftMin(t) : 0,
    };
  };

  return {
    sample,
    /** Model KSS at `time` with the given parameters (and weights for the watch signals). */
    kssAt(time: number, params: CircadianParams = DEFAULT_CIRCADIAN, weights: EnergyWeights = NO_WEIGHTS): number | undefined {
      const s = sample(time, NaN);
      return s ? predict(s, { p: full(params), w: weights }) : undefined;
    },
  };
}

function full(p: CircadianParams): FullParams {
  return { phaseShiftMin: p.phaseShiftMin, ampScale: p.ampScale, dipScale: p.dipScale, kssOffset: p.kssOffset ?? 0 };
}

/** Everything a fit can move: the body-clock shape and the weights of the watch signals. */
interface Model {
  p: FullParams;
  w: EnergyWeights;
}

/** Circadian term without the KSS offset: same formula as alertness.circadian(). */
function circ(s: Sample, m: Model): number {
  const phase = m.p.phaseShiftMin + m.w.clockTrust * s.shift;
  return TPM.circAmp * m.p.ampScale * Math.cos(s.a24 - phase * K24) - TPM.dipAmp * m.p.dipScale * Math.cos(s.a12 - phase * K12);
}

function predict(s: Sample, m: Model): number {
  return kssFromAlertness(s.base + circ(s, m) + boostFrom(s.x, m.w) - m.p.kssOffset / KSS_PER_ALERTNESS);
}

// ---------------------------------------------------------------------------
// MAP fit
// ---------------------------------------------------------------------------

const WEIGHT_KEYS = [...SIGNAL_KEYS, 'clockTrust'] as const;

function priorCost(m: Model, learnWeights: boolean): number {
  const { p, w } = m;
  let c =
    (p.phaseShiftMin / PRIOR.phaseSdMin) ** 2 +
    ((p.ampScale - 1) / PRIOR.ampSd) ** 2 +
    ((p.dipScale - 1) / PRIOR.dipSd) ** 2 +
    (p.kssOffset / PRIOR.offsetSd) ** 2;
  if (learnWeights) for (const k of WEIGHT_KEYS) c += ((w[k] - DEFAULT_WEIGHTS[k]) / WEIGHT_PRIOR_SD[k]) ** 2;
  return c;
}

function cost(samples: Sample[], m: Model, learnWeights: boolean): number {
  let sse = 0;
  for (const s of samples) sse += (predict(s, m) - s.kss) ** 2;
  return sse / NOISE_SD ** 2 + priorCost(m, learnWeights);
}

/** Phase shifts tried before the refinement (minutes). */
const PHASES: number[] = [];
for (let v = PARAM_BOUNDS.phaseShiftMin[0]; v <= PARAM_BOUNDS.phaseShiftMin[1]; v += 15) PHASES.push(v);

/**
 * For a fixed phase the rating is linear in everything else (ignoring the 1–9 clamp):
 *   kss = [10.6 − 0.6·base] − 0.6·2.5·amp·cos24 + 0.6·1.4·dip·cos12 + offset − 0.6·Σ wₖxₖ
 * so amplitude, dip, offset — and the signal weights when they are learned — come from one ridge
 * regression with the priors as the penalty. Returns the best such model over the phase grid.
 */
function ridgeStart(samples: Sample[], weights: EnergyWeights, learnWeights: boolean): { model: Model; cost: number } {
  const K = KSS_PER_ALERTNESS;
  const P = 3 + (learnWeights ? SIGNAL_KEYS.length : 0);
  const prior0 = [1, 1, 0, ...(learnWeights ? SIGNAL_KEYS.map((k) => DEFAULT_WEIGHTS[k]) : [])];
  const penalty = [1 / PRIOR.ampSd ** 2, 1 / PRIOR.dipSd ** 2, 1 / PRIOR.offsetSd ** 2, ...(learnWeights ? SIGNAL_KEYS.map((k) => 1 / WEIGHT_PRIOR_SD[k] ** 2) : [])];
  // What the rating leaves once sleep pressure (and weights that stay fixed) are accounted for.
  const target = samples.map((s) => s.kss - (KSS_AT_ZERO - K * (s.base + (learnWeights ? 0 : boostFrom(s.x, weights)))));
  const inv = 1 / NOISE_SD ** 2;
  let best: { model: Model; cost: number } = { model: { p: { ...POPULATION }, w: { ...weights } }, cost: Infinity };
  best.cost = cost(samples, best.model, learnWeights);
  const z = new Array<number>(P).fill(0);
  for (const phase of PHASES) {
    const M = Array.from({ length: P }, (_, i) => Array.from({ length: P }, (_, j) => (i === j ? penalty[i] : 0)));
    const rhs = penalty.map((pen, i) => pen * prior0[i]);
    for (let n = 0; n < samples.length; n++) {
      const s = samples[n];
      const ph = phase + weights.clockTrust * s.shift;
      z[0] = -K * TPM.circAmp * Math.cos(s.a24 - ph * K24);
      z[1] = K * TPM.dipAmp * Math.cos(s.a12 - ph * K12);
      z[2] = 1;
      if (learnWeights) for (let k = 0; k < s.x.length; k++) z[3 + k] = -K * s.x[k];
      for (let i = 0; i < P; i++) {
        rhs[i] += z[i] * target[n] * inv;
        for (let j = i; j < P; j++) M[i][j] += z[i] * z[j] * inv;
      }
    }
    for (let i = 0; i < P; i++) for (let j = 0; j < i; j++) M[i][j] = M[j][i];
    const beta = solve(M, rhs);
    if (!beta) continue;
    const m: Model = {
      p: {
        phaseShiftMin: phase,
        ampScale: clamp(beta[0], PARAM_BOUNDS.ampScale[0], PARAM_BOUNDS.ampScale[1]),
        dipScale: clamp(beta[1], PARAM_BOUNDS.dipScale[0], PARAM_BOUNDS.dipScale[1]),
        kssOffset: clamp(beta[2], PARAM_BOUNDS.kssOffset[0], PARAM_BOUNDS.kssOffset[1]),
      },
      w: { ...weights },
    };
    if (learnWeights) {
      SIGNAL_KEYS.forEach((k, i) => {
        m.w[k] = clamp(beta[3 + i], WEIGHT_BOUNDS[k][0], WEIGHT_BOUNDS[k][1]);
      });
    }
    const c = cost(samples, m, learnWeights);
    if (c < best.cost) best = { model: m, cost: c };
  }
  return best;
}

type Key = keyof FullParams;
const KEYS: Key[] = ['phaseShiftMin', 'ampScale', 'dipScale', 'kssOffset'];
const START_STEP: FullParams = { phaseShiftMin: 15, ampScale: 0.05, dipScale: 0.125, kssOffset: 0.25 };
const MIN_STEP: FullParams = { phaseShiftMin: 1, ampScale: 0.005, dipScale: 0.01, kssOffset: 0.01 };
const W_START_STEP: EnergyWeights = { hrv: 0.1, rhr: 0.1, resp: 0.1, deep: 0.1, waso: 0.1, dayHr: 0.1, caffeine: 0.5, clockTrust: 0.25 };
const W_MIN_STEP: EnergyWeights = { hrv: 0.01, rhr: 0.01, resp: 0.01, deep: 0.01, waso: 0.01, dayHr: 0.01, caffeine: 0.05, clockTrust: 0.05 };

/**
 * Fits the body-clock shape — and, with `learnWeights`, the weights of the watch signals — to the
 * samples. Without it the weights stay at `weights` (NO_WEIGHTS = the fit as it was before the watch
 * signals existed).
 */
function fitModel(samples: Sample[], weights: EnergyWeights, learnWeights: boolean): Model {
  // Closed-form start for each phase on a grid, then a pattern search over everything that may move
  // (it also picks up what the closed form ignores: the 1–9 clamp, the bounds and the clock trust).
  const start = ridgeStart(samples, weights, learnWeights);
  let best = start.model;
  let bestCost = start.cost;
  const step = { ...START_STEP };
  const wStep = { ...W_START_STEP };
  const moves: { get: () => number; set: (m: Model, v: number) => void; step: () => number; lo: number; hi: number }[] = [
    ...KEYS.map((k) => ({
      get: () => best.p[k],
      set: (m: Model, v: number) => {
        m.p[k] = v;
      },
      step: () => step[k],
      lo: PARAM_BOUNDS[k][0],
      hi: PARAM_BOUNDS[k][1],
    })),
    ...(learnWeights
      ? WEIGHT_KEYS.map((k) => ({
          get: () => best.w[k],
          set: (m: Model, v: number) => {
            m.w[k] = v;
          },
          step: () => wStep[k],
          lo: WEIGHT_BOUNDS[k][0],
          hi: WEIGHT_BOUNDS[k][1],
        }))
      : []),
  ];
  for (let iter = 0; iter < 600; iter++) {
    let improved = false;
    for (const mv of moves) {
      for (const dir of [1, -1]) {
        const cur = mv.get();
        const v = clamp(cur + dir * mv.step(), mv.lo, mv.hi);
        if (v === cur) continue;
        const cand: Model = { p: { ...best.p }, w: { ...best.w } };
        mv.set(cand, v);
        const c = cost(samples, cand, learnWeights);
        if (c < bestCost - 1e-12) {
          bestCost = c;
          best = cand;
          improved = true;
          break;
        }
      }
    }
    if (!improved) {
      const done = KEYS.every((k) => step[k] <= MIN_STEP[k]) && (!learnWeights || WEIGHT_KEYS.every((k) => wStep[k] <= W_MIN_STEP[k]));
      if (done) break;
      for (const k of KEYS) step[k] = Math.max(MIN_STEP[k], step[k] / 2);
      for (const k of WEIGHT_KEYS) wStep[k] = Math.max(W_MIN_STEP[k], wStep[k] / 2);
    }
  }
  const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  const w = { ...best.w };
  if (learnWeights) for (const k of WEIGHT_KEYS) w[k] = round(w[k], 3);
  return {
    p: {
      phaseShiftMin: Math.round(best.p.phaseShiftMin),
      ampScale: round(best.p.ampScale, 3),
      dipScale: round(best.p.dipScale, 3),
      kssOffset: round(best.p.kssOffset, 2),
    },
    w,
  };
}

/** Held-out absolute errors: leave-one-out for small n, otherwise 5 interleaved folds. */
function crossValidatedErrors(samples: Sample[], fit: (train: Sample[]) => Model): number[] {
  const n = samples.length;
  const k = n <= 20 ? n : 5;
  const errors = new Array<number>(n);
  for (let f = 0; f < k; f++) {
    const m = fit(samples.filter((_, i) => i % k !== f));
    samples.forEach((s, i) => {
      if (i % k === f) errors[i] = Math.abs(predict(s, m) - s.kss);
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
  const predictor = createKssPredictor(input.sleeps, input.midSleepMin, (t) => input.debtByDate?.[livingDay(t)] ?? input.debtMin, input.signals);
  const samples: Sample[] = [];
  for (const c of checkins) {
    const s = predictor.sample(c.time, c.kss);
    if (s) samples.push(s);
  }
  return { samples, skipped: checkins.length - samples.length };
}

interface Candidate {
  tier: CalibrationTier;
  model: Model;
  /** Held-out absolute errors (models without fitted parts: plain errors). */
  errors: number[];
}

/** Lowest held-out error wins; within a hair of each other, the earlier candidate in `order` does. */
function pickCandidate(order: Candidate[]): Candidate {
  const maes = order.map((c) => meanOf(c.errors));
  const hits = order.map((c) => withinOne(c.errors));
  const bestMae = Math.min(...maes);
  const bestHits = Math.max(...hits);
  const i = order.findIndex((_, k) => maes[k] <= bestMae + 0.02 && hits[k] >= bestHits - 0.02);
  // No model is best on both measures: stay with the last (simplest) one.
  return order[i >= 0 ? i : order.length - 1];
}

export function fitCircadian(input: CalibrationInput): CalibrationResult | undefined {
  const { samples, skipped } = prepareSamples(input);
  const n = samples.length;
  if (n < LEARNING.minCheckins) return undefined;
  const errorsOf = (m: Model) => samples.map((s) => Math.abs(predict(s, m) - s.kss));
  const useWatch = !!input.signals;

  // Sleep timing only: the population model, and the personal body-clock fit.
  const population: Candidate = { tier: 'population', model: { p: POPULATION, w: NO_WEIGHTS }, errors: [] };
  population.errors = errorsOf(population.model);
  const personal: Candidate = {
    tier: 'personal',
    model: fitModel(samples, NO_WEIGHTS, false),
    errors: crossValidatedErrors(samples, (train) => fitModel(train, NO_WEIGHTS, false)),
  };
  // With the watch: default weights on the population clock, and everything fitted together.
  let watch: Candidate | undefined;
  let personalWatch: Candidate | undefined;
  if (useWatch) {
    watch = { tier: 'watch', model: { p: POPULATION, w: DEFAULT_WEIGHTS }, errors: [] };
    watch.errors = errorsOf(watch.model);
    personalWatch = {
      tier: 'personal+watch',
      model: fitModel(samples, DEFAULT_WEIGHTS, true),
      errors: crossValidatedErrors(samples, (train) => fitModel(train, DEFAULT_WEIGHTS, true)),
    };
  }
  // A model that uses the watch is preferred when it predicts held-out check-ins as well.
  const chosen = pickCandidate([personalWatch, watch, personal, population].filter((c): c is Candidate => !!c));
  // The personal estimate shown even while it isn't applied.
  const bestPersonal = personalWatch ? pickCandidate([personalWatch, personal]) : personal;
  const applied = chosen.tier === 'personal' || chosen.tier === 'personal+watch';

  const coverage: Record<TimeOfDay, number> = { morning: 0, afternoon: 0, evening: 0 };
  for (const s of samples) coverage[timeOfDay(s.t)]++;
  const days = new Set(samples.map((s) => livingDay(s.t))).size;
  const confidence = n >= LEARNING.confidentCheckins && days >= 7 ? 'high' : n >= 12 ? 'medium' : 'low';
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const score = (c: Candidate): TierScore => ({ mae: round2(meanOf(c.errors)), withinOne: round2(withinOne(c.errors)) });

  return {
    params: applied ? chosen.model.p : { ...DEFAULT_CIRCADIAN },
    fitted: bestPersonal.model.p,
    applied,
    n,
    maeBefore: round2(meanOf(population.errors)),
    maeAfter: round2(meanOf(bestPersonal.errors)),
    accuracy: Math.round(100 * withinOne(chosen.errors)),
    accuracyBefore: Math.round(100 * withinOne(population.errors)),
    withinOne: round2(withinOne(chosen.errors)),
    withinOneBefore: round2(withinOne(population.errors)),
    days,
    confidence,
    coverage,
    skipped,
    fittedAt: input.now,
    version: CALIBRATION_VERSION,
    ...(useWatch
      ? {
          tier: chosen.tier,
          weights: { ...chosen.model.w },
          fittedWeights: { ...personalWatch!.model.w },
          tiers: { population: score(population), personal: score(personal), watch: score(watch!), 'personal+watch': score(personalWatch!) },
          signalUse: signalUse(samples, chosen.model.w),
        }
      : {}),
  };
}

/**
 * How much each signal moved the predictions over these check-ins: the spread (SD) of weight × signal,
 * in energy points. A signal that never varied, or has no weight, shows 0.
 */
function signalUse(samples: Sample[], w: EnergyWeights): Partial<Record<SignalKey | 'clock', number>> {
  const out: Partial<Record<SignalKey | 'clock', number>> = {};
  const spread = (xs: number[]) => {
    const m = meanOf(xs);
    return Math.sqrt(meanOf(xs.map((x) => (x - m) ** 2)));
  };
  SIGNAL_KEYS.forEach((k, i) => {
    out[k] = Math.round(spread(samples.map((s) => w[k] * s.x[i])) * ENERGY_PER_ALERTNESS * 10) / 10;
  });
  const none: Model = { p: POPULATION, w: NO_WEIGHTS };
  const shifted: Model = { p: POPULATION, w: { ...NO_WEIGHTS, clockTrust: w.clockTrust } };
  out.clock = Math.round(spread(samples.map((s) => circ(s, shifted) - circ(s, none))) * ENERGY_PER_ALERTNESS * 10) / 10;
  return out;
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
  /** What the watch adds over the same period. */
  signals: SignalSource;
}

/** Sleep, phase anchor and debt as the forecast sees them (same pipeline as analysis.ts). */
export function calibrationContext(data: SleepDataset, now: number, opts: { preferredOrigins?: string[]; sleepsFrom?: number } = {}): CalibrationContext {
  const { profile, dayLogs } = data;
  const day = livingDay(now);
  const { metrics } = correctedMetrics(
    data,
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
  const defaultWake = wakeTargetFor(profile, day).wakeMin;
  const signals = buildSignalSource({
    nights,
    vitals: data.vitals,
    daily: data.daily,
    caffeine: data.caffeine,
    halfLifeH: profile.caffeineHalfLifeH,
    sleeps,
    now,
    habitualOnsetMin: chronotype.habitual?.onsetMin ?? normalizeMinutes(defaultWake - needMin),
    habitualWakeMin: chronotype.habitual?.wakeMin ?? defaultWake,
    clockDays: LEARNING.maxAgeDays,
  });
  return { sleeps, midSleepMin, needMin, debtOn, signals };
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
  return { checkins, sleeps: ctx.sleeps, midSleepMin: ctx.midSleepMin, debtMin: ctx.debtOn(livingDay(now)), now, debtByDate, since: opts.since, signals: ctx.signals };
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
  return r < 100 ? `about ${r} min` : `about ${Math.round(r / 30) / 2}h`;
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
          ? 'Your whole body clock runs later than your sleep times suggest, so peak focus and the evening second wind come later too — and early nights may be hard.'
          : "Your whole body clock runs earlier than your sleep times suggest: you're sharpest early and fade sooner in the evening.",
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
