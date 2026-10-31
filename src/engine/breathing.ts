/**
 * Breathing check: overnight blood-oxygen (SpO₂) dips measured by the watch.
 *
 * A clinical oxygen desaturation index (ODI: dips of ≥ 3% or ≥ 4% per hour, from a medical pulse
 * oximeter or a sleep study) is one of the measures used to assess sleep apnoea. A wrist sensor
 * that takes a reading every few minutes is not that: it misses short dips, and movement, a loose
 * strap or lying on the arm cause false ones. So eepy counts dips only when readings are dense,
 * labels nights conservatively, and says "not enough readings" instead of guessing.
 *
 * Rules (see BREATHING_RULES):
 * - Readings outside 70–100% are dropped, readings during awake periods are skipped (movement),
 *   only one app's readings are used per night (the night's own app if it wrote any), and at
 *   most one reading per 30 s.
 * - A single reading ≥ 10 points below both neighbours (each within 5 min) is a sensor glitch.
 * - Baseline = median of the non-dip readings in the preceding 15 min (≥ 2 readings; otherwise
 *   the last baseline from up to 30 min earlier).
 * - A dip starts at a reading ≥ 3 points below the baseline and ends once readings recover to
 *   within 1 point of it, after a gap of more than 10 min or at an awakening. Dips that reach
 *   ≥ 4 points also count towards the 4% index. Indices are per hour of *covered* sleep.
 * - Coverage = sleep time between consecutive readings no more than 10 min apart.
 * - Confidence: none (< 6 readings), low (< 12 readings an hour, i.e. sparser than one per 5 min,
 *   < 60 min or < 50% of sleep covered), high (≥ 24 an hour and ≥ 80% covered), else medium.
 *   Dip rates are only given with ≥ 60 min covered.
 * - Night level (medium/high confidence only — a low-confidence night is "too sparse to judge"):
 *   frequent: ≥ 15 dips/h of 3%, ≥ 10 dips/h of 4%, or ≥ 10% of sleep (and ≥ 30 min) below 90%;
 *   some: ≥ 5 dips/h of 3%, or ≥ 5% of sleep (and ≥ 10 min) below 90%; otherwise normal.
 * - Trend over the last 30 days: needs ≥ 5 medium/high-confidence nights and applies the same
 *   cut-offs to their medians (plus "some" when ≥ 30% of those nights were "frequent").
 * The cut-offs follow the clinical ODI/AHI bands (5/h = mild, 15/h = moderate), but only the
 * moderate band leads to "worth mentioning to a doctor", because wrist readings over-count dips.
 */
import type { Night } from './sessions';
import { mean, median } from './stats';
import { addDays, formatDuration, MINUTE } from './time';
import type { BreathingSummary, NightVitals, SleepSession, StageSegment, VitalSample } from './types';

export const BREATHING_RULES = {
  validMin: 70,
  validMax: 100,
  glitchDrop: 10,
  glitchNeighbourMin: 5,
  baselineWindowMin: 15,
  baselineMinReadings: 2,
  baselineCarryMin: 30,
  dipDrop: 3,
  deepDipDrop: 4,
  recoverWithin: 1,
  maxGapMin: 10,
  minReadings: 6,
  minCoveredMin: 60,
  denseReadingsPerHour: 12,
  highReadingsPerHour: 24,
  mediumCoverage: 0.5,
  highCoverage: 0.8,
  someOdi3: 5,
  frequentOdi3: 15,
  frequentOdi4: 10,
  someBelow90Share: 0.05,
  someBelow90Min: 10,
  frequentBelow90Share: 0.1,
  frequentBelow90Min: 30,
  trendDays: 30,
  trendMinNights: 5,
  trendFrequentShare: 0.3,
  curveBinMin: 5,
  keepCurveNights: 30,
  maxDipTimes: 60,
} as const;

export const BREATHING_DISCLAIMER =
  'A wrist SpO₂ sensor is not a diagnostic test. Only an oxygen desaturation index from a medical device (a home sleep test or sleep study) can indicate sleep apnoea. Movement, a loose strap or lying on your arm can cause false dips.';

