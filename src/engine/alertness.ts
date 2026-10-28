/**
 * Energy forecasting based on the Three-Process Model of alertness (Åkerstedt & Folkard):
 *   alertness = S (homeostatic, drains while awake / recovers while asleep)
 *             + C (circadian rhythm, with a 12h harmonic for the post-lunch dip)
 *             + W (sleep inertia right after waking)
 * plus a penalty for chronic sleep debt, which the acute model does not capture.
 * Alertness is mapped onto the Karolinska Sleepiness Scale (1–9) and a 0–100 "energy" score.
 * Rates/amplitudes are tuned so a rested day reproduces the classic KSS profile: alert late morning,
 * a ~10-point early-afternoon dip, an evening "second wind", then a steep decline toward bedtime.
 */
import { clamp, HOUR, MINUTE, minutesOfDay } from './time';

export interface Interval {
  start: number;
  end: number;
}

export const TPM = {
  /** Lower / upper asymptotes of process S. */
  la: 2.4,
  ha: 14.3,
  /** Exponential rates per hour while awake (decline) and asleep (recovery). */
  wakeRate: 0.0353,
  sleepRate: 0.25,
  /** Circadian amplitude and default acrophase (h) for a 03:30 habitual mid-sleep. */
  circAmp: 2.5,
  acrophaseOffsetH: 13.3,
  /** 12h harmonic producing the early-afternoon dip, trough ≈ mid-sleep + 11h. */
  dipAmp: 1.4,
  dipOffsetH: 11,
  /** Sleep-inertia dissipation rate (per hour). */
  inertiaRate: 1.5,
  /** Alertness units lost per hour of sleep debt (capped). */
  debtPenaltyPerHour: 0.3,
  debtPenaltyMax: 3,
};

export interface AlertnessPoint {
  t: number;
  asleep: boolean;
  S: number;
  C: number;
  W: number;
  alertness: number;
  kss: number;
  energy: number;
}

/** Circadian component for a clock time, given the person's habitual mid-sleep (minutes after midnight). */
export function circadian(t: number, midSleepMin: number): number {
  const h = minutesOfDay(t) / 60;
  const mid = midSleepMin / 60;
  const acro = mid + TPM.acrophaseOffsetH;
  const dip = mid + TPM.dipOffsetH;
  return (
    TPM.circAmp * Math.cos((2 * Math.PI * (h - acro)) / 24) - TPM.dipAmp * Math.cos((2 * Math.PI * (h - dip)) / 12)
  );
}

/** Sleep inertia amplitude depends on how long (and therefore how deep) the sleep bout was. */
export function inertiaAmplitude(boutMin: number): number {
  if (boutMin < 5) return 0;
  if (boutMin <= 25) return 1.0; // power nap: light sleep only
  if (boutMin <= 75) return 3.2; // woken out of deep sleep — the groggy zone
  if (boutMin <= 110) return 1.8; // full cycle, waking from light/REM
  return 2.4; // main sleep
}

export function kssFromAlertness(a: number): number {
  return clamp(10.6 - 0.6 * a, 1, 9);
}

export function energyFromKss(kss: number): number {
  return clamp(((9 - kss) / 8) * 100, 0, 100);
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end + MINUTE) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export interface SimulateOptions {
  midSleepMin: number;
  debtMin?: number;
  stepMin?: number;
  /** Hours simulated before `from` so S converges from its unknown starting value. */
  burnInH?: number;
}

