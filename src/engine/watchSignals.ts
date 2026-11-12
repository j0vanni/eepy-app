/**
 * What the watch (and the caffeine log) adds to the energy forecast beyond sleep timing.
 *
 * Signals, each as "how far from your own usual", so they mean the same thing for everyone:
 *
 *   last night      hrv    HRV vs your 30-night baseline (ln RMSSD, SDs; + = higher than usual)
 *                   rhr    sleeping heart rate vs baseline (+ = lower than usual)
 *                   resp   breathing rate vs baseline (+ = slower than usual)
 *                   deep   deep sleep minutes vs baseline (+ = more than usual)
 *                   waso   time awake in the night vs baseline (+ = less than usual)
 *   today           dayHr  heart rate this hour vs your usual for this clock hour at this much
 *                          movement (SDs; + = higher than usual)
 *                   caffeine  caffeine in the body, saturating: mg / (mg + 150)
 *   body clock      minutes later / earlier than usual (engine/bodyClock.ts)
 *
 * The forecast adds Σ weight × signal (alertness units) and shifts its body-clock curve by
 * clockTrust × the clock shift. DEFAULT_WEIGHTS are modest population guesses; calibration.ts
 * replaces them with weights fitted to the person's own check-ins, and keeps them only when they
 * predict held-out check-ins better.
 */
import type { AlertnessPoint, EnergyContext, Interval } from './alertness';
import { debtPenaltyFor, ENERGY_PER_ALERTNESS } from './alertness';
import { bodyClockShifts, ClockDay } from './bodyClock';
import { caffeineAt } from './caffeine';
import type { Night } from './sessions';
import { mean, median, sd } from './stats';
import { addDays, clamp, HOUR, livingDay, startOfDateKey } from './time';
import type { CaffeineDose, DailyStats, NightVitals } from './types';

export const SIGNAL_KEYS = ['hrv', 'rhr', 'resp', 'deep', 'waso', 'dayHr', 'caffeine'] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];
export const NIGHT_SIGNAL_KEYS = ['hrv', 'rhr', 'resp', 'deep', 'waso'] as const;
export type NightSignalKey = (typeof NIGHT_SIGNAL_KEYS)[number];

/** Alertness units per unit of each signal, and the share of the body-clock shift applied. */
export type EnergyWeights = Record<SignalKey, number> & { clockTrust: number };

/** Population starting point: small effects in the direction the research points. */
export const DEFAULT_WEIGHTS: EnergyWeights = { hrv: 0.25, rhr: 0.25, resp: 0.1, deep: 0.15, waso: 0.15, dayHr: 0, caffeine: 2, clockTrust: 0.5 };
/** The forecast as it was before the watch signals: sleep timing only. */
export const NO_WEIGHTS: EnergyWeights = { hrv: 0, rhr: 0, resp: 0, deep: 0, waso: 0, dayHr: 0, caffeine: 0, clockTrust: 0 };

/** How far a fit may move each weight (prior SD) and where it must stay. */
export const WEIGHT_PRIOR_SD: EnergyWeights = { hrv: 0.35, rhr: 0.35, resp: 0.25, deep: 0.3, waso: 0.3, dayHr: 0.3, caffeine: 1, clockTrust: 0.35 };
export const WEIGHT_BOUNDS: Record<keyof EnergyWeights, readonly [number, number]> = {
  // Recovery signals may count for nothing but never backwards (low HRV never raises energy).
  hrv: [0, 1.5],
  rhr: [0, 1.5],
  resp: [0, 1.5],
  deep: [0, 1.5],
  waso: [0, 1.5],
  // A racing heart can mean wired or worn out: either sign.
  dayHr: [-1, 1],
  caffeine: [0, 5],
  clockTrust: [0, 1],
};

/** Caffeine (mg in the body) at which half of its full effect is reached. */
export const CAFFEINE_HALF_EFFECT_MG = 150;
export const SIGNALS = {
  baselineDays: 30,
  minBaseline: 7,
  /** Signals are capped at this many SDs. */
  maxZ: 3,
  /** Daytime heart rate: days of history, and days a clock hour needs before it has a "usual". */
  dayHrDays: 45,
  dayHrMinDays: 5,
  /** A heart-rate deviation fades with this time constant once there are no newer readings. */
  dayHrFadeH: 2,
};

