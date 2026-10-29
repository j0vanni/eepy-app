/**
 * "What if?" simulator: replays tonight and tomorrow for a hypothetical bedtime, wake time, nap and
 * extra caffeine, using the same models as the rest of the engine —
 *   - tonight's sleep from personal latency, efficiency and cycle length (a synthetic staged night),
 *   - tomorrow-morning sleep debt with that night added,
 *   - tomorrow's energy from the three-process model,
 *   - the nap's effect on bedtime sleepiness from the two-process model,
 *   - caffeine from the pharmacokinetic model,
 *   - an expected sleep score from scoring the synthetic night.
 * The baseline is tonight's plan with no extra nap or caffeine.
 */
import { AlertnessPoint, bedtimeDelayMin, forecastEnergy, Interval } from './alertness';
import type { Analysis } from './analysis';
import { caffeineDuringEarlySleep } from './caffeine';
import { computeSessionMetrics, Night, SessionMetrics } from './sessions';
import { computeSleepDebt, DebtCategory } from './sleepDebt';
import { scoreSleep, SleepScore } from './sleepScore';
import { mean, median } from './stats';
import { clamp, clockDiff, dateKey, HOUR, MINUTE, minutesOfDay } from './time';
import { CaffeineDose, isSleepStage, SleepDataset, SleepSession, Stage, StageSegment } from './types';

export interface Scenario {
  bedtime: number;
  wake: number;
  /** A nap today: when you lie down and how long until the alarm (minutes). */
  nap?: { start: number; minutes: number };
  /** Drinks on top of what's already logged. */
  caffeine?: { time: number; mg: number }[];
}

/** Model constants. Caffeine/early-bedtime effects are deliberately modest approximations. */
export const SIM = {
  /** Focus zone: within this many energy points of the planned day's peak (as on Today)… */
  focusBelowPeak: 6,
  /** …but never below this energy. */
  minFocusEnergy: 50,
  /** A wake within this many minutes of a cycle boundary counts as "on the boundary". */
  boundaryToleranceMin: 15,
  /** Early-sleep caffeine below this (mg) is treated as harmless. */
  caffeineFreeMg: 20,
  /** Per mg above the free amount: extra minutes to fall asleep / awake at night, share of deep sleep lost. */
  caffeineLatencyPerMg: 0.1,
  caffeineWasoPerMg: 0.15,
  caffeineDeepLossPerMg: 0.002,
  maxCaffeineLatencyMin: 30,
  maxCaffeineWasoMin: 45,
  maxDeepLoss: 0.35,
  maxNapLatencyMin: 90,
  /** Lights out more than this long before your usual sleep onset lands in the wake-maintenance zone… */
  earlyBedZoneMin: 60,
  /** …and this share of the time beyond it is spent lying awake. */
  earlyBedLatencyShare: 0.5,
  maxEarlyBedLatencyMin: 120,
  /** Grid of the energy simulation (minutes). */
  stepMin: 5,
};

export interface TomorrowEnergy {
  /** Awake points from the scenario's wake-up to tomorrow evening. */
  points: AlertnessPoint[];
  avgEnergy: number;
  focusHours: number;
  peak?: { t: number; energy: number };
  dip?: { t: number; energy: number };
}

export interface ScenarioOutcome {
  /** The scenario as simulated (bedtime/wake clamped to something possible). */
  scenario: Scenario;
  sleep: {
    timeInBedMin: number;
    /** Expected time to fall asleep, including the nap / caffeine / early-bedtime effects below. */
    latencyMin: number;
    latencyParts: { usualMin: number; napMin: number; caffeineMin: number; earlyBedMin: number };
    onset: number;
    sleepMin: number;
    /** Sleep period (onset → wake) in cycles, fractional. */
    cycles: number;
    /** Minutes from the nearest cycle boundary at wake-up (positive = past it, into a new cycle). */
    offBoundaryMin: number;
    onBoundary: boolean;
    /** Nearest wake times that land on a cycle boundary. */
    boundaryWakes: { earlier: number; later: number };
  };
  /** Minutes asleep during the nap. */
  napSleepMin: number;
  /** How much later you'd get sleepy tonight because of the nap (two-process model). */
  napDelayMin: number;
  /** Peak caffeine (mg) in the first 3 hours after bedtime. */
  caffeineMg: number;
  debtMin: number;
  debtCategory: DebtCategory;
  score: SleepScore;
  /** The synthetic night that was scored. */
  night: SessionMetrics;
  tomorrow: TomorrowEnergy;
}