/** Simulates alertness on a regular grid from `from` to `to` given the asleep intervals. */
export function simulateAlertness(sleeps: Interval[], from: number, to: number, opts: SimulateOptions): AlertnessPoint[] {
  const step = (opts.stepMin ?? 5) * MINUTE;
  const dtH = step / HOUR;
  const burnIn = (opts.burnInH ?? 72) * HOUR;
  const intervals = mergeIntervals(sleeps);
  const debtPenalty = Math.min(TPM.debtPenaltyMax, ((opts.debtMin ?? 0) / 60) * TPM.debtPenaltyPerHour);

  let S = 12;
  let idx = 0;
  let lastWake = -Infinity;
  let boutStart = -Infinity;
  let lastBoutMin = 0;
  let wasAsleep = false;
  const out: AlertnessPoint[] = [];
  const start = Math.floor((from - burnIn) / step) * step;

  for (let t = start; t <= to; t += step) {
    while (idx < intervals.length && intervals[idx].end <= t) idx++;
    const asleep = idx < intervals.length && intervals[idx].start <= t && t < intervals[idx].end;
    if (asleep && !wasAsleep) boutStart = t;
    if (!asleep && wasAsleep) {
      lastWake = t;
      lastBoutMin = (t - boutStart) / MINUTE;
    }
    wasAsleep = asleep;

    if (asleep) S = TPM.ha - (TPM.ha - S) * Math.exp(-TPM.sleepRate * dtH);
    else S = TPM.la + (S - TPM.la) * Math.exp(-TPM.wakeRate * dtH);

    if (t < from) continue;
    const C = circadian(t, opts.midSleepMin);
    const W = asleep ? 0 : -inertiaAmplitude(lastBoutMin) * Math.exp((-TPM.inertiaRate * (t - lastWake)) / HOUR);
    const alertness = S + C + W - (asleep ? 0 : debtPenalty);
    const kss = kssFromAlertness(alertness);
    out.push({ t, asleep, S, C, W, alertness, kss, energy: energyFromKss(kss) });
  }
  return out;
}

export interface EnergyForecast {
  points: AlertnessPoint[];
  now?: AlertnessPoint;
  wakeTime: number;
  bedtime: number;
  peaks: { t: number; energy: number }[];
  dip?: { t: number; energy: number; start: number; end: number };
  focusWindows: Interval[];
  /** True when last night wasn't synced yet and a habitual night was assumed. */
  assumedLastNight: boolean;
}

export interface ForecastInput {
  /** Recorded sleep intervals (stage-level, asleep only). */
  sleeps: Interval[];
  now: number;
  wakeTime: number;
  bedtime: number;
  nextWake: number;
  midSleepMin: number;
  debtMin: number;
  assumedLastNight?: boolean;
}

export function forecastEnergy(input: ForecastInput): EnergyForecast {
  const { now, wakeTime, bedtime, nextWake } = input;
  const sleeps = [...input.sleeps];
  if (bedtime > now) sleeps.push({ start: bedtime, end: nextWake });
  const to = bedtime + 90 * MINUTE;
  const points = simulateAlertness(sleeps, wakeTime, to, { midSleepMin: input.midSleepMin, debtMin: input.debtMin });

  const awake = points.filter((p) => !p.asleep && p.t <= bedtime);
  const settled = awake.filter((p) => p.t >= wakeTime + 60 * MINUTE);

  // Main afternoon dip: lowest energy between wake+4h and bedtime−4h.
  const dipRange = settled.filter((p) => p.t >= wakeTime + 4 * HOUR && p.t <= bedtime - 4 * HOUR);
  let dip: EnergyForecast['dip'];
  if (dipRange.length > 0) {
    const low = dipRange.reduce((a, b) => (b.energy < a.energy ? b : a));
    // Only call it a dip if energy recovers afterwards (otherwise it's just the evening decline).
    const after = settled.filter((p) => p.t > low.t && p.t <= low.t + 4 * HOUR);
    const rebound = after.length ? Math.max(...after.map((p) => p.energy)) - low.energy : 0;
    if (rebound >= 1.5) dip = { t: low.t, energy: low.energy, start: low.t - 45 * MINUTE, end: low.t + 45 * MINUTE };
  }

  // Peaks: local maxima at least 3h apart.
  const maxima = settled.filter((p, i, arr) => i > 0 && i < arr.length - 1 && p.energy >= arr[i - 1].energy && p.energy > arr[i + 1].energy);
  const peaks: { t: number; energy: number }[] = [];
  for (const p of [...maxima].sort((a, b) => b.energy - a.energy)) {
    if (peaks.every((q) => Math.abs(q.t - p.t) >= 3 * HOUR)) peaks.push({ t: p.t, energy: p.energy });
    if (peaks.length === 2) break;
  }
  if (peaks.length === 0 && settled.length) {
    const best = settled.reduce((a, b) => (b.energy > a.energy ? b : a));
    peaks.push({ t: best.t, energy: best.energy });
  }
  peaks.sort((a, b) => a.t - b.t);

  // Focus windows: stretches within 6 energy points of the day's best, at least 45 minutes long.
  const focusWindows: Interval[] = [];
  if (settled.length) {
    const best = Math.max(...settled.map((p) => p.energy));
    let runStart: number | undefined;
    let prevT = 0;
    for (const p of settled) {
      if (p.energy >= best - 6) {
        if (runStart === undefined) runStart = p.t;
      } else if (runStart !== undefined) {
        if (prevT - runStart >= 45 * MINUTE) focusWindows.push({ start: runStart, end: prevT });
        runStart = undefined;
      }
      prevT = p.t;
    }
    if (runStart !== undefined && prevT - runStart >= 45 * MINUTE) focusWindows.push({ start: runStart, end: prevT });
  }

  const nowPoint = points.find((p) => Math.abs(p.t - now) < 5 * MINUTE) ?? undefined;
  return {
    points,
    now: nowPoint,
    wakeTime,
    bedtime,
    peaks,
    dip,
    focusWindows: focusWindows.slice(0, 3),
    assumedLastNight: input.assumedLastNight ?? false,
  };
}