export interface NightSignal {
  /** SDs from your usual, oriented so + is the good direction. */
  z: number;
  /** Last night's value and your baseline, in display units (ms, bpm, breaths/min, minutes). */
  value: number;
  baseline: number;
}

export type NightSignals = Partial<Record<NightSignalKey, NightSignal>>;

interface SeriesDef {
  key: NightSignalKey;
  get: (n: Night) => number | undefined;
  /** Value → the scale the baseline is computed on. */
  scale: (v: number) => number;
  /** +1 when higher is better. */
  sign: 1 | -1;
  /** Smallest SD used (on the baseline scale), so a very steady baseline can't blow up a tiny change. */
  minSd: number;
}

const positive = (x: number | undefined) => (x !== undefined && Number.isFinite(x) && x > 0 ? x : undefined);

function seriesFor(nights: Night[], vitals: Record<string, NightVitals>, daily: Record<string, DailyStats>): SeriesDef[] {
  const count = (f: (n: Night) => number | undefined) => nights.filter((n) => f(n) !== undefined).length;
  // Compare like with like: whichever series (overnight summary vs. the day's record) has more history.
  const pick = (a: (n: Night) => number | undefined, b: (n: Night) => number | undefined) => (count(a) >= count(b) ? a : b);
  const id = (v: number) => v;
  return [
    {
      key: 'hrv',
      get: pick(
        (n) => positive(vitals[n.main!.id]?.hrvRmssd),
        (n) => positive(daily[n.wakeDate]?.hrv),
      ),
      scale: Math.log,
      sign: 1,
      minSd: 0.08,
    },
    {
      key: 'rhr',
      get: pick(
        (n) => positive(vitals[n.main!.id]?.hrMin),
        (n) => positive(daily[n.wakeDate]?.restingHr),
      ),
      scale: id,
      sign: -1,
      minSd: 1.5,
    },
    { key: 'resp', get: (n) => positive(vitals[n.main!.id]?.respRate), scale: id, sign: -1, minSd: 0.4 },
    { key: 'deep', get: (n) => (n.main!.hasStages ? n.main!.stageMin.deep : undefined), scale: id, sign: 1, minSd: 8 },
    { key: 'waso', get: (n) => (n.main!.hasStages ? n.main!.wasoMin : undefined), scale: id, sign: -1, minSd: 6 },
  ];
}

