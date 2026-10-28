import type { Night } from './sessions';
import { debtOnDate } from './sleepDebt';
import { mean, rng, sd, trimmedMean } from './stats';
import { addDays, clamp, clockDiff, formatDuration, minutesOfDay, weekdayOfKey } from './time';
import type { DayLog, Profile } from './types';

export interface AgeBaseline {
  meanMin: number;
  lowMin: number;
  highMin: number;
  label: string;
}

export interface NeedEvidence {
  key: 'age' | 'natural' | 'energy';
  label: string;
  estimateMin: number;
  sdMin: number;
  n: number;
  detail: string;
}

export interface SleepNeedEstimate {
  needMin: number;
  sdMin: number;
  lowMin: number;
  highMin: number;
  confidence: 'low' | 'medium' | 'high';
  method: 'override' | 'age' | 'personalized';
  evidence: NeedEvidence[];
  naturalNightsUsed: number;
  naturalNightsWanted: number;
  explanation: string;
}

const PRIOR_SD = 45;
const NATURAL_MODEL_SD = 15;
const NATURAL_NIGHTS_WANTED = 10;

/**
 * Age-group recommendation (US National Sleep Foundation 2015 / AASM consensus) used as the prior.
 * The mean sits slightly above the midpoint for young adults, who reliably sleep longer when unrestricted.
 */
export function ageBaseline(age: number): AgeBaseline {
  if (age < 14) return { meanMin: 600, lowMin: 540, highMin: 660, label: '6–13 years: 9–11h' };
  if (age < 18) return { meanMin: 540, lowMin: 480, highMin: 600, label: '14–17 years: 8–10h' };
  if (age < 26) return { meanMin: 480, lowMin: 420, highMin: 540, label: '18–25 years: 7–9h' };
  if (age < 65) return { meanMin: 465, lowMin: 420, highMin: 540, label: '26–64 years: 7–9h' };
  return { meanMin: 450, lowMin: 420, highMin: 480, label: '65+ years: 7–8h' };
}

export function ageFromBirthYear(birthYear: number, asOfDate: string): number {
  return Number(asOfDate.slice(0, 4)) - birthYear;
}

/**
 * Was this night "unrestricted" (no alarm, no obligations)? Explicit journal answers win;
 * otherwise free days where the wake-up was well after the usual workday alarm count.
 */
export function isUnrestrictedNight(night: Night, dayLogs: Record<string, DayLog>, profile: Profile): boolean {
  const main = night.main;
  if (!main) return false;
  const log = dayLogs[night.wakeDate];
  if (log?.wokeNaturally !== undefined) return log.wokeNaturally;
  if (profile.workdays.includes(weekdayOfKey(night.wakeDate))) return false;
  return clockDiff(profile.workWakeMin, minutesOfDay(main.finalWake)) >= 30;
}

function naturalNightEvidence(
  nights: Night[],
  dayLogs: Record<string, DayLog>,
  profile: Profile,
  needMin: number,
): NeedEvidence | undefined {
  const adjusted: number[] = [];
  for (const n of nights) {
    const main = n.main;
    if (!main || !isUnrestrictedNight(n, dayLogs, profile)) continue;
    if (main.totalSleepMin < 240 || main.totalSleepMin > 780) continue; // implausible / sick days
    // Rebound sleep after a debt overstates need; subtract a fraction of the debt carried into the night.
    const debtBefore = debtOnDate(nights, needMin, addDays(n.wakeDate, -1));
    adjusted.push(main.totalSleepMin - Math.min(90, 0.25 * debtBefore));
  }
  if (adjusted.length < 3) return undefined;
  const est = trimmedMean(adjusted, 0.1);
  const spread = adjusted.length > 1 ? sd(adjusted) : 60;
  const sdMin = Math.sqrt((spread * spread) / adjusted.length + NATURAL_MODEL_SD ** 2);
  return {
    key: 'natural',
    label: 'Nights you woke without an alarm',
    estimateMin: est,
    sdMin,
    n: adjusted.length,
    detail: `${adjusted.length} unrestricted nights averaged ${formatDuration(est)} after correcting for rebound sleep.`,
  };
}

interface HingeFit {
  hinge: number;
  slope: number;
  sse: number;
}

function fitHinge(xs: number[], ys: number[]): HingeFit | undefined {
  let best: HingeFit | undefined;
  for (let h = 330; h <= 630; h += 5) {
    const z = xs.map((x) => Math.min(x, h));
    const mz = mean(z);
    const my = mean(ys);
    let szz = 0;
    let szy = 0;
    for (let i = 0; i < z.length; i++) {
      szz += (z[i] - mz) ** 2;
      szy += (z[i] - mz) * (ys[i] - my);
    }
    if (szz === 0) continue;
    const slope = szy / szz;
    const a = my - slope * mz;
    let sse = 0;
    for (let i = 0; i < z.length; i++) sse += (ys[i] - (a + slope * z[i])) ** 2;
    if (!best || sse < best.sse - 1e-9) best = { hinge: h, slope, sse };
  }
  return best;
}

