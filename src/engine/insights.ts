import type { BreathingTrend } from './breathing';
import { caffeineDuringEarlySleep } from './caffeine';
import type { ChronotypeResult } from './chronotype';
import type { Night } from './sessions';
import { mean, median, pearson, welchTTest } from './stats';
import { TAG_BY_ID } from './tags';
import { addDays, clockDiff, DAY, formatClock, formatDuration, minutesOfDay, normalizeMinutes } from './time';
import type { CaffeineDose, DailyStats, DayLog, NightVitals, Profile, Workout } from './types';
import { workoutCoverageStart, workoutsBeforeSleep } from './workouts';

export interface Insight {
  id: string;
  kind: 'positive' | 'negative' | 'neutral';
  category: 'habit' | 'timing' | 'consistency' | 'caffeine' | 'activity' | 'physiology' | 'duration';
  title: string;
  detail: string;
  evidence?: string;
  /** 0–1, used for ranking. */
  strength: number;
  /** The personal effect behind a group comparison (tags, caffeine, workouts), for other features to reuse. */
  effect?: InsightEffect;
}

/** "On nights with X, your {label} is {amount} {higher|lower}" in structured form. */
export interface InsightEffect {
  /** Metric key: score, tst, deep, rem, latency, waso, hrv, hr. */
  metric: string;
  label: string;
  /** With minus without, in the metric's own units (minutes, 0–1 shares, ms, bpm, points). */
  diff: number;
  /** Display amount without direction, e.g. "14 min", "5 percentage points". */
  amount: string;
  /** Whether the "with" nights were better on this metric. */
  better: boolean;
  p: number;
}

function effectOf(best: { metric: MetricDef; diff: number; p: number }): InsightEffect {
  const m = best.metric;
  return { metric: m.key, label: m.label, diff: best.diff, amount: m.fmt(best.diff), better: m.higherIsBetter ? best.diff > 0 : best.diff < 0, p: best.p };
}

interface MetricDef {
  key: string;
  label: string;
  higherIsBetter: boolean;
  get: (row: NightRow) => number | undefined;
  fmt: (diff: number) => string;
}

