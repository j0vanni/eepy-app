/**
 * Weekly review: one Monday–Sunday week of nights (by wake date) summarised — sleep vs need,
 * score, debt change, regularity, best/worst night, what changed vs the previous 3 weeks,
 * goal adherence, experiment status and one focus for next week.
 *
 * A week's review is "ready" on its Sunday, once the Sunday-morning night is in.
 */
import type { Analysis } from './analysis';
import {
  activeExperiment,
  computeExperimentResult,
  Experiment,
  experimentData,
  rankTemplates,
  suggestionInput,
  TEMPLATE_BY_ID,
} from './experiments';
import { goalAdherence, goalInput, GoalSetting } from './goals';
import type { Insight } from './insights';
import { regularityLabel, sleepRegularityIndex } from './regularity';
import type { Night } from './sessions';
import { debtOnDate } from './sleepDebt';
import { mean, welchTTest } from './stats';
import { addDays, circularMeanMinutes, circularSdMinutes, clockDiff, daysBetween, formatClock, formatDuration, minutesOfDay, startOfDateKey, weekdayOfKey } from './time';
import type { SleepDataset } from './types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Monday on or before `date`. */
export function weekStartOf(date: string): string {
  return addDays(date, -((weekdayOfKey(date) + 6) % 7));
}

/** The most recent week whose review is ready: this week on Sunday, otherwise last week. */
export function latestReviewWeek(today: string): string {
  const ws = weekStartOf(today);
  return weekdayOfKey(today) === 0 ? ws : addDays(ws, -7);
}

export function weekLabel(weekStart: string): string {
  const fmt = (k: string) => {
    const d = new Date(startOfDateKey(k) + 12 * 3600_000);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  };
  return `${fmt(weekStart)} – ${fmt(addDays(weekStart, 6))}`;
}

/** Weeks (Monday keys, newest first) that have at least one recorded night, up to the latest ready one. */
export function availableWeeks(nights: Night[], today: string, max = 8): string[] {
  const latest = latestReviewWeek(today);
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const ws = addDays(latest, -7 * i);
    if (nights.some((n) => n.main && n.wakeDate >= ws && n.wakeDate <= addDays(ws, 6))) out.push(ws);
  }
  return out;
}

export interface ReviewNight {
  date: string;
  sessionId?: string;
  sleepMin?: number;
  napMin: number;
  score?: number;
}

export interface ReviewChange {
  key: string;
  text: string;
  improved: boolean;
  /** |Cohen's d|, for ordering. */
  size: number;
}

export interface WeeklyReview {
  weekStart: string;
  weekEnd: string;
  label: string;
  /** All seven nights are over (it's Sunday or later). */
  ready: boolean;
  nightsRecorded: number;
  rows: ReviewNight[];
  needMin: number;
  avgSleepMin?: number;
  prevAvgSleepMin?: number;
  avgScore?: number;
  prevAvgScore?: number;
  debtStartMin: number;
  debtEndMin: number;
  debtChangeMin: number;
  regularity: { sri?: number; label: string; wakeSdMin?: number; onsetSdMin?: number; avgOnsetMin?: number; avgWakeMin?: number };
  best?: ReviewNight;
  worst?: ReviewNight;
  changes: ReviewChange[];
  insights: Insight[];
  goals: { id: string; title: string; met: number; known: number }[];
  goalScore?: number;
  experiment?: { id: string; title: string; status: Experiment['status']; text: string };
  focus: { title: string; detail: string; icon: string; templateId?: string; experimentId?: string };
  /** One-line summary for the notification / card. */
  headline: string;
  /** Persistent overnight SpO₂ dips (breathing check, last 30 nights) — latest week only. */
  breathing?: { title: string; detail: string };
}

interface Metric {
  key: string;
  label: string;
  higherIsBetter: boolean;
  get: (n: Night, a: Analysis, data: Pick<SleepDataset, 'vitals'>) => number | undefined;
  fmt: (d: number) => string;
  minDiff: number;
}