const round1 = (x: number) => Math.round(x * 10) / 10;

export interface Spo2Window {
  start: number;
  sleepOnset: number;
  finalWake: number;
  /** Stage segments; awake parts are skipped. */
  segments?: StageSegment[];
  session?: Pick<SleepSession, 'origin'>;
}

/** One source per night: the night's own app if it wrote readings, else the app with the most. */
export function pickSpo2Source(samples: VitalSample[], origin?: string): VitalSample[] {
  const counts = new Map<string | undefined, number>();
  for (const s of samples) counts.set(s.origin, (counts.get(s.origin) ?? 0) + 1);
  if (counts.size <= 1) return samples;
  if (origin && counts.has(origin)) return samples.filter((s) => s.origin === origin);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return samples.filter((s) => s.origin === best);
}

/**
 * Condenses one night's raw SpO₂ readings into the breathing summary plus a compact chart curve
 * (lowest reading per 5 minutes). Returns {} when there are no usable readings.
 */
export function summarizeSpo2(samples: VitalSample[], w: Spo2Window): { summary?: BreathingSummary; curve?: [number, number][] } {
  const R = BREATHING_RULES;
  const awake = (w.segments ?? []).filter(
    (s) => (s.stage === 'awake' || s.stage === 'outOfBed') && s.end > w.sleepOnset && s.start < w.finalWake,
  );
  const isAwake = (t: number) => awake.some((s) => t >= s.start && t < s.end);
  const awakeBetween = (a: number, b: number) => awake.some((s) => s.start < b && s.end > a);

  const inWindow = samples.filter(
    (x) => x.time >= w.sleepOnset && x.time <= w.finalWake && Number.isFinite(x.value) && x.value >= R.validMin && x.value <= R.validMax,
  );
  const readings: VitalSample[] = [];
  for (const x of pickSpo2Source(inWindow, w.session?.origin).sort((a, b) => a.time - b.time)) {
    if (isAwake(x.time)) continue;
    const last = readings[readings.length - 1];
    // Duplicate writes of the same reading; also caps very dense sources at one reading per 30 s.
    if (last && x.time - last.time < 30_000) continue;
    readings.push(x);
  }
  if (readings.length === 0) return {};

  // Single-reading glitches.
  const near = (a: VitalSample, b: VitalSample) => Math.abs(b.time - a.time) <= R.glitchNeighbourMin * MINUTE;
  const clean = readings.filter((c, i) => {
    const p = readings[i - 1];
    const n = readings[i + 1];
    return !(p && n && near(p, c) && near(c, n) && c.value <= Math.min(p.value, n.value) - R.glitchDrop);
  });

  const linked = (i: number) =>
    i > 0 && clean[i].time - clean[i - 1].time <= R.maxGapMin * MINUTE && !awakeBetween(clean[i - 1].time, clean[i].time);
  let coveredMs = 0;
  for (let i = 1; i < clean.length; i++) if (linked(i)) coveredMs += clean[i].time - clean[i - 1].time;

  let dips3 = 0;
  let dips4 = 0;
  const dipAt: number[] = [];
  const inDip = clean.map(() => false);
  let event: { base: number; nadir: number; nadirT: number } | undefined;
  let lastBase: { v: number; t: number } | undefined;
  const close = () => {
    if (!event) return;
    dips3++;
    if (event.base - event.nadir >= R.deepDipDrop) dips4++;
    if (dipAt.length < R.maxDipTimes) dipAt.push(Math.round((event.nadirT - w.start) / MINUTE));
    event = undefined;
  };
  for (let i = 0; i < clean.length; i++) {
    const x = clean[i];
    if (!linked(i)) {
      close();
      lastBase = undefined;
    }
    if (event) {
      if (x.value >= event.base - R.recoverWithin) {
        close();
      } else {
        inDip[i] = true;
        if (x.value < event.nadir) {
          event.nadir = x.value;
          event.nadirT = x.time;
        }
        continue;
      }
    }
    const prior: number[] = [];
    for (let j = i - 1; j >= 0 && x.time - clean[j].time <= R.baselineWindowMin * MINUTE && linked(j + 1); j--) {
      if (!inDip[j]) prior.push(clean[j].value);
    }
    let base: number | undefined;
    if (prior.length >= R.baselineMinReadings) {
      base = median(prior);
      lastBase = { v: base, t: x.time };
    } else if (lastBase && x.time - lastBase.t <= R.baselineCarryMin * MINUTE) {
      base = lastBase.v;
    }
    if (base !== undefined && x.value <= base - R.dipDrop) {
      event = { base, nadir: x.value, nadirT: x.time };
      inDip[i] = true;
    }
  }
  close();

  const values = clean.map((x) => x.value);
  const awakeMs = awake.reduce((s, a) => s + Math.min(a.end, w.finalWake) - Math.max(a.start, w.sleepOnset), 0);
  const summary: BreathingSummary = {
    n: clean.length,
    sleepMin: Math.max(0, Math.round((w.finalWake - w.sleepOnset - awakeMs) / MINUTE)),
    coveredMin: Math.round(coveredMs / MINUTE),
    dips3,
    dips4,
    lowest: Math.min(...values),
    avg: round1(mean(values)),
    below90: values.filter((v) => v < 90).length,
    glitches: readings.length - clean.length,
  };
  if (dipAt.length) summary.dipAt = dipAt;

  const bins = new Map<number, number>();
  for (const x of clean) {
    const b = Math.floor((x.time - w.start) / (R.curveBinMin * MINUTE));
    bins.set(b, Math.min(bins.get(b) ?? Infinity, x.value));
  }
  const curve = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([b, v]) => [b * R.curveBinMin, round1(v)] as [number, number]);
  return { summary, curve };
}

