/**
 * Where the body clock is today, from the watch — instead of assuming it sits wherever the last
 * four weeks of sleep times put it.
 *
 * Two estimates, both per day:
 *
 * 1. A light-driven clock. A limit-cycle oscillator (Forger, Jewett & Kronauer 1999, the "simpler"
 *    model of the human pacemaker) is run hour by hour on a light estimate: dark while asleep, room
 *    light while awake, brighter in daytime hours with a lot of steps. Driving this kind of model with
 *    wearable activity predicts lab-measured clock time to about an hour (Huang et al. 2021). The
 *    model clock can only move so fast, so one late night barely shifts it and a week of them does —
 *    which is what the multi-week average of sleep times misses.
 * 2. The heart-rate rhythm. Heart rate has a daily wave of its own; after taking out what steps
 *    explain (Bowman et al. 2021), the time of its trough is a second marker of clock time.
 *
 * Neither is trusted as an absolute clock time: the light estimate is a guess from steps, and sleep
 * itself pulls the heart-rate trough. What is used is each estimate's movement against its own
 * recent median — "your clock is about 40 min later than usual today". The energy model applies a
 * share of that shift (`clockTrust`, learned from check-ins in calibration.ts).
 */
import type { Interval } from './alertness';
import { median } from './stats';
import { addDays, clamp, HOUR, startOfDateKey } from './time';
import type { DailyStats } from './types';

export const BODY_CLOCK = {
  /** Days of history the oscillator is run over. */
  historyDays: 35,
  /** Days of a regular schedule fed in first so the oscillator starts entrained. */
  warmUpDays: 45,
  /** Each day is compared with the median of this many days before it. */
  baselineDays: 28,
  minBaselineDays: 7,
  /** The shift never exceeds this (minutes). */
  maxShiftMin: 120,
  /** Share of the light-driven estimate when both exist. */
  lightWeight: 0.6,
  /** A heart-rate wave smaller than this (bpm) has no usable trough. */
  minHrAmplitude: 1.5,
};

// Forger, Jewett & Kronauer (1999) parameters.
const F = { mu: 0.23, taux: 24.2, k: 0.55, G: 33.75, beta: 0.0075, alpha0: 0.05, I0: 9500, p: 0.5 };
/** Core body temperature minimum follows the minimum of x by this many hours. */
const CBT_AFTER_XMIN_H = 0.97;
const DT_H = 0.1;

interface State {
  x: number;
  xc: number;
  n: number;
}

function deriv(s: State, lux: number): State {
  const alpha = F.alpha0 * Math.pow(Math.max(lux, 0) / F.I0, F.p);
  const B = F.G * (1 - s.n) * alpha * (1 - 0.4 * s.x) * (1 - 0.4 * s.xc);
  const w = Math.PI / 12;
  return {
    x: w * (s.xc + B),
    xc: w * (F.mu * (s.xc - (4 / 3) * s.xc ** 3) - s.x * ((24 / (0.99669 * F.taux)) ** 2 + F.k * B)),
    n: 60 * (alpha * (1 - s.n) - F.beta * s.n),
  };
}