export interface SimulationDelta {
  sleepMin: number;
  cycles: number;
  latencyMin: number;
  debtMin: number;
  avgEnergy: number;
  focusHours: number;
  caffeineMg: number;
  napDelayMin: number;
  score: number;
  /** Minutes the afternoon dip moves (positive = later), when both days have one. */
  dipShiftMin?: number;
}

export interface SimulationResult {
  baseline: ScenarioOutcome;
  scenario: ScenarioOutcome;
  /** scenario − baseline */
  delta: SimulationDelta;
  /** Shared time axis for charting both energy curves. */
  range: { from: number; to: number };
  /** Energy at or above which time counts as focus zone (from the planned day's peak). */
  focusEnergy: number;
}

// Per-cycle deep/REM minutes for a 90-minute cycle: deep sleep is front-loaded, REM back-loaded.
const DEEP_PLAN = [40, 30, 15, 7, 3];
const REM_PLAN = [9, 17, 24, 29, 33, 36];

interface Ctx {
  a: Analysis;
  caffeineRef: CaffeineDose[];
  profileRef: SleepDataset['profile'];
  doses: CaffeineDose[];
  halfLifeH: number;
  needMin: number;
  cycleMin: number;
  efficiency: number;
  napLatencyMin: number;
  habitualOnsetMin?: number;
  /** A rested schedule (need met, today's wake time) — the nap delay counts only pressure removed below it. */
  reference: Interval[];
  tomorrowBed: number;
  stage: { deepScale: number; remScale: number; awakenings: number };
  focusEnergy: number;
  baseline: ScenarioOutcome;
}

/** Tonight's plan with nothing extra. Bedtime never lies in the past. */
export function baselineScenario(a: Analysis): Scenario {
  const step = 5 * MINUTE;
  return { bedtime: Math.max(a.tonight.bedtime, Math.ceil(a.now / step) * step), wake: a.tonight.wake };
}

function overlayAwake(segs: StageSegment[], at: number, dur: number): StageSegment[] {
  const out: StageSegment[] = [];
  for (const s of segs) {
    if (at >= s.end || at + dur <= s.start) {
      out.push(s);
      continue;
    }
    if (s.start < at) out.push({ ...s, end: at });
    out.push({ stage: 'awake', start: Math.max(at, s.start), end: Math.min(at + dur, s.end) });
    if (s.end > at + dur) out.push({ ...s, start: at + dur });
  }
  return out;
}

/** A staged night shaped like the person's own: cycles of their length, their deep/REM shares and awakenings. */
function syntheticNight(
  ctx: Pick<Ctx, 'cycleMin' | 'stage'>,
  bedtime: number,
  onset: number,
  wake: number,
  wasoMin: number,
  deepFactor: number,
): SleepSession {
  const { cycleMin } = ctx;
  const k90 = cycleMin / 90;
  let segs: StageSegment[] = [];
  let t = onset;
  let cycles = 0;
  for (let k = 0; t < wake; k++) {
    let deep = (DEEP_PLAN[k] ?? 0) * k90 * ctx.stage.deepScale * deepFactor;
    let rem = REM_PLAN[Math.min(k, REM_PLAN.length - 1)] * k90 * ctx.stage.remScale;
    const room = cycleMin - 10;
    if (deep + rem > room) {
      const f = room / (deep + rem);
      deep *= f;
      rem *= f;
    }
    const light = cycleMin - deep - rem;
    const parts: [Stage, number][] = [
      ['light', light * 0.6],
      ['deep', deep],
      ['light', light * 0.4],
      ['rem', rem],
    ];
    for (const [stage, mins] of parts) {
      if (mins <= 0 || t >= wake) continue;
      const end = Math.min(wake, t + mins * MINUTE);
      segs.push({ stage, start: t, end });
      t = end;
    }
    cycles++;
  }
  // Night-time waking, spread evenly (awakenings tend to come at cycle transitions).
  let n = Math.min(cycles, Math.round(ctx.stage.awakenings));
  if (wasoMin / Math.max(1, n) < 2.5) n = Math.floor(wasoMin / 2.5);
  if (n > 0) {
    const dur = (wasoMin / n) * MINUTE;
    const period = wake - onset;
    for (let i = 1; i <= n; i++) segs = overlayAwake(segs, onset + (period * i) / (n + 1) - dur / 2, dur);
  }
  const stages: StageSegment[] = onset > bedtime ? [{ stage: 'awake', start: bedtime, end: onset }, ...segs] : segs;
  return { id: `sim-${bedtime}-${wake}`, source: 'manual', start: bedtime, end: wake, stages, kind: 'main' };
}