const CHANGE_METRICS: Metric[] = [
  { key: 'tst', label: 'Total sleep', higherIsBetter: true, get: (n) => n.totalSleepMin, fmt: (d) => formatDuration(Math.abs(d)), minDiff: 15 },
  { key: 'score', label: 'Sleep score', higherIsBetter: true, get: (n, a) => a.scores[n.main!.id]?.total, fmt: (d) => `${Math.round(Math.abs(d))} points`, minDiff: 3 },
  {
    key: 'latency',
    label: 'Time to fall asleep',
    higherIsBetter: false,
    get: (n) => (n.main!.latencyMin >= 1 ? n.main!.latencyMin : undefined),
    fmt: (d) => `${Math.round(Math.abs(d))} min`,
    minDiff: 4,
  },
  { key: 'deep', label: 'Deep sleep', higherIsBetter: true, get: (n) => n.main!.stagePct?.deep, fmt: (d) => `${Math.round(Math.abs(d) * 100)} points`, minDiff: 0.015 },
  { key: 'waso', label: 'Time awake at night', higherIsBetter: false, get: (n) => n.main!.wasoMin, fmt: (d) => `${Math.round(Math.abs(d))} min`, minDiff: 5 },
  { key: 'hrv', label: 'Overnight HRV', higherIsBetter: true, get: (n, _a, data) => data.vitals[n.main!.id]?.hrvRmssd, fmt: (d) => `${Math.round(Math.abs(d))} ms`, minDiff: 3 },
  { key: 'hr', label: 'Sleeping heart rate', higherIsBetter: false, get: (n, _a, data) => data.vitals[n.main!.id]?.hrMin, fmt: (d) => `${Math.round(Math.abs(d))} bpm`, minDiff: 2 },
];

function inRange(n: Night, from: string, to: string) {
  return !!n.main && n.wakeDate >= from && n.wakeDate <= to;
}

function compareWeeks(week: Night[], prev: Night[], a: Analysis, data: Pick<SleepDataset, 'vitals'>): ReviewChange[] {
  const out: ReviewChange[] = [];
  for (const m of CHANGE_METRICS) {
    const x = week.map((n) => m.get(n, a, data)).filter((v): v is number => v !== undefined);
    const y = prev.map((n) => m.get(n, a, data)).filter((v): v is number => v !== undefined);
    if (x.length < 3 || y.length < 6) continue;
    const r = welchTTest(x, y);
    if (!r || Math.abs(r.diff) < m.minDiff || Math.abs(r.d) < 0.4) continue;
    const improved = m.higherIsBetter ? r.diff > 0 : r.diff < 0;
    out.push({ key: m.key, text: `${m.label} ${r.diff > 0 ? 'up' : 'down'} ${m.fmt(r.diff)} vs your previous 3 weeks`, improved, size: Math.abs(r.d) });
  }
  // Bedtime drift is worth calling out on its own.
  const on = (ns: Night[]) => circularMeanMinutes(ns.map((n) => minutesOfDay(n.main!.sleepOnset)));
  const wOn = on(week);
  const pOn = on(prev);
  if (wOn !== undefined && pOn !== undefined && week.length >= 3 && prev.length >= 6) {
    const shift = clockDiff(pOn, wOn);
    if (Math.abs(shift) >= 25) {
      out.push({
        key: 'onset',
        text: `You fell asleep ${formatDuration(Math.abs(shift))} ${shift > 0 ? 'later' : 'earlier'} than the previous 3 weeks (around ${formatClock(wOn)})`,
        improved: shift < 0,
        size: Math.abs(shift) / 60,
      });
    }
  }
  return out.sort((p, q) => q.size - p.size).slice(0, 4);
}