function rk4(s: State, lux: number, dt: number): State {
  const add = (a: State, b: State, k: number): State => ({ x: a.x + k * b.x, xc: a.xc + k * b.xc, n: a.n + k * b.n });
  const k1 = deriv(s, lux);
  const k2 = deriv(add(s, k1, dt / 2), lux);
  const k3 = deriv(add(s, k2, dt / 2), lux);
  const k4 = deriv(add(s, k3, dt), lux);
  return {
    x: s.x + (dt / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
    xc: s.xc + (dt / 6) * (k1.xc + 2 * k2.xc + 2 * k3.xc + k4.xc),
    n: clamp(s.n + (dt / 6) * (k1.n + 2 * k2.n + 2 * k3.n + k4.n), 0, 1),
  };
}

/**
 * Light (lux) a person is probably in during a waking hour. Steps stand in for light: a lot of
 * movement in daytime hours usually includes daylight; in the evening it is still lamp light.
 * `steps` undefined = no step data for the hour.
 */
export function lightGuess(hourOfDay: number, steps: number | undefined): number {
  const day = hourOfDay >= 7 && hourOfDay < 19;
  const active = steps === undefined ? 0.2 : Math.min(1, steps / 2000);
  return day ? 150 + active * 1500 : 40 + active * 60;
}

/** Share of the hour starting at `t` spent asleep (`sleeps` sorted by start). */
function asleepShare(sleeps: Interval[], t: number): number {
  let ms = 0;
  for (const s of sleeps) {
    if (s.start >= t + HOUR) break;
    const o = Math.min(s.end, t + HOUR) - Math.max(s.start, t);
    if (o > 0) ms += o;
  }
  return Math.min(1, ms / HOUR);
}

export interface BodyClockInput {
  /** Asleep intervals covering the history. */
  sleeps: Interval[];
  daily: Record<string, DailyStats>;
  /** The last day to estimate (a "living day" date key). */
  today: string;
  /** Usual sleep onset and wake-up (minutes after midnight), for the warm-up days. */
  habitualOnsetMin: number;
  habitualWakeMin: number;
  /** Nothing after this moment is known yet (the current hour is skipped). */
  now: number;
}

/** Times (epoch ms) of the model's core-body-temperature minimum, one per cycle. */
export function lightDrivenClock(input: BodyClockInput, historyDays = BODY_CLOCK.historyDays): number[] {
  const sleeps = [...input.sleeps].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const firstDay = addDays(input.today, -historyDays);
  const dataStart = startOfDateKey(firstDay);
  const start = dataStart - BODY_CLOCK.warmUpDays * 24 * HOUR;
  const end = Math.min(input.now, startOfDateKey(addDays(input.today, 1)) + 16 * HOUR);
  // Nights (noon to noon) with recorded sleep; a night the watch missed is assumed to be a usual one.
  const nightOf = (t: number) => Math.round((t - start) / (24 * HOUR));
  const asleepMs = new Map<number, number>();
  for (const sl of sleeps) {
    const k = nightOf((sl.start + sl.end) / 2);
    asleepMs.set(k, (asleepMs.get(k) ?? 0) + sl.end - sl.start);
  }
  const recorded = new Set<number>();
  for (const [k, ms] of asleepMs) if (ms >= 2 * HOUR) recorded.add(k);

  // Warm-up (and any days before the first recorded sleep): the usual night, every night.
  const onsetH = input.habitualOnsetMin / 60;
  const wakeH = input.habitualWakeMin / 60;
  const usualAsleep = (h: number) => (onsetH <= wakeH ? h >= onsetH && h < wakeH : h >= onsetH || h < wakeH);

  let s: State = { x: -0.3, xc: -1.13, n: 0.1 };
  let prev2 = s.x;
  let prev1 = s.x;
  const out: number[] = [];
  const stepsPerHour = Math.round(1 / DT_H);
  for (let t = start; t < end; t += HOUR) {
    const d = new Date(t);
    const hour = d.getHours();
    let lux: number;
    if (t < dataStart || !recorded.has(nightOf(t))) {
      lux = usualAsleep(hour + 0.5) ? 0 : lightGuess(hour, undefined);
    } else {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const hours = input.daily[key]?.hours;
      lux = (1 - asleepShare(sleeps, t)) * lightGuess(hour, hours ? hours.steps[hour] : undefined);
    }
    for (let i = 0; i < stepsPerHour; i++) {
      s = rk4(s, lux, DT_H);
      if (prev1 < prev2 && prev1 <= s.x && t >= dataStart - 24 * HOUR) {
        // prev1 (the state one step back, at t + i·dt) was a minimum of x.
        out.push(t + i * DT_H * HOUR + CBT_AFTER_XMIN_H * HOUR);
      }
      prev2 = prev1;
      prev1 = s.x;
    }
  }
  return out;
}

/**
 * Time of the heart-rate trough for a day, in minutes after that day's midnight (negative = before
 * midnight), from the hourly bins of that day and the two before: heart rate = level + 24h wave +
 * what steps explain. Undefined without enough hours or without a clear wave.
 */
export function heartRateTrough(daily: Record<string, DailyStats>, date: string, now = Infinity): number | undefined {
  // Normal equations for y = b0 + b1 cos + b2 sin + b3 log1p(steps).
  const A = [0, 0, 0, 0].map(() => [0, 0, 0, 0]);
  const b = [0, 0, 0, 0];
  let n = 0;
  const hoursSeen = new Set<number>();
  for (let back = 2; back >= 0; back--) {
    const key = addDays(date, -back);
    const hours = daily[key]?.hours;
    if (!hours) continue;
    const dayStart = startOfDateKey(key);
    for (let h = 0; h < 24; h++) {
      const y = hours.hr[h];
      if (y === null || y === undefined || dayStart + (h + 1) * HOUR > now) continue;
      const a = (2 * Math.PI * (h + 0.5)) / 24;
      const row = [1, Math.cos(a), Math.sin(a), Math.log1p(hours.steps[h] ?? 0)];
      for (let i = 0; i < 4; i++) {
        b[i] += row[i] * y;
        for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j];
      }
      n++;
      hoursSeen.add(h);
    }
  }
  if (n < 30 || hoursSeen.size < 16) return undefined;
  const beta = solve(A, b);
  if (!beta) return undefined;
  const amp = Math.hypot(beta[1], beta[2]);
  if (amp < BODY_CLOCK.minHrAmplitude) return undefined;
  // b1 cos(a) + b2 sin(a) = amp cos(a − peak); the trough is half a day from the peak.
  const peakH = (Math.atan2(beta[2], beta[1]) * 24) / (2 * Math.PI);
  let troughMin = (((peakH + 12) % 24) + 24) % 24 * 60;
  if (troughMin > 16 * 60) troughMin -= 1440;
  return troughMin;
}