function stageProfile(a: Analysis, needMin: number, cycleMin: number, efficiency: number): Ctx['stage'] {
  const mains = a.nights
    .slice(-30)
    .map((n) => n.main)
    .filter((m): m is SessionMetrics => !!m);
  const awakenings = mains.length >= 5 ? median(mains.map((m) => m.awakenings)) : 2;
  const staged = mains.filter((m) => m.stagePct);
  if (staged.length < 5) return { deepScale: 1, remScale: 1, awakenings };
  // Scale the generic cycle plan so a typical night reproduces the person's own deep/REM shares.
  const plain = { cycleMin, stage: { deepScale: 1, remScale: 1, awakenings } };
  const onset = 0;
  const wake = onset + (needMin / efficiency) * MINUTE;
  const typical = computeSessionMetrics(syntheticNight(plain, onset, onset, wake, ((wake - onset) / MINUTE) * (1 - efficiency), 1))!;
  const deep = median(staged.map((m) => m.stagePct!.deep));
  const rem = median(staged.map((m) => m.stagePct!.rem));
  return {
    deepScale: clamp(deep / Math.max(0.01, typical.stagePct!.deep), 0.3, 2.5),
    remScale: clamp(rem / Math.max(0.01, typical.stagePct!.rem), 0.3, 2.5),
    awakenings,
  };
}

const contexts = new WeakMap<Analysis, Ctx>();

function contextFor(a: Analysis, data: SleepDataset): Ctx {
  const cached = contexts.get(a);
  if (cached && cached.caffeineRef === data.caffeine && cached.profileRef === data.profile) return cached;
  const needMin = a.need.needMin;
  const cycleMin = clamp(a.cycleMin, 60, 150);
  const efficiency = clamp(a.efficiency, 0.75, 0.97);
  const reference: Interval[] = [];
  for (let d = 0; d <= 4; d++) {
    const w = a.wakeTime - d * 24 * HOUR;
    reference.push({ start: w - needMin * MINUTE, end: w });
  }
  const ctx: Omit<Ctx, 'baseline'> = {
    a,
    caffeineRef: data.caffeine,
    profileRef: data.profile,
    doses: data.caffeine.filter((d) => d.time > a.now - 36 * HOUR && d.time <= a.now),
    halfLifeH: data.profile.caffeineHalfLifeH,
    needMin,
    cycleMin,
    efficiency,
    napLatencyMin: clamp(Math.round(a.latencyMin / 2), 5, 10),
    habitualOnsetMin: a.chronotype.habitual?.onsetMin,
    reference,
    tomorrowBed: a.tonight.bedtime + 24 * HOUR,
    stage: stageProfile(a, needMin, cycleMin, efficiency),
    focusEnergy: Infinity,
  };
  // The baseline is simulated once; its peak sets the focus threshold both curves are measured against.
  const first = simulateOutcome(ctx, baselineScenario(a));
  ctx.focusEnergy = clamp(Math.round((first.tomorrow.peak?.energy ?? 0) - SIM.focusBelowPeak), SIM.minFocusEnergy, 100);
  const baseline = { ...first, tomorrow: { ...first.tomorrow, focusHours: focusHours(first.tomorrow.points, ctx.focusEnergy) } };
  const full: Ctx = { ...ctx, baseline };
  contexts.set(a, full);
  return full;
}

function focusHours(points: AlertnessPoint[], threshold: number): number {
  return (points.filter((p) => p.energy >= threshold).length * SIM.stepMin) / 60;
}