export interface NightRow {
  night: Night;
  score?: number;
  vitals?: NightVitals;
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)} percentage points`;

const METRICS: MetricDef[] = [
  { key: 'score', label: 'sleep score', higherIsBetter: true, get: (r) => r.score, fmt: (d) => `${Math.round(Math.abs(d))} points` },
  { key: 'tst', label: 'total sleep', higherIsBetter: true, get: (r) => r.night.main?.totalSleepMin, fmt: (d) => formatDuration(Math.abs(d)) },
  { key: 'deep', label: 'deep sleep', higherIsBetter: true, get: (r) => r.night.main?.stagePct?.deep, fmt: pct },
  { key: 'rem', label: 'REM sleep', higherIsBetter: true, get: (r) => r.night.main?.stagePct?.rem, fmt: pct },
  {
    key: 'latency',
    label: 'time to fall asleep',
    higherIsBetter: false,
    get: (r) => (r.night.main && r.night.main.latencyMin >= 1 ? r.night.main.latencyMin : undefined),
    fmt: (d) => `${Math.round(Math.abs(d))} min`,
  },
  { key: 'waso', label: 'time awake at night', higherIsBetter: false, get: (r) => r.night.main?.wasoMin, fmt: (d) => `${Math.round(Math.abs(d))} min` },
  { key: 'hrv', label: 'overnight HRV', higherIsBetter: true, get: (r) => r.vitals?.hrvRmssd, fmt: (d) => `${Math.round(Math.abs(d))} ms` },
  { key: 'hr', label: 'sleeping heart rate', higherIsBetter: false, get: (r) => r.vitals?.hrMin, fmt: (d) => `${Math.round(Math.abs(d))} bpm` },
];

/** Smallest difference worth reporting per metric (anything less would read as "0 min"). */
const MIN_DIFF: Record<string, number> = { score: 1, tst: 5, deep: 0.01, rem: 0.01, latency: 1, waso: 1, hrv: 1, hr: 1 };

/**
 * Best-separating metric between two groups of nights. `keys` limits the metrics considered;
 * `meaningful` skips differences too small to matter even when they are consistent.
 */
function compareGroups(withRows: NightRow[], withoutRows: NightRow[], opts: { keys?: string[]; meaningful?: boolean } = {}) {
  let best: { metric: MetricDef; diff: number; p: number; d: number; mA: number; mB: number; nA: number; nB: number } | undefined;
  for (const metric of opts.keys ? METRICS.filter((m) => opts.keys!.includes(m.key)) : METRICS) {
    const a = withRows.map(metric.get).filter((x): x is number => x !== undefined);
    const b = withoutRows.map(metric.get).filter((x): x is number => x !== undefined);
    if (a.length < 3 || b.length < 3) continue;
    const res = welchTTest(a, b);
    if (!res || Math.abs(res.d) < 0.35) continue;
    if (opts.meaningful && Math.abs(res.diff) < (MIN_DIFF[metric.key] ?? 0)) continue;
    if (!best || res.p < best.p) {
      best = { metric, diff: res.diff, p: res.p, d: res.d, mA: res.meanA, mB: res.meanB, nA: a.length, nB: b.length };
    }
  }
  return best;
}

function evidenceText(nA: number, nB: number, p: number): string {
  const conf = p < 0.05 ? 'strong signal' : p < 0.15 ? 'moderate signal' : 'early signal';
  return `${nA} vs ${nB} nights · ${conf} (p≈${p < 0.01 ? '<0.01' : p.toFixed(2)})`;
}

export function tagInsights(rows: NightRow[], dayLogs: Record<string, DayLog>): Insight[] {
  // Only nights whose preceding day was journaled can say whether a tag was absent.
  const journaled = rows.filter((r) => r.night.main && dayLogs[addDays(r.night.wakeDate, -1)]);
  const tags = new Set<string>();
  for (const r of journaled) for (const t of dayLogs[addDays(r.night.wakeDate, -1)].tags) tags.add(t);
  const out: Insight[] = [];
  for (const tag of tags) {
    const has = (r: NightRow) => dayLogs[addDays(r.night.wakeDate, -1)].tags.includes(tag);
    const best = compareGroups(journaled.filter(has), journaled.filter((r) => !has(r)));
    if (!best || best.p > 0.25) continue;
    const def = TAG_BY_ID[tag];
    const label = def?.phrase ?? tag;
    const better = best.metric.higherIsBetter ? best.diff > 0 : best.diff < 0;
    const dir = best.diff > 0 ? 'higher' : 'lower';
    out.push({
      id: `tag:${tag}`,
      kind: better ? 'positive' : 'negative',
      category: 'habit',
      title: `After ${label}, your ${best.metric.label} is ${best.metric.fmt(best.diff)} ${dir}`,
      detail: `Your ${best.metric.label} averaged ${fmtMetric(best.metric, best.mA)} on nights after ${label} vs ${fmtMetric(best.metric, best.mB)} otherwise.`,
      evidence: evidenceText(best.nA, best.nB, best.p),
      strength: (1 - best.p) * Math.min(1, Math.abs(best.d)),
      effect: effectOf(best),
    });
  }
  return out;
}

function fmtMetric(m: MetricDef, v: number): string {
  if (m.key === 'deep' || m.key === 'rem') return `${Math.round(v * 100)}%`;
  if (m.key === 'tst') return formatDuration(v);
  if (m.key === 'score') return String(Math.round(v));
  if (m.key === 'hrv') return `${Math.round(v)} ms`;
  if (m.key === 'hr') return `${Math.round(v)} bpm`;
  return `${Math.round(v)} min`;
}

/** Linearises evening/night clock times (18:00 → 0) so they can be binned. */
const sinceSix = (min: number) => normalizeMinutes(min - 18 * 60);

export function bedtimeInsight(rows: NightRow[]): Insight | undefined {
  const scored = rows.filter((r) => r.night.main && r.score !== undefined);
  if (scored.length < 14) return undefined;
  const bins = new Map<number, number[]>();
  for (const r of scored) {
    const b = Math.floor(sinceSix(minutesOfDay(r.night.main!.sleepOnset)) / 30);
    bins.set(b, [...(bins.get(b) ?? []), r.score!]);
  }
  const overall = mean(scored.map((r) => r.score!));
  let best: { bin: number; avg: number; n: number } | undefined;
  for (const [bin, scores] of bins) {
    if (scores.length < 3) continue;
    const avg = mean(scores);
    if (!best || avg > best.avg) best = { bin, avg, n: scores.length };
  }
  if (!best || best.avg - overall < 4) return undefined;
  const start = 18 * 60 + best.bin * 30;
  return {
    id: 'timing:best-bedtime',
    kind: 'positive',
    category: 'timing',
    title: `Your best sleep starts between ${formatClock(start)} and ${formatClock(start + 30)}`,
    detail: `Nights where you fell asleep in that window scored ${Math.round(best.avg)} on average, vs ${Math.round(overall)} overall.`,
    evidence: `${best.n} nights in window`,
    strength: Math.min(1, (best.avg - overall) / 15),
  };
}

export function consistencyInsight(rows: NightRow[], habitualMidMin?: number): Insight | undefined {
  if (habitualMidMin === undefined) return undefined;
  const pts = rows
    .filter((r) => r.night.main && r.score !== undefined)
    .map((r) => ({ off: Math.abs(clockDiff(habitualMidMin, minutesOfDay(r.night.main!.midSleep))), score: r.score! }));
  if (pts.length < 10) return undefined;
  const r = pearson(
    pts.map((p) => p.off),
    pts.map((p) => p.score),
  );
  const far = pts.filter((p) => p.off > 60).map((p) => p.score);
  const near = pts.filter((p) => p.off <= 60).map((p) => p.score);
  if (!(r < -0.25) || far.length < 3 || near.length < 3) return undefined;
  const gap = mean(near) - mean(far);
  return {
    id: 'consistency:offschedule',
    kind: 'negative',
    category: 'consistency',
    title: `Off-schedule nights cost you ${Math.round(gap)} points`,
    detail: `When the middle of your sleep drifts more than an hour from usual, your score averages ${Math.round(mean(far))} vs ${Math.round(mean(near))}. A fixed wake time is the strongest anchor.`,
    evidence: `${far.length} off-schedule vs ${near.length} regular nights · r=${r.toFixed(2)}`,
    strength: Math.min(1, Math.abs(r)),
  };
}

export function caffeineInsight(rows: NightRow[], doses: CaffeineDose[], profile: Profile): Insight | undefined {
  if (doses.length < 5) return undefined;
  const withC: NightRow[] = [];
  const without: NightRow[] = [];
  for (const r of rows) {
    const m = r.night.main;
    if (!m) continue;
    const relevant = doses.filter((d) => d.time < m.sleepOnset && d.time > m.sleepOnset - DAY);
    const mg = caffeineDuringEarlySleep(relevant, m.sleepOnset, profile.caffeineHalfLifeH);
    (mg > profile.caffeineBedtimeLimitMg ? withC : without).push(r);
  }
  const best = compareGroups(withC, without);
  if (!best || best.p > 0.25) return undefined;
  const better = best.metric.higherIsBetter ? best.diff > 0 : best.diff < 0;
  if (better) return undefined;
  return {
    id: 'caffeine:bedtime',
    kind: 'negative',
    category: 'caffeine',
    title: `Caffeine left at bedtime ${best.diff > 0 ? 'raises' : 'lowers'} your ${best.metric.label}`,
    detail: `On nights with more than ${profile.caffeineBedtimeLimitMg} mg of caffeine left at bedtime, your ${best.metric.label} was ${fmtMetric(best.metric, best.mA)} vs ${fmtMetric(best.metric, best.mB)}.`,
    evidence: evidenceText(best.nA, best.nB, best.p),
    strength: (1 - best.p) * Math.min(1, Math.abs(best.d)),
    effect: effectOf(best),
  };
}

export function activityInsight(rows: NightRow[], daily: Record<string, DailyStats>): Insight | undefined {
  const withSteps = rows.filter((r) => r.night.main && daily[addDays(r.night.wakeDate, -1)]?.steps !== undefined);
  if (withSteps.length < 14) return undefined;
  const stepsOf = (r: NightRow) => daily[addDays(r.night.wakeDate, -1)].steps!;
  const med = median(withSteps.map(stepsOf));
  const active = withSteps.filter((r) => stepsOf(r) > med);
  const quiet = withSteps.filter((r) => stepsOf(r) <= med);
  const best = compareGroups(active, quiet);
  if (!best || best.p > 0.25) return undefined;
  const better = best.metric.higherIsBetter ? best.diff > 0 : best.diff < 0;
  return {
    id: 'activity:steps',
    kind: better ? 'positive' : 'neutral',
    category: 'activity',
    title: `Active days (>${Math.round(med / 100) * 100} steps) ${better ? 'improve' : 'change'} your ${best.metric.label}`,
    detail: `${best.metric.label[0].toUpperCase()}${best.metric.label.slice(1)} averaged ${fmtMetric(best.metric, best.mA)} after active days vs ${fmtMetric(best.metric, best.mB)} after quieter ones.`,
    evidence: evidenceText(best.nA, best.nB, best.p),
    strength: (1 - best.p) * Math.min(1, Math.abs(best.d)),
  };
}

export function physiologyInsights(rows: NightRow[], breathing?: BreathingTrend): Insight[] {
  const out: Insight[] = [];
  const nadirs = rows
    .filter((r) => r.night.main && r.vitals?.hrNadirOffsetMin !== undefined)
    .map((r) => r.vitals!.hrNadirOffsetMin! / ((r.night.main!.finalWake - r.night.main!.sleepOnset) / 60000));
  if (nadirs.length >= 7) {
    const late = nadirs.filter((x) => x > 0.6).length / nadirs.length;
    if (late >= 0.35) {
      out.push({
        id: 'physio:late-nadir',
        kind: 'negative',
        category: 'physiology',
        title: `Your heart rate bottoms out late on ${Math.round(late * 100)}% of nights`,
        detail:
          'Ideally heart rate reaches its lowest point in the first half of the night. A late low point is often linked to late meals, alcohol or evening workouts still being processed.',
        strength: Math.min(1, late),
      });
    }
  }
  // Breathing check (breathing.ts): only its conservative "frequent dips" verdict becomes an insight.
  if (breathing?.level === 'frequent') {
    out.push({
      id: 'physio:spo2-dips',
      kind: 'negative',
      category: 'physiology',
      title: 'Frequent overnight blood-oxygen dips',
      detail: `${breathing.detail} The STOP-Bang check in Settings is a quick next step.`,
      evidence: `${breathing.analysable} nights with dense SpO₂ readings · median ${breathing.medianOdi3}/h`,
      strength: 0.7,
    });
  }
  return out;
}

export function durationInsight(nights: Night[], needMin: number): Insight | undefined {
  const recent = nights.filter((n) => n.main).slice(-14);
  if (recent.length < 5) return undefined;
  const avg = mean(recent.map((n) => n.totalSleepMin));
  const gap = needMin - avg;
  if (gap >= 30) {
    return {
      id: 'duration:short',
      kind: 'negative',
      category: 'duration',
      title: `You're averaging ${formatDuration(avg)} — ${formatDuration(gap)} under your need`,
      detail: 'Chronic short sleep accumulates as debt that dulls focus and mood even when you stop feeling sleepy. Moving bedtime earlier is usually easier than sleeping in.',
      evidence: `last ${recent.length} nights`,
      strength: Math.min(1, gap / 90),
    };
  }
  if (gap <= 10) {
    return {
      id: 'duration:met',
      kind: 'positive',
      category: 'duration',
      title: `You're meeting your sleep need (${formatDuration(avg)} average)`,
      detail: 'Keep protecting this — consistent, sufficient sleep is the foundation for everything else.',
      evidence: `last ${recent.length} nights`,
      strength: 0.4,
    };
  }
  return undefined;
}