/** Adds up the summaries of sessions that the analysis merged into one sleep (ids joined by '+'). */
export function combineBreathing(parts: BreathingSummary[]): BreathingSummary | undefined {
  const used = parts.filter((p) => p.n > 0);
  if (used.length === 0) return undefined;
  if (used.length === 1) return used[0];
  const n = used.reduce((s, p) => s + p.n, 0);
  const lows = used.map((p) => p.lowest).filter((x): x is number => x !== undefined);
  return {
    n,
    sleepMin: used.reduce((s, p) => s + p.sleepMin, 0),
    coveredMin: used.reduce((s, p) => s + p.coveredMin, 0),
    dips3: used.reduce((s, p) => s + p.dips3, 0),
    dips4: used.reduce((s, p) => s + p.dips4, 0),
    lowest: lows.length ? Math.min(...lows) : undefined,
    avg: round1(used.reduce((s, p) => s + (p.avg ?? 0) * p.n, 0) / n),
    below90: used.reduce((s, p) => s + p.below90, 0),
    glitches: used.reduce((s, p) => s + p.glitches, 0),
  };
}

/** The breathing summary for a (possibly merged) session id. */
export function breathingSummaryFor(vitals: Record<string, NightVitals>, sessionId: string): BreathingSummary | undefined {
  const own = vitals[sessionId]?.breathing;
  if (own || !sessionId.includes('+')) return own;
  return combineBreathing(
    sessionId
      .split('+')
      .map((id) => vitals[id]?.breathing)
      .filter((x): x is BreathingSummary => !!x),
  );
}

export type BreathingConfidence = 'none' | 'low' | 'medium' | 'high';
/** 'unknown' = readings too sparse to judge. */
export type BreathingLevel = 'normal' | 'some' | 'frequent' | 'unknown';

export interface BreathingNight {
  summary: BreathingSummary;
  readingsPerHour: number;
  /** Share of sleep covered by readings (0–1). */
  coverage: number;
  /** Readings were dense while the watch was reading, but under half the night is covered. */
  gappy: boolean;
  /** Dips of ≥ 3% / ≥ 4% per hour of covered sleep (undefined when confidence is 'none'). */
  odi3?: number;
  odi4?: number;
  /** Share of readings below 90% and the minutes of sleep that represents. */
  below90Share?: number;
  below90Min?: number;
  confidence: BreathingConfidence;
  level: BreathingLevel;
  title: string;
  detail: string;
}