/** Solves a small linear system by Gauss–Jordan elimination; undefined when singular. */
export function solve(A: number[][], b: number[]): number[] | undefined {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    if (Math.abs(M[pivot][c]) < 1e-9) return undefined;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export interface ClockDay {
  date: string;
  /** Minutes the body clock sits later (+) / earlier (−) than its recent usual. */
  shiftMin: number;
  /** The two estimates' own shifts, when available. */
  lightShiftMin?: number;
  heartShiftMin?: number;
}

/** Movement of a per-day series against the median of the days before each day. */
function againstBaseline(series: Map<string, number>, dates: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const date of dates) {
    const v = series.get(date);
    if (v === undefined) continue;
    const before: number[] = [];
    for (let i = 1; i <= BODY_CLOCK.baselineDays; i++) {
      const p = series.get(addDays(date, -i));
      if (p !== undefined) before.push(p);
    }
    if (before.length >= BODY_CLOCK.minBaselineDays) out.set(date, v - median(before));
  }
  return out;
}

/**
 * The body clock's shift for each of the last `days` days (oldest first). Days without enough
 * history are left out — callers treat a missing day as "no shift".
 */
export function bodyClockShifts(input: BodyClockInput, days = 28): ClockDay[] {
  // Enough days before the first one asked for to have a baseline for it.
  const historyDays = Math.max(BODY_CLOCK.historyDays, days + BODY_CLOCK.minBaselineDays);
  const history: string[] = [];
  for (let i = historyDays; i >= 0; i--) history.push(addDays(input.today, -i));

  // Light-driven clock: the minimum that falls in each day's night (16:00 the day before → 16:00).
  const light = new Map<string, number>();
  const minima = lightDrivenClock(input, historyDays);
  for (const date of history) {
    const midnight = startOfDateKey(date);
    const m = minima.find((t) => t >= midnight - 8 * HOUR && t < midnight + 16 * HOUR);
    if (m !== undefined) light.set(date, (m - midnight) / 60_000);
  }
  const heart = new Map<string, number>();
  for (const date of history) {
    const m = heartRateTrough(input.daily, date, input.now);
    if (m !== undefined) heart.set(date, m);
  }

  const dates = history.slice(-days);
  const lightShift = againstBaseline(light, dates);
  const heartShift = againstBaseline(heart, dates);
  const out: ClockDay[] = [];
  for (const date of dates) {
    const l = lightShift.get(date);
    const h = heartShift.get(date);
    if (l === undefined && h === undefined) continue;
    const mixed = l !== undefined && h !== undefined ? BODY_CLOCK.lightWeight * l + (1 - BODY_CLOCK.lightWeight) * h : (l ?? h)!;
    out.push({
      date,
      shiftMin: Math.round(clamp(mixed, -BODY_CLOCK.maxShiftMin, BODY_CLOCK.maxShiftMin)),
      ...(l !== undefined ? { lightShiftMin: Math.round(l) } : {}),
      ...(h !== undefined ? { heartShiftMin: Math.round(h) } : {}),
    });
  }
  return out;
}