export function socialJetlagInsight(chrono: ChronotypeResult): Insight | undefined {
  const sjl = chrono.socialJetlagMin;
  if (sjl === undefined) return undefined;
  if (sjl >= 60) {
    return {
      id: 'timing:social-jetlag',
      kind: 'negative',
      category: 'timing',
      title: `${formatDuration(sjl)} of social jet lag`,
      detail:
        'Your sleep on free days is shifted compared with workdays — like flying across time zones every weekend. Keep weekend wake-ups within an hour of weekdays and get morning light.',
      strength: Math.min(1, sjl / 120),
    };
  }
  if (sjl <= 30) {
    return {
      id: 'timing:aligned',
      kind: 'positive',
      category: 'timing',
      title: 'Workday and weekend timing are well aligned',
      detail: `Only ${formatDuration(sjl)} difference in mid-sleep between workdays and free days.`,
      strength: 0.3,
    };
  }
  return undefined;
}

/** "you take 14 min longer to fall asleep" / "your deep sleep is 4 percentage points higher". */
function effectPhrase(m: MetricDef, diff: number): string {
  if (m.key === 'latency') return diff > 0 ? `you take ${m.fmt(diff)} longer to fall asleep` : `you fall asleep ${m.fmt(diff)} faster`;
  return `your ${m.label} is ${m.fmt(diff)} ${diff > 0 ? 'higher' : 'lower'}`;
}