/** Replaces (or adds) the night ending on the synthetic night's wake date, and adds the nap to its own day. */
function nightsWith(nights: Night[], main: SessionMetrics, napSleepMin: number, napDate?: string): Night[] {
  const out = nights.map((n) => {
    let next = n;
    if (napDate && n.wakeDate === napDate) next = { ...next, totalSleepMin: next.totalSleepMin + napSleepMin };
    if (n.wakeDate === main.wakeDate) {
      next = { ...next, main, totalSleepMin: next.totalSleepMin - (next.main?.totalSleepMin ?? 0) + main.totalSleepMin };
    }
    return next;
  });
  if (!out.some((n) => n.wakeDate === main.wakeDate)) out.push({ wakeDate: main.wakeDate, main, naps: [], totalSleepMin: main.totalSleepMin });
  return out;
}

function tomorrowEnergy(ctx: Omit<Ctx, 'baseline'>, sleeps: Interval[], wake: number, debtMin: number): TomorrowEnergy {
  const { a } = ctx;
  const f = forecastEnergy({
    sleeps,
    now: wake,
    wakeTime: wake,
    bedtime: ctx.tomorrowBed,
    nextWake: ctx.tomorrowBed + ctx.needMin * MINUTE,
    midSleepMin: a.habitualMidSleepMin,
    debtMin,
    circadian: a.circadian,
  });
  const points = f.points.filter((p) => !p.asleep && p.t >= wake && p.t <= ctx.tomorrowBed);
  // Peak after sleep inertia has worn off.
  const settled = points.filter((p) => p.t >= wake + HOUR);
  const peak = settled.length ? settled.reduce((b, p) => (p.energy > b.energy ? p : b)) : undefined;
  return {
    points,
    avgEnergy: points.length ? mean(points.map((p) => p.energy)) : 0,
    focusHours: focusHours(points, ctx.focusEnergy),
    peak: peak ? { t: peak.t, energy: peak.energy } : undefined,
    dip: f.dip ? { t: f.dip.t, energy: f.dip.energy } : undefined,
  };
}