/**
 * Dose–response: daytime energy vs. the previous night's sleep. The duration where more sleep
 * stops improving energy (a "broken-stick" regression knee) is an estimate of sleep need.
 */
export function energyEvidence(nights: Night[], dayLogs: Record<string, DayLog>): NeedEvidence | undefined {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of nights) {
    const e = dayLogs[n.wakeDate]?.energy;
    if (!n.main || e === undefined) continue;
    xs.push(n.main.totalSleepMin);
    ys.push(e);
  }
  if (xs.length < 14) return undefined;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (hi - lo < 90) return undefined;
  const fit = fitHinge(xs, ys);
  if (!fit || fit.slope <= 0 || fit.hinge >= hi - 15 || fit.hinge <= lo + 15) return undefined;

  const rand = rng(xs.length * 7919 + Math.round(hi));
  const boots: number[] = [];
  for (let b = 0; b < 60; b++) {
    const bx: number[] = [];
    const by: number[] = [];
    for (let i = 0; i < xs.length; i++) {
      const j = Math.floor(rand() * xs.length);
      bx.push(xs[j]);
      by.push(ys[j]);
    }
    const f = fitHinge(bx, by);
    if (f && f.slope > 0) boots.push(f.hinge);
  }
  const bootSd = boots.length > 10 ? sd(boots) : 90;
  if (bootSd > 75) return undefined;
  return {
    key: 'energy',
    label: 'Your energy ratings',
    estimateMin: fit.hinge,
    sdMin: Math.max(20, bootSd),
    n: xs.length,
    detail: `Across ${xs.length} days, your energy stopped improving beyond about ${formatDuration(fit.hinge)} of sleep.`,
  };
}

export function estimateSleepNeed(input: {
  nights: Night[];
  dayLogs: Record<string, DayLog>;
  profile: Profile;
  asOfDate: string;
}): SleepNeedEstimate {
  const { nights, dayLogs, profile, asOfDate } = input;
  const age = ageFromBirthYear(profile.birthYear, asOfDate);
  const base = ageBaseline(age);
  const prior: NeedEvidence = {
    key: 'age',
    label: 'Age-group recommendation',
    estimateMin: base.meanMin,
    sdMin: PRIOR_SD,
    n: 0,
    detail: `Recommended for ${base.label}.`,
  };

  const recent = nights.filter((n) => n.wakeDate <= asOfDate && n.wakeDate > addDays(asOfDate, -90));
  const energy = energyEvidence(recent, dayLogs);

  // The debt correction depends on the need itself, so solve for the self-consistent need:
  // posterior(need) is non-increasing in need, so bisection on posterior(need) − need converges.
  const posterior = (candidate: number) => {
    const natural = naturalNightEvidence(recent, dayLogs, profile, candidate);
    let precision = 0;
    let weighted = 0;
    for (const e of [prior, natural, energy]) {
      if (!e) continue;
      const p = 1 / (e.sdMin * e.sdMin);
      precision += p;
      weighted += p * e.estimateMin;
    }
    return { natural, mean: weighted / precision, sd: Math.sqrt(1 / precision) };
  };
  let lo = 330;
  let hi = 660;
  for (let iter = 0; iter < 18; iter++) {
    const mid = (lo + hi) / 2;
    if (posterior(mid).mean > mid) lo = mid;
    else hi = mid;
  }
  const solved = posterior((lo + hi) / 2);
  const natural = solved.natural;
  const need = clamp(solved.mean, 330, 660);
  const postSd = solved.sd;

  const evidence = [prior, natural, energy].filter((e): e is NeedEvidence => !!e);
  const personalized = evidence.length > 1;
  const confidence = postSd <= 18 ? 'high' : postSd <= 30 ? 'medium' : 'low';

  if (profile.sleepNeedOverrideMin) {
    return {
      needMin: profile.sleepNeedOverrideMin,
      sdMin: 0,
      lowMin: profile.sleepNeedOverrideMin,
      highMin: profile.sleepNeedOverrideMin,
      confidence: 'high',
      method: 'override',
      evidence,
      naturalNightsUsed: natural?.n ?? 0,
      naturalNightsWanted: NATURAL_NIGHTS_WANTED,
      explanation: `You set your sleep need manually. Our data-driven estimate is ${formatDuration(need)}.`,
    };
  }

  const rounded = Math.round(need / 5) * 5;
  const parts = evidence.filter((e) => e.key !== 'age').map((e) => e.detail);
  const explanation = personalized
    ? `${parts.join(' ')} Combined with the ${base.label} guideline.`
    : `Using the ${base.label} guideline until we see at least 3 nights where you wake up naturally. Mark mornings without an alarm in the journal to personalise this.`;

  return {
    needMin: rounded,
    sdMin: postSd,
    lowMin: Math.round((need - 1.28 * postSd) / 5) * 5,
    highMin: Math.round((need + 1.28 * postSd) / 5) * 5,
    confidence,
    method: personalized ? 'personalized' : 'age',
    evidence,
    naturalNightsUsed: natural?.n ?? 0,
    naturalNightsWanted: NATURAL_NIGHTS_WANTED,
    explanation,
  };
}