function classify(odi3: number, odi4: number, share: number, below90Min: number): 'normal' | 'some' | 'frequent' {
  const R = BREATHING_RULES;
  if (odi3 >= R.frequentOdi3 || odi4 >= R.frequentOdi4 || (share >= R.frequentBelow90Share && below90Min >= R.frequentBelow90Min)) return 'frequent';
  if (odi3 >= R.someOdi3 || (share >= R.someBelow90Share && below90Min >= R.someBelow90Min)) return 'some';
  return 'normal';
}

const rate = (x: number) => (x < 10 ? x.toFixed(1) : String(Math.round(x)));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function confidenceLabel(c: BreathingConfidence): string {
  return { none: 'not enough readings', low: 'low', medium: 'medium', high: 'high' }[c];
}

export const LEVEL_TITLES: Record<BreathingLevel, string> = {
  normal: 'Looks normal',
  some: 'Some dips',
  frequent: 'Frequent dips',
  unknown: 'Too few readings to judge',
};

/** Turns a night's summary into indices, a confidence level and plain-English copy. */
export function assessBreathing(summary: BreathingSummary | undefined): BreathingNight | undefined {
  if (!summary || summary.n === 0) return undefined;
  const R = BREATHING_RULES;
  const sleepH = summary.sleepMin / 60;
  const readingsPerHour = sleepH > 0 ? summary.n / sleepH : 0;
  const coverage = summary.sleepMin > 0 ? Math.min(1, summary.coveredMin / summary.sleepMin) : 0;
  let confidence: BreathingConfidence;
  if (summary.n < R.minReadings) confidence = 'none';
  else if (readingsPerHour < R.denseReadingsPerHour || coverage < R.mediumCoverage || summary.coveredMin < R.minCoveredMin) confidence = 'low';
  else if (readingsPerHour >= R.highReadingsPerHour && coverage >= R.highCoverage) confidence = 'high';
  else confidence = 'medium';

  const coveredH = summary.coveredMin / 60;
  const rated = confidence !== 'none' && summary.coveredMin >= R.minCoveredMin;
  const odi3 = rated ? round1(summary.dips3 / coveredH) : undefined;
  const odi4 = rated ? round1(summary.dips4 / coveredH) : undefined;
  const below90Share = summary.n >= R.minReadings ? summary.below90 / summary.n : undefined;
  const below90Min = below90Share !== undefined ? Math.round(below90Share * summary.sleepMin) : undefined;
  const dense = confidence === 'medium' || confidence === 'high';
  // Dense while the watch was reading, but large parts of the night are missing (loose strap).
  const gappy = coverage < R.mediumCoverage && coveredH > 0 && summary.n / coveredH >= R.denseReadingsPerHour;
  const level: BreathingLevel = dense ? classify(odi3!, odi4!, below90Share!, below90Min!) : 'unknown';

  const lowest = summary.lowest !== undefined ? `the lowest reading was ${summary.lowest}%` : '';
  const below = dense && below90Min && below90Min >= 1 ? ` About ${formatDuration(below90Min)} of sleep was below 90%.` : '';
  const rates = dense ? `${rate(odi3!)} dips an hour of 3% or more (${rate(odi4!)} of 4% or more)` : '';
  let title = LEVEL_TITLES[level];
  let detail: string;
  if (confidence === 'none') {
    title = 'Not enough readings';
    detail = `Only ${plural(summary.n, 'SpO₂ reading')} while you slept${lowest ? ` — ${lowest}` : ''}. That's too few to look for dips, so eepy won't guess.`;
  } else if (level === 'unknown') {
    detail = !gappy
        ? `Your watch logged ${plural(summary.n, 'reading')} (about ${Math.round(readingsPerHour)} an hour)${lowest ? ` and ${lowest}` : ''}. Dips usually last a minute or two, so eepy needs about one reading every 5 minutes to count them.`
        : `Readings covered only ${Math.round(coverage * 100)}% of your sleep — the strap may have been loose — so eepy won't count dips for this night${lowest ? `; ${lowest}` : ''}.`;
  } else if (level === 'normal') {
    detail = `${capitalize(rates)} — under 5 is typical — and ${lowest || 'readings stayed steady'}.${below}`;
  } else if (level === 'some') {
    detail = `${capitalize(rates)}, and ${lowest}.${below} An occasional night like this is common (a cold, alcohol or sleeping on your back can do it); it matters only if it happens most nights.`;
  } else {
    detail = `${capitalize(rates)}, and ${lowest}.${below} One night like this can be sensor noise — a loose strap or lying on your arm. If it keeps happening, especially with loud snoring, pauses in breathing or daytime sleepiness, it's worth mentioning to a doctor.`;
  }
  return { summary, readingsPerHour, coverage, gappy, odi3, odi4, below90Share, below90Min, confidence, level, title, detail };
}