function simulateOutcome(ctx: Omit<Ctx, 'baseline'>, input: Scenario): ScenarioOutcome {
  const { a } = ctx;
  const bedtime = Math.max(input.bedtime, a.now);
  const wake = Math.max(input.wake, bedtime + 60 * MINUTE);
  const tibMin = (wake - bedtime) / MINUTE;

  // The nap: asleep a few minutes after lying down, until the alarm (never past bedtime).
  let nap: Interval | undefined;
  let napDelayMin = 0;
  if (input.nap && input.nap.minutes > 0) {
    const start = input.nap.start + ctx.napLatencyMin * MINUTE;
    const end = Math.min(input.nap.start + input.nap.minutes * MINUTE, bedtime);
    if (end - start >= MINUTE) {
      nap = { start, end };
      napDelayMin = bedtimeDelayMin(a.sleeps, nap, bedtime, ctx.reference);
    }
  }
  const napSleepMin = nap ? (nap.end - nap.start) / MINUTE : 0;

  const extra: CaffeineDose[] = (input.caffeine ?? []).map((c, i) => ({ id: `sim-${i}`, time: c.time, mg: c.mg, label: '' }));
  const caffeineMg = caffeineDuringEarlySleep(extra.length ? [...ctx.doses, ...extra] : ctx.doses, bedtime, ctx.halfLifeH);
  const excessMg = Math.max(0, caffeineMg - SIM.caffeineFreeMg);

  // Time to fall asleep: your usual, plus what the nap, caffeine and an early lights-out add.
  const napMin = Math.min(SIM.maxNapLatencyMin, napDelayMin);
  const caffeineMin = Math.min(SIM.maxCaffeineLatencyMin, excessMg * SIM.caffeineLatencyPerMg);
  let earlyBedMin = 0;
  if (ctx.habitualOnsetMin !== undefined) {
    const usualOnsetLaterBy = clockDiff(minutesOfDay(bedtime + a.latencyMin * MINUTE), ctx.habitualOnsetMin);
    earlyBedMin = Math.min(SIM.maxEarlyBedLatencyMin, Math.max(0, usualOnsetLaterBy - SIM.earlyBedZoneMin) * SIM.earlyBedLatencyShare);
  }
  const latencyMin = Math.min(tibMin - 30, a.latencyMin + napMin + caffeineMin + earlyBedMin);
  const onset = bedtime + latencyMin * MINUTE;
  const periodMin = (wake - onset) / MINUTE;

  const wasoMin = Math.min(periodMin * 0.5, periodMin * (1 - ctx.efficiency) + Math.min(SIM.maxCaffeineWasoMin, excessMg * SIM.caffeineWasoPerMg));
  const deepFactor = 1 - Math.min(SIM.maxDeepLoss, excessMg * SIM.caffeineDeepLossPerMg);
  const night = computeSessionMetrics(syntheticNight(ctx, bedtime, onset, wake, wasoMin, deepFactor))!;

  const cycles = periodMin / ctx.cycleMin;
  const nearest = Math.round(cycles);
  const offBoundaryMin = periodMin - nearest * ctx.cycleMin;
  const lower = Math.max(1, Math.floor(cycles));
  const upper = Math.max(lower + 1, Math.ceil(cycles));

  const debt = computeSleepDebt(nightsWith(a.nights, night, napSleepMin, nap && dateKey(nap.end)), ctx.needMin, night.wakeDate);

  const sleeps = [...a.sleeps];
  if (nap) sleeps.push(nap);
  for (const s of night.segments) if (isSleepStage(s.stage)) sleeps.push({ start: s.start, end: s.end });

  return {
    scenario: { ...input, bedtime, wake },
    sleep: {
      timeInBedMin: tibMin,
      latencyMin,
      latencyParts: { usualMin: a.latencyMin, napMin, caffeineMin, earlyBedMin },
      onset,
      sleepMin: night.totalSleepMin,
      cycles,
      offBoundaryMin,
      onBoundary: nearest >= 1 && Math.abs(offBoundaryMin) <= SIM.boundaryToleranceMin,
      boundaryWakes: { earlier: onset + lower * ctx.cycleMin * MINUTE, later: onset + upper * ctx.cycleMin * MINUTE },
    },
    napSleepMin,
    napDelayMin,
    caffeineMg,
    debtMin: debt.debtMin,
    debtCategory: debt.category,
    score: scoreSleep(night, { needMin: ctx.needMin, age: a.age, habitualMidSleepMin: a.habitualMidSleepMin }),
    night,
    tomorrow: tomorrowEnergy(ctx, sleeps, wake, debt.debtMin),
  };
}

/**
 * Simulates tonight and tomorrow for `scenario` and for the baseline (tonight's plan, nothing extra).
 * The baseline is computed once per analysis and reused while you drag.
 */
export function simulateTomorrow(analysis: Analysis, data: SleepDataset, scenario: Scenario): SimulationResult {
  const ctx = contextFor(analysis, data);
  const { baseline } = ctx;
  const sim = simulateOutcome(ctx, scenario);
  const bDip = baseline.tomorrow.dip;
  const sDip = sim.tomorrow.dip;
  return {
    baseline,
    scenario: sim,
    delta: {
      sleepMin: sim.sleep.sleepMin - baseline.sleep.sleepMin,
      cycles: sim.sleep.cycles - baseline.sleep.cycles,
      latencyMin: sim.sleep.latencyMin - baseline.sleep.latencyMin,
      debtMin: sim.debtMin - baseline.debtMin,
      avgEnergy: sim.tomorrow.avgEnergy - baseline.tomorrow.avgEnergy,
      focusHours: sim.tomorrow.focusHours - baseline.tomorrow.focusHours,
      caffeineMg: sim.caffeineMg - baseline.caffeineMg,
      napDelayMin: sim.napDelayMin - baseline.napDelayMin,
      score: sim.score.total - baseline.score.total,
      dipShiftMin: bDip && sDip ? (sDip.t - bDip.t) / MINUTE : undefined,
    },
    range: { from: Math.min(baseline.scenario.wake, sim.scenario.wake), to: ctx.tomorrowBed },
    focusEnergy: ctx.focusEnergy,
  };
}