const capitalize = (x: string) => `${x[0].toUpperCase()}${x.slice(1)}`;

/** Metrics that evening exercise plausibly moves (core temperature, arousal, recovery). */
const WORKOUT_METRICS = ['latency', 'deep', 'hr', 'score'];

/**
 * Workout timing: nights after a workout that ended < 2 h before sleep onset vs nights after
 * earlier workouts or rest days, and workout days vs rest days. Empty when the watch records no
 * workouts (Nothing X may not write exercise sessions to Health Connect).
 */
export function workoutInsights(rows: NightRow[], workouts: Workout[] = []): Insight[] {
  const since = workoutCoverageStart(workouts);
  if (since === undefined) return [];
  // Before the first recorded workout, "no workout" may just mean "not syncing workouts yet".
  const covered = rows.filter((r) => r.night.main && r.night.main.sleepOnset >= since);
  if (covered.length < 6) return [];
  const byNight = workoutsBeforeSleep(
    covered.map((r) => ({ wakeDate: r.night.wakeDate, sleepOnset: r.night.main!.sleepOnset })),
    workouts,
  );
  const info = (r: NightRow) => byNight.get(r.night.wakeDate);
  const out: Insight[] = [];

  const late = covered.filter((r) => info(r)?.timing === 'late');
  const notLate = covered.filter((r) => info(r)?.timing !== 'late');
  const lateBest = compareGroups(late, notLate, { keys: WORKOUT_METRICS, meaningful: true });
  if (lateBest && lateBest.p <= 0.25) {
    const m = lateBest.metric;
    const better = m.higherIsBetter ? lateBest.diff > 0 : lateBest.diff < 0;
    out.push({
      id: 'workout:late',
      kind: better ? 'positive' : 'negative',
      category: 'activity',
      title: `After late workouts, ${effectPhrase(m, lateBest.diff)}`,
      detail: better
        ? `On nights after a workout that ended within 2 hours of falling asleep, your ${m.label} averaged ${fmtMetric(m, lateBest.mA)} vs ${fmtMetric(m, lateBest.mB)} otherwise. Evening exercise seems to suit you — most studies find it's fine unless it's very intense right before bed.`
        : `On nights when a workout ended less than 2 hours before you fell asleep, your ${m.label} averaged ${fmtMetric(m, lateBest.mA)} vs ${fmtMetric(m, lateBest.mB)} after earlier workouts or rest days. Hard exercise keeps heart rate and body temperature up for a while — if you can, finish intense sessions 2–3 hours before bed, or keep late ones easy.`,
      evidence: evidenceText(lateBest.nA, lateBest.nB, lateBest.p),
      strength: (1 - lateBest.p) * Math.min(1, Math.abs(lateBest.d)),
      effect: effectOf(lateBest),
    });
  } else if (!lateBest) {
    // Only claim "no effect" when there was enough data to see one.
    const enough = METRICS.filter((m) => WORKOUT_METRICS.includes(m.key)).some(
      (m) => late.filter((r) => m.get(r) !== undefined).length >= 5 && notLate.filter((r) => m.get(r) !== undefined).length >= 5,
    );
    if (enough) {
      out.push({
        id: 'workout:late-ok',
        kind: 'positive',
        category: 'activity',
        title: "Late workouts don't seem to disturb your sleep",
        detail: `Across ${late.length} nights with a workout ending within 2 hours of falling asleep, your time to fall asleep, deep sleep, sleeping heart rate and score look much the same as on other nights. That matches most research: evening exercise is fine for most people unless it's very intense right before bed.`,
        evidence: `${late.length} vs ${notLate.length} nights · no clear difference`,
        strength: 0.25,
      });
    }
  }

  const active = covered.filter((r) => info(r)?.active);
  const rest = covered.filter((r) => (info(r)?.workouts.length ?? 0) === 0);
  const dayBest = compareGroups(active, rest, { meaningful: true });
  if (dayBest && dayBest.p <= 0.25) {
    const m = dayBest.metric;
    const better = m.higherIsBetter ? dayBest.diff > 0 : dayBest.diff < 0;
    const avg = `${capitalize(m.label)} averaged ${fmtMetric(m, dayBest.mA)} after days with a workout vs ${fmtMetric(m, dayBest.mB)} after rest days.`;
    out.push({
      id: 'workout:days',
      kind: better ? 'positive' : 'neutral',
      category: 'activity',
      title: `On workout days, ${effectPhrase(m, dayBest.diff)}`,
      detail: better
        ? `${avg} Regular exercise is one of the better-supported ways to sleep more deeply.`
        : m.key === 'hr'
          ? `${avg} A slightly higher sleeping heart rate after hard training is a normal recovery response; if it stays up for days, take an easier day.`
          : `${avg} This is often temporary after hard or unusually long sessions — worth watching if you've recently stepped up training.`,
      evidence: evidenceText(dayBest.nA, dayBest.nB, dayBest.p),
      strength: (1 - dayBest.p) * Math.min(1, Math.abs(dayBest.d)),
      effect: effectOf(dayBest),
    });
  }
  return out;
}

export function generateInsights(input: {
  rows: NightRow[];
  nights: Night[];
  dayLogs: Record<string, DayLog>;
  daily: Record<string, DailyStats>;
  caffeine: CaffeineDose[];
  profile: Profile;
  chronotype: ChronotypeResult;
  needMin: number;
  /** Watch-recorded workouts (used by workout-timing insights). */
  workouts?: Workout[];
  /** 30-night breathing check (SpO₂ dips). */
  breathing?: BreathingTrend;
}): Insight[] {
  const list: (Insight | undefined)[] = [
    durationInsight(input.nights, input.needMin),
    ...tagInsights(input.rows, input.dayLogs),
    bedtimeInsight(input.rows),
    consistencyInsight(input.rows, input.chronotype.habitual?.midSleepMin),
    caffeineInsight(input.rows, input.caffeine, input.profile),
    activityInsight(input.rows, input.daily),
    socialJetlagInsight(input.chronotype),
    ...physiologyInsights(input.rows, input.breathing),
    ...workoutInsights(input.rows, input.workouts),
  ];
  return list.filter((x): x is Insight => !!x).sort((a, b) => b.strength - a.strength);
}