// ---------------------------------------------------------------------------
// Two-process model (Borbély) for sleep-pressure questions such as
// "how much later will I get sleepy tonight if I nap now?"
// ---------------------------------------------------------------------------

export const TWO_PROCESS = {
  /** Rise time constant while awake (h) and decay time constant while asleep (h). */
  tauRise: 18.2,
  tauDecay: 4.2,
  /** Effective fall rate of the circadian sleep threshold around habitual bedtime (units/h). */
  thresholdFallRate: 0.05,
};

/** Homeostatic sleep pressure (0–1) at time `at`. */
export function sleepPressureAt(sleeps: Interval[], at: number, burnInH = 96): number {
  const intervals = mergeIntervals(sleeps);
  const step = 5 * MINUTE;
  const dtH = step / HOUR;
  let S = 0.5;
  let idx = 0;
  for (let t = at - burnInH * HOUR; t < at; t += step) {
    while (idx < intervals.length && intervals[idx].end <= t) idx++;
    const asleep = idx < intervals.length && intervals[idx].start <= t && t < intervals[idx].end;
    S = asleep ? S * Math.exp(-dtH / TWO_PROCESS.tauDecay) : 1 - (1 - S) * Math.exp(-dtH / TWO_PROCESS.tauRise);
  }
  return S;
}

/**
 * Minutes by which sleepiness at `bedtime` is pushed back if `extra` sleep is added (e.g. a nap).
 * Uses the gap in sleep pressure divided by the rate at which pressure rises and the
 * circadian threshold falls in the late evening. When `referenceSleeps` (a normal, rested schedule)
 * is given, only pressure removed below that normal bedtime level counts — a sleep-deprived person
 * carries surplus pressure and can nap without losing their usual bedtime.
 */
export function bedtimeDelayMin(sleeps: Interval[], extra: Interval, bedtime: number, referenceSleeps?: Interval[]): number {
  const without = sleepPressureAt(sleeps, bedtime);
  const withNap = sleepPressureAt([...sleeps, extra], bedtime);
  const target = referenceSleeps ? Math.min(without, sleepPressureAt(referenceSleeps, bedtime)) : without;
  const gap = target - withNap;
  if (gap <= 0) return 0;
  const riseRate = (1 - withNap) / TWO_PROCESS.tauRise;
  return (gap / (riseRate + TWO_PROCESS.thresholdFallRate)) * 60;
}