/** Each night's recovery signals against the 30 nights before it, by wake date. */
export function nightSignals(nights: Night[], vitals: Record<string, NightVitals>, daily: Record<string, DailyStats>): Map<string, NightSignals> {
  const mains = nights.filter((n) => n.main).sort((a, b) => (a.wakeDate < b.wakeDate ? -1 : a.wakeDate > b.wakeDate ? 1 : 0));
  const out = new Map<string, NightSignals>();
  for (const def of seriesFor(mains, vitals, daily)) {
    const values = mains.map((n) => ({ date: n.wakeDate, v: def.get(n) })).filter((x): x is { date: string; v: number } => x.v !== undefined);
    for (let i = 0; i < values.length; i++) {
      const { date, v } = values[i];
      const from = addDays(date, -SIGNALS.baselineDays);
      const before: number[] = [];
      for (let j = i - 1; j >= 0 && values[j].date >= from; j--) before.push(def.scale(values[j].v));
      if (before.length < SIGNALS.minBaseline) continue;
      const m = mean(before);
      const s = Math.max(sd(before), def.minSd);
      const z = clamp((def.sign * (def.scale(v) - m)) / s, -SIGNALS.maxZ, SIGNALS.maxZ);
      const baseline = def.scale === Math.log ? Math.exp(m) : m;
      let row = out.get(date);
      if (!row) out.set(date, (row = {}));
      row[def.key] = { z: Math.round(z * 100) / 100, value: Math.round(v * 10) / 10, baseline: Math.round(baseline * 10) / 10 };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Daytime heart rate
// ---------------------------------------------------------------------------

export interface DayHeartRate {
  /** SDs above (+) / below (−) your usual for the clock hour and movement around `t`; undefined without readings. */
  at(t: number): number | undefined;
  /** Waking hours with a reading and a "usual" to compare with. */
  hours: number;
}

/** Milliseconds asleep per epoch hour. */
function asleepByHour(sleeps: Interval[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of sleeps) {
    for (let h = Math.floor(s.start / HOUR); h * HOUR < s.end; h++) {
      const o = Math.min(s.end, (h + 1) * HOUR) - Math.max(s.start, h * HOUR);
      if (o > 0) m.set(h, (m.get(h) ?? 0) + o);
    }
  }
  return m;
}

/**
 * How today's waking heart rate compares with your usual: for every clock hour, the median heart
 * rate (and steps) of that hour over recent weeks is the "usual"; what steps explain is taken out
 * with one slope fitted over all hours; the rest, in SDs, is the signal.
 */
export function dayHeartRate(daily: Record<string, DailyStats>, sleeps: Interval[], now: number): DayHeartRate {
  const asleep = asleepByHour(sleeps);
  interface Bin {
    key: number;
    hour: number;
    hr: number;
    ls: number;
  }
  const bins: Bin[] = [];
  const today = livingDay(now);
  for (let back = SIGNALS.dayHrDays; back >= -1; back--) {
    const date = addDays(today, -back);
    const hours = daily[date]?.hours;
    if (!hours) continue;
    const [y, mo, d] = date.split('-').map(Number);
    for (let h = 0; h < 24; h++) {
      const hr = hours.hr[h];
      if (hr === null || hr === undefined) continue;
      const start = new Date(y, mo - 1, d, h).getTime();
      const key = Math.floor(start / HOUR);
      if (start > now || (asleep.get(key) ?? 0) > 0.25 * HOUR) continue;
      bins.push({ key, hour: h, hr, ls: Math.log1p(hours.steps[h] ?? 0) });
    }
  }
  const byHour: Bin[][] = Array.from({ length: 24 }, () => []);
  for (const b of bins) byHour[b.hour].push(b);
  const usual = byHour.map((own) => (own.length >= SIGNALS.dayHrMinDays ? { hr: median(own.map((b) => b.hr)), ls: median(own.map((b) => b.ls)) } : undefined));
  const rows = bins.flatMap((b) => {
    const u = usual[b.hour];
    return u ? [{ key: b.key, r: b.hr - u.hr, ls: b.ls - u.ls }] : [];
  });
  let sxy = 0;
  let sxx = 0;
  for (const r of rows) {
    sxy += r.r * r.ls;
    sxx += r.ls * r.ls;
  }
  const slope = sxx > 0 ? Math.max(0, sxy / sxx) : 0;
  const resid = rows.map((r) => r.r - slope * r.ls);
  // Robust SD (MAD), at least 2 bpm.
  const centre = resid.length ? median(resid) : 0;
  const spread = resid.length >= 10 ? Math.max(2, 1.4826 * median(resid.map((x) => Math.abs(x - centre)))) : undefined;
  const z = new Map<number, number>();
  if (spread) rows.forEach((r, i) => z.set(r.key, clamp(resid[i] / spread, -SIGNALS.maxZ, SIGNALS.maxZ)));
  let lastKey = -Infinity;
  for (const k of z.keys()) if (k > lastKey) lastKey = k;

  return {
    hours: z.size,
    at(t: number) {
      const k = Math.floor(t / HOUR);
      const a = z.get(k);
      const b = z.get(k - 1);
      if (a !== undefined || b !== undefined) return a !== undefined && b !== undefined ? (a + b) / 2 : (a ?? b);
      // Past the last reading (the rest of today, tomorrow): the last deviation, fading out.
      if (k > lastKey && lastKey > -Infinity) {
        const hoursPast = t / HOUR - (lastKey + 1);
        if (hoursPast < 8) return z.get(lastKey)! * Math.exp(-Math.max(0, hoursPast) / SIGNALS.dayHrFadeH);
      }
      return undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Everything together
// ---------------------------------------------------------------------------

export interface SignalSource {
  /** Signal values at `t` in SIGNAL_KEYS order (0 where there is no reading). */
  features(t: number): number[];
  /** Minutes the body clock sits later (+) than usual on the day of `t` (before clockTrust). */
  clockShiftMin(t: number): number;
  /** Recovery signals of the night that ended on a date. */
  night(date: string): NightSignals | undefined;
  /** Caffeine in the body (mg) at `t`. */
  caffeineMg(t: number): number;
  /** Daytime heart-rate deviation (SDs) around `t`, if known. */
  dayHr(t: number): number | undefined;
  clock: ClockDay[];
  /** What the watch has delivered, for the "what eepy uses" screen. */
  coverage: { nights: number; dayHrHours: number; clockDays: number };
}

export interface SignalInput {
  nights: Night[];
  vitals: Record<string, NightVitals>;
  daily: Record<string, DailyStats>;
  caffeine: CaffeineDose[];
  halfLifeH: number;
  /** Asleep intervals (stage level). */
  sleeps: Interval[];
  now: number;
  /** Usual sleep onset / wake-up (minutes after midnight). */
  habitualOnsetMin: number;
  habitualWakeMin: number;
  /** Days of body-clock estimates (default 28; the fit asks for as many as its check-ins span). */
  clockDays?: number;
}

function sourceFrom(parts: {
  nightsByDate: Map<string, NightSignals>;
  heart: DayHeartRate;
  clock: ClockDay[];
  doses: CaffeineDose[];
  halfLifeH: number;
}): SignalSource {
  const { nightsByDate, heart, clock, doses, halfLifeH } = parts;
  const shiftByDate = new Map(clock.map((c) => [c.date, c.shiftMin]));
  const lastShift = clock.length ? clock[clock.length - 1] : undefined;
  const caffeineMg = (t: number) => {
    let near: CaffeineDose[] | undefined;
    for (const d of doses) if (d.time < t && d.time > t - 36 * HOUR) (near ??= []).push(d);
    return near ? caffeineAt(near, t, halfLifeH) : 0;
  };
  return {
    features(t) {
      const night = nightsByDate.get(livingDay(t));
      const mg = caffeineMg(t);
      return [
        night?.hrv?.z ?? 0,
        night?.rhr?.z ?? 0,
        night?.resp?.z ?? 0,
        night?.deep?.z ?? 0,
        night?.waso?.z ?? 0,
        heart.at(t) ?? 0,
        mg / (mg + CAFFEINE_HALF_EFFECT_MG),
      ];
    },
    clockShiftMin(t) {
      const day = livingDay(t);
      const v = shiftByDate.get(day);
      if (v !== undefined) return v;
      // Tomorrow (the simulator, the nightly plan): the clock is where it was last seen.
      return lastShift && day > lastShift.date && day <= addDays(lastShift.date, 2) ? lastShift.shiftMin : 0;
    },
    night: (date) => nightsByDate.get(date),
    caffeineMg,
    dayHr: (t) => heart.at(t),
    clock,
    coverage: { nights: nightsByDate.size, dayHrHours: heart.hours, clockDays: clock.length },
  };
}

export function buildSignalSource(input: SignalInput): SignalSource {
  const sleeps = [...input.sleeps].sort((a, b) => a.start - b.start);
  return sourceFrom({
    nightsByDate: nightSignals(input.nights, input.vitals, input.daily),
    heart: dayHeartRate(input.daily, sleeps, input.now),
    clock: bodyClockShifts(
      { sleeps, daily: input.daily, today: livingDay(input.now), habitualOnsetMin: input.habitualOnsetMin, habitualWakeMin: input.habitualWakeMin, now: input.now },
      input.clockDays,
    ),
    doses: input.caffeine,
    halfLifeH: input.halfLifeH,
  });
}

/** The same signals with a different caffeine log (the simulator's "what if I have a coffee at 3"). */
export function withCaffeine(source: SignalSource, doses: CaffeineDose[], halfLifeH: number): SignalSource {
  const caffeineMg = (t: number) => caffeineAt(doses.filter((d) => d.time < t && d.time > t - 36 * HOUR), t, halfLifeH);
  return {
    ...source,
    caffeineMg,
    features(t) {
      const f = source.features(t);
      const mg = caffeineMg(t);
      f[SIGNAL_KEYS.indexOf('caffeine')] = mg / (mg + CAFFEINE_HALF_EFFECT_MG);
      return f;
    },
  };
}

/** Σ weight × signal, in alertness units. */
export function boostFrom(features: number[], w: EnergyWeights): number {
  let b = 0;
  for (let i = 0; i < SIGNAL_KEYS.length; i++) b += w[SIGNAL_KEYS[i]] * features[i];
  return b;
}

/** What the forecast needs from the signals, under a set of weights. */
export function energyContext(source: SignalSource, w: EnergyWeights = DEFAULT_WEIGHTS): EnergyContext {
  const anyBoost = SIGNAL_KEYS.some((k) => w[k] !== 0);
  return {
    ...(anyBoost ? { boost: (t: number) => boostFrom(source.features(t), w) } : {}),
    ...(w.clockTrust !== 0 && source.clock.length ? { clockShiftMin: (t: number) => w.clockTrust * source.clockShiftMin(t) } : {}),
  };
}

// ---------------------------------------------------------------------------
// "Why this number"
// ---------------------------------------------------------------------------

export type EnergyPartKey = 'debt' | 'recovery' | 'heart' | 'caffeine' | 'inertia' | 'clock';

export interface EnergyPart {
  key: EnergyPartKey;
  label: string;
  /** Energy points this adds (+) or takes (−) right now; 0 for the body-clock note. */
  points: number;
  detail: string;
}

export interface EnergyBreakdown {
  energy: number;
  /** Energy from sleep pressure and the body clock alone. */
  base: number;
  parts: EnergyPart[];
}

const SIGNAL_TEXT: Record<NightSignalKey, { name: string; unit: string }> = {
  hrv: { name: 'HRV', unit: ' ms' },
  rhr: { name: 'sleeping heart rate', unit: ' bpm' },
  resp: { name: 'breathing rate', unit: '/min' },
  deep: { name: 'deep sleep', unit: ' min' },
  waso: { name: 'time awake', unit: ' min' },
};

/** Splits the current energy number into what each input contributes. */
export function explainEnergy(point: AlertnessPoint, input: { source: SignalSource; weights: EnergyWeights; debtMin: number }): EnergyBreakdown {
  const { source, weights: w } = input;
  const pts = (units: number) => Math.round(units * ENERGY_PER_ALERTNESS);
  const parts: EnergyPart[] = [];
  const t = point.t;

  const inertia = pts(point.W);
  if (inertia <= -1) parts.push({ key: 'inertia', label: 'Just woke up', points: inertia, detail: 'Grogginess fades within an hour or so of waking.' });

  const debt = -pts(debtPenaltyFor(input.debtMin));
  if (debt <= -1) parts.push({ key: 'debt', label: 'Sleep debt', points: debt, detail: `${Math.round(input.debtMin / 6) / 10} h short over the last two weeks.` });

  const night = source.night(livingDay(t));
  if (night) {
    let units = 0;
    const notes: { size: number; text: string }[] = [];
    for (const k of NIGHT_SIGNAL_KEYS) {
      const s = night[k];
      if (!s) continue;
      units += w[k] * s.z;
      if (Math.abs(s.z) >= 0.5) {
        const { name, unit } = SIGNAL_TEXT[k];
        notes.push({ size: Math.abs(w[k] * s.z), text: `${name} ${Math.round(s.value)}${unit} (usual ${Math.round(s.baseline)})` });
      }
    }
    const p = pts(units);
    if (p !== 0 || notes.length) {
      notes.sort((a, b) => b.size - a.size);
      const text = notes.slice(0, 3).map((n) => n.text).join(', ');
      parts.push({
        key: 'recovery',
        label: "Last night's recovery",
        points: p,
        detail: text ? text.charAt(0).toUpperCase() + text.slice(1) + '.' : 'HRV, heart rate and breathing were close to your usual.',
      });
    }
  }

  const z = source.dayHr(t);
  if (z !== undefined && w.dayHr !== 0) {
    const p = pts(w.dayHr * z);
    if (p !== 0) {
      parts.push({
        key: 'heart',
        label: 'Heart rate today',
        points: p,
        detail: `Running ${z > 0 ? 'higher' : 'lower'} than your usual for this hour.`,
      });
    }
  }

  const mg = source.caffeineMg(t);
  if (mg >= 5 && w.caffeine > 0) {
    const p = pts((w.caffeine * mg) / (mg + CAFFEINE_HALF_EFFECT_MG));
    if (p >= 1) parts.push({ key: 'caffeine', label: 'Caffeine', points: p, detail: `About ${Math.round(mg / 5) * 5} mg active.` });
  }

  const shift = Math.round((w.clockTrust * source.clockShiftMin(t)) / 5) * 5;
  if (Math.abs(shift) >= 15) {
    parts.push({
      key: 'clock',
      label: 'Body clock',
      points: 0,
      detail: `Running about ${Math.abs(shift)} min ${shift > 0 ? 'later' : 'earlier'} than usual, so today's peaks and dips are shifted with it.`,
    });
  }

  const sum = parts.reduce((s, p) => s + p.points, 0);
  const energy = Math.round(point.energy);
  return { energy, base: clamp(energy - sum, 0, 100), parts };
}