export function buildWeeklyReview(input: {
  analysis: Analysis;
  data: Pick<SleepDataset, 'vitals' | 'dayLogs' | 'caffeine' | 'workouts' | 'profile'>;
  goals: GoalSetting[];
  experiments: Experiment[];
  weekStart: string;
}): WeeklyReview {
  const { analysis: a, data, goals, experiments } = input;
  const ws = weekStartOf(input.weekStart);
  const we = addDays(ws, 6);
  const today = a.day;
  const needMin = a.need.needMin;
  const byDate = new Map(a.nights.map((n) => [n.wakeDate, n]));

  const rows: ReviewNight[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(ws, i);
    const n = byDate.get(date);
    rows.push({
      date,
      sessionId: n?.main?.id,
      sleepMin: n?.main ? n.totalSleepMin : undefined,
      napMin: n ? n.naps.reduce((s, x) => s + x.totalSleepMin, 0) : 0,
      score: n?.main ? a.scores[n.main.id]?.total : undefined,
    });
  }
  const week = a.nights.filter((n) => inRange(n, ws, we));
  const prevWeek = a.nights.filter((n) => inRange(n, addDays(ws, -7), addDays(ws, -1)));
  const prev3 = a.nights.filter((n) => inRange(n, addDays(ws, -21), addDays(ws, -1)));

  const recorded = rows.filter((r) => r.sleepMin !== undefined);
  const scored = rows.filter((r) => r.score !== undefined);
  const avg = (xs: number[]) => (xs.length ? mean(xs) : undefined);
  const avgSleepMin = avg(recorded.map((r) => r.sleepMin!));
  const avgScore = avg(scored.map((r) => r.score!));
  const prevAvgSleepMin = avg(prevWeek.map((n) => n.totalSleepMin));
  const prevScores = prevWeek.map((n) => a.scores[n.main!.id]?.total).filter((x): x is number => x !== undefined);
  const prevAvgScore = avg(prevScores);

  const lastNight = we < today ? we : today;
  const debtStartMin = debtOnDate(a.nights, needMin, addDays(ws, -1));
  const debtEndMin = debtOnDate(a.nights, needMin, lastNight);

  const sriRes = sleepRegularityIndex(a.metrics, a.nights, addDays(ws, -1), addDays(lastNight, -1));
  const onsets = week.map((n) => minutesOfDay(n.main!.sleepOnset));
  const wakes = week.map((n) => minutesOfDay(n.main!.finalWake));
  const sri = sriRes.dayPairs >= 3 ? sriRes.sri : undefined;
  const regularity = {
    sri,
    label: regularityLabel(sri),
    wakeSdMin: circularSdMinutes(wakes),
    onsetSdMin: circularSdMinutes(onsets),
    avgOnsetMin: circularMeanMinutes(onsets),
    avgWakeMin: circularMeanMinutes(wakes),
  };

  const rank = (r: ReviewNight) => r.score ?? (r.sleepMin !== undefined ? (r.sleepMin / needMin) * 80 : -1);
  const best = recorded.length ? recorded.reduce((p, q) => (rank(q) > rank(p) ? q : p)) : undefined;
  const worst = recorded.length >= 2 ? recorded.reduce((p, q) => (rank(q) < rank(p) ? q : p)) : undefined;

  const gi = goalInput(a, data);
  const goalRows = goalAdherence(goals, gi, ws, we);
  const gMet = goalRows.reduce((s, g) => s + g.met, 0);
  const gKnown = goalRows.reduce((s, g) => s + g.known, 0);

  // Experiment: the active one, or one that ran during this week.
  const ed = experimentData(a, data);
  const during = experiments
    .filter((e) => e.status !== 'abandoned' && e.startDate <= we && addDays(e.startDate, e.durationDays) >= ws)
    .sort((p, q) => q.createdAt - p.createdAt)[0];
  const expForWeek = during ?? (ws === latestReviewWeek(today) ? activeExperiment(experiments) : undefined);
  let experiment: WeeklyReview['experiment'];
  let expResult: ReturnType<typeof computeExperimentResult> | undefined;
  if (expForWeek) {
    expResult = computeExperimentResult(expForWeek, ed);
    const r = expResult;
    const text =
      expForWeek.status === 'completed' && expForWeek.outcome
        ? `Finished: ${expForWeek.outcome.headline.toLowerCase()}.`
        : `${r.elapsed} of ${expForWeek.durationDays} nights done · kept ${r.kept}${r.adherencePct !== undefined ? ` (${Math.round(r.adherencePct * 100)}%)` : ''} · ${r.recommendation.title.toLowerCase()}`;
    experiment = { id: expForWeek.id, title: expForWeek.title, status: expForWeek.status, text };
  }

  // One focus for next week.
  let focus: WeeklyReview['focus'];
  const active = activeExperiment(experiments);
  const activeResult = active ? (active === expForWeek ? expResult : computeExperimentResult(active, ed)) : undefined;
  if (a.recoveryAlert && ws === latestReviewWeek(today)) {
    focus = { title: 'Take it easy', detail: 'Your recovery signals are off. Keep sleep regular and training light until they settle.', icon: 'heart-pulse' };
  } else if (active && activeResult && !activeResult.complete) {
    focus = {
      title: `Keep going: ${active.title}`,
      detail: `${activeResult.remaining} night${activeResult.remaining === 1 ? '' : 's'} left. ${activeResult.recommendation.title}.`,
      icon: TEMPLATE_BY_ID[active.templateId]?.icon ?? 'flask-outline',
      experimentId: active.id,
    };
  } else if (active && activeResult?.complete) {
    focus = { title: `Wrap up: ${active.title}`, detail: `All nights are in — ${activeResult.recommendation.title.toLowerCase()}.`, icon: 'flask-outline', experimentId: active.id };
  } else {
    const top = rankTemplates(suggestionInput(a, data, experiments))[0];
    focus = top
      ? {
          title: `Try: ${top.template.title.toLowerCase()}`,
          detail: `${top.reason ? `${top.reason}. ` : ''}A ${top.template.durationDays}-night experiment shows whether it helps you.`,
          icon: top.template.icon,
          templateId: top.template.id,
        }
      : { title: 'Keep a regular schedule', detail: 'Same wake time every day is the foundation for everything else.', icon: 'alarm-check' };
  }

  const changes = compareWeeks(week, prev3, a, data);
  const breathing = a.breathing?.level === 'frequent' && ws === latestReviewWeek(today) ? { title: a.breathing.title, detail: a.breathing.detail } : undefined;
  const headlineParts = [
    avgSleepMin !== undefined ? `Avg ${formatDuration(avgSleepMin)}` : undefined,
    avgScore !== undefined ? `score ${Math.round(avgScore)}` : undefined,
    best ? `best night ${WEEKDAYS[weekdayOfKey(addDays(best.date, -1))]}` : undefined,
  ].filter(Boolean);

  return {
    weekStart: ws,
    weekEnd: we,
    label: weekLabel(ws),
    ready: daysBetween(we, today) >= 0,
    nightsRecorded: recorded.length,
    rows,
    needMin,
    avgSleepMin,
    prevAvgSleepMin,
    avgScore,
    prevAvgScore,
    debtStartMin,
    debtEndMin,
    debtChangeMin: debtEndMin - debtStartMin,
    regularity,
    best,
    worst: worst && best && worst.date !== best.date ? worst : undefined,
    changes,
    insights: a.insights.filter((i) => !(breathing && i.id === 'physio:spo2-dips')).slice(0, 2),
    goals: goalRows,
    goalScore: gKnown > 0 ? Math.round((gMet / gKnown) * 100) : undefined,
    experiment,
    focus,
    headline: headlineParts.length ? headlineParts.join(' · ') : 'Not enough nights recorded this week',
    breathing,
  };
}

/** The night label used in reviews: "Thu night" for the night that ended on Friday morning. */
export function reviewNightLabel(wakeDate: string): string {
  return `${WEEKDAYS[weekdayOfKey(addDays(wakeDate, -1))]} night`;
}
