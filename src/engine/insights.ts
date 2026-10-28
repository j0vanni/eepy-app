import { caffeineDuringEarlySleep } from './caffeine';
import type { ChronotypeResult } from './chronotype';
import type { Night } from './sessions';
import { mean, median, pearson, welchTTest } from './stats';
import { TAG_BY_ID } from './tags';
import { addDays, clockDiff, DAY, formatClock, formatDuration, minutesOfDay, normalizeMinutes } from './time';
import type { CaffeineDose, DailyStats, DayLog, NightVitals, Profile } from './types';

export interface Insight {
  id: string;
  kind: 'positive' | 'negative' | 'neutral';
  category: 'habit' | 'timing' | 'consistency' | 'caffeine' | 'activity' | 'physiology' | 'duration';
  title: string;
  detail: string;
  evidence?: string;
  /** 0–1, used for ranking. */
  strength: number;
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

function compareGroups(withRows: NightRow[], withoutRows: NightRow[]) {
  let best: { metric: MetricDef; diff: number; p: number; d: number; mA: number; mB: number; nA: number; nB: number } | undefined;
  for (const metric of METRICS) {
    const a = withRows.map(metric.get).filter((x): x is number => x !== undefined);
    const b = withoutRows.map(metric.get).filter((x): x is number => x !== undefined);
    if (a.length < 3 || b.length < 3) continue;
    const res = welchTTest(a, b);
    if (!res || Math.abs(res.d) < 0.35) continue;
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

export function physiologyInsights(rows: NightRow[]): Insight[] {
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
  const spo2 = rows.map((r) => r.vitals?.spo2DipsPerHour).filter((x): x is number => x !== undefined);
  if (spo2.length >= 5 && median(spo2) >= 5) {
    out.push({
      id: 'physio:spo2-dips',
      kind: 'negative',
      category: 'physiology',
      title: 'Frequent overnight blood-oxygen dips',
      detail: `Your watch recorded a median of ${median(spo2).toFixed(1)} oxygen dips per hour. Wrist sensors are noisy, but combined with snoring or daytime sleepiness this is worth raising with a doctor (take the apnoea screen in Settings).`,
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

export function generateInsights(input: {
  rows: NightRow[];
  nights: Night[];
  dayLogs: Record<string, DayLog>;
  daily: Record<string, DailyStats>;
  caffeine: CaffeineDose[];
  profile: Profile;
  chronotype: ChronotypeResult;
  needMin: number;
}): Insight[] {
  const list: (Insight | undefined)[] = [
    durationInsight(input.nights, input.needMin),
    ...tagInsights(input.rows, input.dayLogs),
    bedtimeInsight(input.rows),
    consistencyInsight(input.rows, input.chronotype.habitual?.midSleepMin),
    caffeineInsight(input.rows, input.caffeine, input.profile),
    activityInsight(input.rows, input.daily),
    socialJetlagInsight(input.chronotype),
    ...physiologyInsights(input.rows),
  ];
  return list.filter((x): x is Insight => !!x).sort((a, b) => b.strength - a.strength);
}