const capitalize = (x: string) => (x ? `${x[0].toUpperCase()}${x.slice(1)}` : x);

export interface BreathingTrendNight {
  date: string;
  sessionId: string;
  night: BreathingNight;
}

export interface BreathingTrend {
  days: number;
  /** Main nights in the window (with or without SpO₂). */
  nightsInWindow: number;
  /** Nights with SpO₂ readings, oldest first. */
  nights: BreathingTrendNight[];
  /** Nights dense enough to count dips (medium/high confidence). */
  analysable: number;
  medianOdi3?: number;
  medianOdi4?: number;
  medianLowest?: number;
  medianBelow90Share?: number;
  /** Typical readings per hour across the nights with data. */
  medianReadingsPerHour?: number;
  nightsSome: number;
  nightsFrequent: number;
  level: BreathingLevel;
  title: string;
  detail: string;
  /** Nights whose SpO₂ was synced before the breathing check existed (a full re-sync analyses them). */
  legacyNights: number;
}

/** 30-night breathing trend. Undefined when there are no main nights in the window at all. */
export function breathingTrend(input: { nights: Night[]; vitals: Record<string, NightVitals>; asOfDate: string; days?: number }): BreathingTrend | undefined {
  const R = BREATHING_RULES;
  const days = input.days ?? R.trendDays;
  const from = addDays(input.asOfDate, -(days - 1));
  const inWindow = input.nights.filter((n) => n.main && n.wakeDate >= from && n.wakeDate <= input.asOfDate);
  if (inWindow.length === 0) return undefined;
  const nights: BreathingTrendNight[] = [];
  let legacyNights = 0;
  for (const n of inWindow) {
    const id = n.main!.id;
    const night = assessBreathing(breathingSummaryFor(input.vitals, id));
    if (night) nights.push({ date: n.wakeDate, sessionId: id, night });
    else if ((input.vitals[id]?.spo2Samples ?? 0) > 0 && !input.vitals[id]?.breathing) legacyNights++;
  }
  const dense = nights.map((x) => x.night).filter((x) => x.confidence === 'medium' || x.confidence === 'high');
  const med = (f: (x: BreathingNight) => number | undefined, xs = dense) => {
    const v = xs.map(f).filter((x): x is number => x !== undefined);
    return v.length ? median(v) : undefined;
  };
  const medianOdi3 = med((x) => x.odi3);
  const medianOdi4 = med((x) => x.odi4);
  const medianBelow90Share = med((x) => x.below90Share);
  const medianBelow90Min = med((x) => x.below90Min);
  const medianLowest = med((x) => x.summary.lowest, nights.map((x) => x.night));
  const medianReadingsPerHour = med((x) => x.readingsPerHour, nights.map((x) => x.night));
  const nightsSome = dense.filter((x) => x.level === 'some').length;
  const nightsFrequent = dense.filter((x) => x.level === 'frequent').length;
  const base = {
    days,
    nightsInWindow: inWindow.length,
    nights,
    analysable: dense.length,
    medianOdi3: medianOdi3 !== undefined ? round1(medianOdi3) : undefined,
    medianOdi4: medianOdi4 !== undefined ? round1(medianOdi4) : undefined,
    medianLowest: medianLowest !== undefined ? Math.round(medianLowest) : undefined,
    medianBelow90Share,
    medianReadingsPerHour,
    nightsSome,
    nightsFrequent,
    legacyNights,
  };
  const resync = legacyNights >= 3 ? ` ${legacyNights} earlier nights were synced before the breathing check — a full re-sync in Settings analyses them.` : '';

  if (dense.length < R.trendMinNights) {
    let detail: string;
    if (nights.length === 0) {
      detail = legacyNights
        ? `Your SpO₂ readings were synced before the breathing check existed.${resync}`
        : `No blood-oxygen readings from your watch in the last ${days} days. If Nothing X has an option for automatic or overnight SpO₂ measurement, turning it on lets eepy check your breathing.`;
    } else {
      const rph = medianReadingsPerHour !== undefined ? Math.round(medianReadingsPerHour) : 0;
      detail = `${dense.length} of ${plural(nights.length, 'night')} with SpO₂ had readings dense enough to count dips — eepy needs at least ${R.trendMinNights}. ${
        rph < R.denseReadingsPerHour
          ? `Your watch logged about ${rph} reading${rph === 1 ? '' : 's'} an hour; counting dips takes about one every 5 minutes. If Nothing X has an option for continuous or overnight SpO₂, turning it on helps.`
          : 'Keep wearing the watch snugly at night.'
      }${resync}`;
    }
    return { ...base, level: 'unknown', title: 'Not enough data yet', detail };
  }

  let level = classify(medianOdi3 ?? 0, medianOdi4 ?? 0, medianBelow90Share ?? 0, medianBelow90Min ?? 0);
  if (level === 'normal' && nightsFrequent / dense.length >= R.trendFrequentShare) level = 'some';
  const rates = `a median of ${rate(base.medianOdi3 ?? 0)} dips an hour of 3% or more (${rate(base.medianOdi4 ?? 0)} of 4% or more) across ${dense.length} nights`;
  const lows = base.medianLowest !== undefined ? `, with the lowest reading usually around ${base.medianLowest}%` : '';
  const frequentNights = nightsFrequent ? ` ${plural(nightsFrequent, 'night')} had frequent dips.` : '';
  let title: string;
  let detail: string;
  if (level === 'normal') {
    title = 'Looks normal';
    detail = `Your watch saw ${rates}${lows} — under 5 an hour is typical.${resync}`;
  } else if (level === 'some') {
    title = 'Some dips';
    detail = `Your watch saw ${rates}${lows}.${frequentNights} Mild dips are common and wrist readings over-count them, so this is one to keep an eye on. If you snore loudly, someone has noticed pauses in your breathing or you're often sleepy in the day, take the STOP-Bang check.${resync}`;
  } else {
    title = 'Frequent dips — worth mentioning to a doctor';
    detail = `Your watch saw ${rates}${lows}. A wrist sensor can't diagnose anything, but a pattern like this is worth mentioning to a doctor, who can arrange a proper sleep test — especially if you snore, someone has noticed pauses in your breathing or you're often sleepy in the day.${resync}`;
  }
  return { ...base, level, title, detail };
}

/**
 * Keeps the chart curve only for the most recent `keep` sessions that have one (the summary stays
 * for every night), so the persisted store doesn't grow with history. Never mutates the input.
 */
export function pruneSpo2Curves(
  vitals: Record<string, NightVitals>,
  sessions: Pick<SleepSession, 'id' | 'end'>[],
  keep: number = BREATHING_RULES.keepCurveNights,
): Record<string, NightVitals> {
  const withCurve = sessions.filter((s) => vitals[s.id]?.spo2Curve).sort((a, b) => b.end - a.end);
  const keepIds = new Set(withCurve.slice(0, keep).map((s) => s.id));
  let out = vitals;
  for (const [id, v] of Object.entries(vitals)) {
    if (!v.spo2Curve || keepIds.has(id)) continue;
    if (out === vitals) out = { ...vitals };
    const { spo2Curve: _drop, ...rest } = v;
    out[id] = rest;
  }
  return out;
}
