/**
 * Personal experiments ("no caffeine after 14:00 for 7 nights"): templates, adherence tracking
 * and a before/after comparison using the same Welch t-test as the insight engine.
 *
 * Day semantics: experiment day D is a calendar day whose behaviour (evening caffeine, screens,
 * morning light, …) affects the night that ends on the morning of D+1. Adherence answers are keyed
 * by D; the night analysed for D is the main sleep with wakeDate D+1.
 */
import type { Analysis } from './analysis';
import type { Tip } from './coach';
import type { Insight } from './insights';
import type { Night } from './sessions';
import { mean, welchTTest } from './stats';
import { addDays, atMinutes, clockDiff, dateKey, daysBetween, formatClock, formatDuration, minutesOfDay } from './time';
import type { CaffeineDose, DayLog, NightVitals, SleepDataset, Workout } from './types';

export type RecommendationKind = 'keep' | 'extend' | 'no-effect' | 'too-early';

export interface Experiment {
  id: string;
  templateId: string;
  title: string;
  /** First date (YYYY-MM-DD) of the experiment period. */
  startDate: string;
  durationDays: number;
  status: 'active' | 'completed' | 'abandoned';
  createdAt: number;
  /** Manual adherence answers per date, when it can't be inferred from data. */
  adherence: Record<string, boolean>;
  /** Template parameter fixed at start (target wake time / lights-out, minutes after midnight). */
  targetMin?: number;
  finishedAt?: number;
  /** Snapshot of the result when the experiment was finished (old nights eventually leave the analysis window). */
  outcome?: { kind: RecommendationKind; headline: string; adherencePct?: number; nights: number };
}

// ---------- Metrics ----------

export type ExperimentMetricKey = 'latency' | 'score' | 'deep' | 'rem' | 'tst' | 'waso' | 'hrv' | 'hr' | 'energy';

export interface ExperimentRow {
  night: Night;
  score?: number;
  vitals?: NightVitals;
  /** Daytime energy (1–5) logged on the day after the night. */
  energy?: number;
}

interface MetricSpec {
  key: ExperimentMetricKey;
  label: string;
  higherIsBetter: boolean;
  get: (r: ExperimentRow) => number | undefined;
  /** Formats an absolute difference. */
  diff: (d: number) => string;
  value: (v: number) => string;
  /** Differences smaller than this are "no real change", whatever the p-value. */
  minDiff: number;
}

const minutes = (d: number) => `${Math.round(Math.abs(d))} min`;

export const EXPERIMENT_METRICS: Record<ExperimentMetricKey, MetricSpec> = {
  latency: {
    key: 'latency',
    label: 'Time to fall asleep',
    higherIsBetter: false,
    get: (r) => (r.night.main && r.night.main.latencyMin >= 1 ? r.night.main.latencyMin : undefined),
    diff: minutes,
    value: (v) => `${Math.round(v)} min`,
    minDiff: 2,
  },
  score: {
    key: 'score',
    label: 'Sleep score',
    higherIsBetter: true,
    get: (r) => r.score,
    diff: (d) => `${Math.round(Math.abs(d))} points`,
    value: (v) => String(Math.round(v)),
    minDiff: 2,
  },
  deep: {
    key: 'deep',
    label: 'Deep sleep',
    higherIsBetter: true,
    get: (r) => r.night.main?.stagePct?.deep,
    diff: (d) => `${Math.round(Math.abs(d) * 100)} percentage points`,
    value: (v) => `${Math.round(v * 100)}%`,
    minDiff: 0.01,
  },
  rem: {
    key: 'rem',
    label: 'REM sleep',
    higherIsBetter: true,
    get: (r) => r.night.main?.stagePct?.rem,
    diff: (d) => `${Math.round(Math.abs(d) * 100)} percentage points`,
    value: (v) => `${Math.round(v * 100)}%`,
    minDiff: 0.01,
  },
  tst: {
    key: 'tst',
    label: 'Total sleep',
    higherIsBetter: true,
    get: (r) => r.night.main?.totalSleepMin,
    diff: (d) => formatDuration(Math.abs(d)),
    value: (v) => formatDuration(v),
    minDiff: 8,
  },
  waso: {
    key: 'waso',
    label: 'Time awake at night',
    higherIsBetter: false,
    get: (r) => r.night.main?.wasoMin,
    diff: minutes,
    value: (v) => `${Math.round(v)} min`,
    minDiff: 3,
  },
  hrv: {
    key: 'hrv',
    label: 'Overnight HRV',
    higherIsBetter: true,
    get: (r) => r.vitals?.hrvRmssd,
    diff: (d) => `${Math.round(Math.abs(d))} ms`,
    value: (v) => `${Math.round(v)} ms`,
    minDiff: 2,
  },
  hr: {
    key: 'hr',
    label: 'Sleeping heart rate',
    higherIsBetter: false,
    get: (r) => r.vitals?.hrMin,
    diff: (d) => `${Math.round(Math.abs(d))} bpm`,
    value: (v) => `${Math.round(v)} bpm`,
    minDiff: 1,
  },
  energy: {
    key: 'energy',
    label: 'Daytime energy',
    higherIsBetter: true,
    get: (r) => r.energy,
    diff: (d) => `${(Math.round(Math.abs(d) * 10) / 10).toFixed(1)} points`,
    value: (v) => `${(Math.round(v * 10) / 10).toFixed(1)}/5`,
    minDiff: 0.2,
  },
};

// ---------- Templates ----------

export type AdherenceRule =
  /** No logged caffeine after a clock time (and no "late caffeine" journal tag). */
  | { kind: 'caffeine-cutoff'; cutoffMin: number }
  /** A journal tag must be absent. With `absenceCounts`, a journaled evening without the tag counts as kept. */
  | { kind: 'avoid-tag'; tags: string[]; absenceCounts: boolean }
  /** A journal tag must be present (and none of `unless`). */
  | { kind: 'do-tag'; tags: string[]; unless?: string[] }
  /** Final wake within ±tolerance of the experiment's target wake time. */
  | { kind: 'wake-window'; toleranceMin: number }
  /** In bed no later than the experiment's target lights-out + tolerance. */
  | { kind: 'bedtime-by'; toleranceMin: number }
  | { kind: 'no-naps' }
  /** Some exercise, all finished before a clock time (workouts from the watch or journal tags). */
  | { kind: 'exercise-before'; clockMin: number };

export interface ExperimentTemplate {
  id: string;
  title: string;
  /** The rule in one line; `{target}` is replaced with the experiment's target time. */
  rule: string;
  why: string;
  icon: string;
  durationDays: 7 | 14;
  metrics: ExperimentMetricKey[];
  adherence: AdherenceRule;
  /** Yes/No question about day D, asked the next morning when adherence can't be inferred. */
  question: string;
  /** Daily nudge: when (relative to a clock time, tonight's bedtime or the wake time) and what. */
  reminder: { anchor: 'clock' | 'bedtime' | 'wake' | 'target'; offsetMin: number; text: string };
  /** Whether the morning question is usually needed (journal/self-report rules). */
  askByDefault: boolean;
  /** Insight ids (with the effect direction that makes this template relevant) and tip ids. */
  relevance: { insights: { id: string; kind?: Insight['kind'] }[]; tips: string[] };
  /** Small prior so the default ordering is sensible. */
  base: number;
}

export const EXPERIMENT_TEMPLATES: ExperimentTemplate[] = [
  {
    id: 'caffeine-cutoff',
    title: 'Caffeine cut-off at 14:00',
    rule: 'No coffee, tea, cola or energy drinks after 14:00',
    why: "Caffeine's half-life is about five hours, so an afternoon coffee is still half-active at bedtime. In lab studies, caffeine even six hours before bed cut total sleep by about an hour.",
    icon: 'coffee-off-outline',
    durationDays: 7,
    metrics: ['latency', 'deep', 'score', 'tst'],
    adherence: { kind: 'caffeine-cutoff', cutoffMin: 14 * 60 },
    question: 'Did you skip caffeine after 14:00 yesterday?',
    reminder: { anchor: 'clock', offsetMin: 13 * 60 + 30, text: 'No caffeine after 14:00 today — decaf or herbal tea from here on.' },
    askByDefault: false,
    relevance: { insights: [{ id: 'caffeine:bedtime' }, { id: 'tag:late-caffeine', kind: 'negative' }], tips: ['caffeine', 'latency', 'deep'] },
    base: 12,
  },
  {
    id: 'no-alcohol',
    title: 'Alcohol-free evenings',
    rule: 'No alcohol',
    why: 'Alcohol sedates at first but fragments the second half of the night and suppresses REM sleep. Even moderate drinking measurably lowers overnight HRV and raises sleeping heart rate.',
    icon: 'glass-cocktail-off',
    durationDays: 7,
    metrics: ['hrv', 'hr', 'rem', 'waso', 'score'],
    adherence: { kind: 'avoid-tag', tags: ['alcohol'], absenceCounts: true },
    question: 'Did you skip alcohol yesterday?',
    reminder: { anchor: 'clock', offsetMin: 18 * 60, text: 'Alcohol-free evening tonight — try sparkling water or a tea instead.' },
    askByDefault: true,
    relevance: { insights: [{ id: 'tag:alcohol', kind: 'negative' }, { id: 'physio:late-nadir' }], tips: ['rem', 'deep'] },
    base: 10,
  },
  {
    id: 'no-screens',
    title: 'Screens off 30 min before bed',
    rule: 'Phone, laptop and TV off 30 minutes before lights out',
    why: 'Scrolling keeps your brain engaged right when it should be winding down, and evening screen light slightly delays melatonin. A screen-free buffer helps many people fall asleep sooner.',
    icon: 'cellphone-off',
    durationDays: 7,
    metrics: ['latency', 'score', 'waso'],
    adherence: { kind: 'avoid-tag', tags: ['screens'], absenceCounts: false },
    question: 'Did you keep screens away for the last 30 minutes before bed?',
    reminder: { anchor: 'bedtime', offsetMin: -40, text: 'Screens away in 10 minutes — charge your phone outside the bedroom tonight.' },
    askByDefault: true,
    relevance: { insights: [{ id: 'tag:screens', kind: 'negative' }], tips: ['latency', 'wind-down'] },
    base: 11,
  },
  {
    id: 'consistent-wake',
    title: 'Same wake time every day',
    rule: 'Up at {target} ±15 min, weekends included',
    why: 'A fixed wake time is the strongest anchor for your body clock. Regular sleepers fall asleep faster and feel less groggy, and irregular schedules are linked to worse mood and metabolism.',
    icon: 'alarm-check',
    durationDays: 14,
    metrics: ['latency', 'score', 'energy', 'waso'],
    adherence: { kind: 'wake-window', toleranceMin: 15 },
    question: 'Did you get up within 15 minutes of {target}?',
    reminder: { anchor: 'bedtime', offsetMin: -60, text: 'Alarm set for {target}? Same time tomorrow, weekend or not.' },
    askByDefault: false,
    relevance: {
      insights: [{ id: 'consistency:offschedule' }, { id: 'timing:social-jetlag' }],
      tips: ['regularity', 'sjl'],
    },
    base: 13,
  },
  {
    id: 'morning-light',
    title: '10 minutes of morning light',
    rule: '10+ minutes outdoors within an hour of waking',
    why: 'Morning daylight is the main signal that sets your body clock: it moves evening sleepiness earlier and boosts daytime alertness. Even an overcast sky is many times brighter than indoor light.',
    icon: 'white-balance-sunny',
    durationDays: 14,
    metrics: ['latency', 'energy', 'score'],
    adherence: { kind: 'do-tag', tags: ['outdoor-light'] },
    question: 'Did you get 10+ minutes of daylight within an hour of waking yesterday?',
    reminder: { anchor: 'wake', offsetMin: 15, text: 'Step outside for 10 minutes of daylight — no sunglasses needed.' },
    askByDefault: true,
    relevance: { insights: [{ id: 'tag:outdoor-light', kind: 'positive' }, { id: 'timing:social-jetlag' }], tips: ['owl', 'sjl'] },
    base: 9,
  },
  {
    id: 'earlier-bedtime',
    title: 'Bedtime 30 minutes earlier',
    rule: 'Lights out by {target}',
    why: 'Most adults run short on workday sleep, and going to bed earlier is easier on your body clock than sleeping in. Thirty extra minutes a night adds up to three and a half hours a week.',
    icon: 'bed-clock',
    durationDays: 7,
    metrics: ['tst', 'score', 'energy', 'latency'],
    adherence: { kind: 'bedtime-by', toleranceMin: 15 },
    question: 'Were you in bed with the lights out by {target}?',
    reminder: { anchor: 'target', offsetMin: -45, text: 'Lights out at {target} tonight — time to start winding down.' },
    askByDefault: false,
    relevance: { insights: [{ id: 'duration:short' }, { id: 'timing:best-bedtime' }], tips: ['debt'] },
    base: 10,
  },
  {
    id: 'no-late-meals',
    title: 'No food within 3 hours of bed',
    rule: 'Finish eating 3 hours before lights out',
    why: 'Digesting a big meal keeps heart rate and core temperature up, so your heart rate settles later in the night. Finishing dinner earlier lets it dip sooner and deeper.',
    icon: 'food-off',
    durationDays: 7,
    metrics: ['hr', 'hrv', 'waso', 'score'],
    adherence: { kind: 'avoid-tag', tags: ['late-meal'], absenceCounts: true },
    question: 'Did you finish eating at least 3 hours before bed?',
    reminder: { anchor: 'bedtime', offsetMin: -195, text: 'Kitchen closes in 15 minutes — last food 3 hours before bed.' },
    askByDefault: true,
    relevance: { insights: [{ id: 'tag:late-meal', kind: 'negative' }, { id: 'physio:late-nadir' }], tips: [] },
    base: 7,
  },
  {
    id: 'exercise-early',
    title: 'Exercise before 18:00',
    rule: '20+ minutes of exercise, finished before 18:00',
    why: 'Regular daytime exercise is one of the most reliable ways to deepen sleep. Hard sessions close to bedtime can keep your heart rate up, so finishing earlier gets the benefit without the delay.',
    icon: 'run-fast',
    durationDays: 14,
    metrics: ['deep', 'latency', 'hr', 'score'],
    adherence: { kind: 'exercise-before', clockMin: 18 * 60 },
    question: 'Did you exercise yesterday and finish before 18:00?',
    reminder: { anchor: 'clock', offsetMin: 16 * 60 + 30, text: 'Still time to move — 20 minutes of exercise, finished by 18:00.' },
    askByDefault: true,
    relevance: {
      insights: [{ id: 'tag:exercise', kind: 'positive' }, { id: 'tag:late-exercise', kind: 'negative' }, { id: 'activity:steps', kind: 'positive' }],
      tips: ['deep'],
    },
    base: 8,
  },
  {
    id: 'cool-bedroom',
    title: 'Cool bedroom (18–20 °C)',
    rule: 'Bedroom at about 18–20 °C (65–68 °F) at lights out',
    why: 'Your core temperature has to fall for you to drop off and stay asleep. A cool room is linked to less night-time waking and more deep sleep.',
    icon: 'thermometer-low',
    durationDays: 7,
    metrics: ['waso', 'deep', 'score', 'latency'],
    adherence: { kind: 'avoid-tag', tags: ['warm-room'], absenceCounts: false },
    question: 'Was your bedroom cool (about 18–20 °C) last night?',
    reminder: { anchor: 'bedtime', offsetMin: -60, text: 'Cool the bedroom now — open a window or turn the heating down to 18–20 °C.' },
    askByDefault: true,
    relevance: { insights: [{ id: 'tag:warm-room', kind: 'negative' }], tips: ['environment', 'deep'] },
    base: 6,
  },
  {
    id: 'no-naps',
    title: 'No naps',
    rule: 'Skip daytime naps — save your sleep pressure for the night',
    why: 'Naps release some of the sleep pressure that helps you fall asleep at night. If you lie awake at bedtime, a week without naps often shortens the time it takes to drop off.',
    icon: 'sleep-off',
    durationDays: 7,
    metrics: ['latency', 'waso', 'tst', 'score'],
    adherence: { kind: 'no-naps' },
    question: 'Did you skip naps yesterday?',
    reminder: { anchor: 'clock', offsetMin: 13 * 60, text: 'No nap today — a short walk in daylight beats the afternoon dip.' },
    askByDefault: false,
    relevance: { insights: [{ id: 'tag:nap', kind: 'negative' }], tips: ['efficiency', 'latency'] },
    base: 5,
  },
  {
    id: 'read-not-phone',
    title: 'Read instead of scrolling',
    rule: 'Swap your phone for a paper book in bed',
    why: 'A printed book is calming and ends naturally, while feeds are designed to keep you going. People who read on paper before bed tend to fall asleep sooner than those reading on a phone.',
    icon: 'book-open-variant',
    durationDays: 7,
    metrics: ['latency', 'score', 'waso'],
    adherence: { kind: 'do-tag', tags: ['reading'], unless: ['screens'] },
    question: 'Did you read a book instead of using your phone in bed?',
    reminder: { anchor: 'bedtime', offsetMin: -30, text: 'Phone down, book up — lights out in 30 minutes.' },
    askByDefault: true,
    relevance: { insights: [{ id: 'tag:reading', kind: 'positive' }, { id: 'tag:screens', kind: 'negative' }], tips: ['latency', 'wind-down'] },
    base: 8,
  },
  {
    id: 'slow-breathing',
    title: 'Slow breathing at bedtime',
    rule: '5–10 minutes of slow breathing or meditation before lights out',
    why: 'Breathing at about six breaths a minute shifts your nervous system toward rest. It is a well-studied way to quiet a racing mind and can nudge overnight HRV up.',
    icon: 'weather-windy',
    durationDays: 7,
    metrics: ['latency', 'hrv', 'waso'],
    adherence: { kind: 'do-tag', tags: ['meditation'] },
    question: 'Did you do slow breathing or meditation before bed?',
    reminder: { anchor: 'bedtime', offsetMin: -20, text: 'Try 5 minutes of slow breathing before lights out — in for 4, out for 6.' },
    askByDefault: true,
    relevance: { insights: [{ id: 'tag:meditation', kind: 'positive' }, { id: 'tag:stress', kind: 'negative' }], tips: ['latency', 'wind-down'] },
    base: 7,
  },
];

export const TEMPLATE_BY_ID: Record<string, ExperimentTemplate> = Object.fromEntries(EXPERIMENT_TEMPLATES.map((t) => [t.id, t]));

export function templateFor(e: Pick<Experiment, 'templateId'>): ExperimentTemplate | undefined {
  return TEMPLATE_BY_ID[e.templateId];
}

/** Fills `{target}` placeholders with the experiment's target time. */
export function fillTarget(text: string, targetMin?: number): string {
  return text.replace(/\{target\}/g, targetMin !== undefined ? formatClock(targetMin) : 'your target time');
}

export function experimentRule(e: Experiment): string {
  const t = templateFor(e);
  return t ? fillTarget(t.rule, e.targetMin) : e.title;
}

export function experimentQuestion(e: Experiment): string {
  const t = templateFor(e);
  return t ? fillTarget(t.question, e.targetMin) : `Did you stick to "${e.title}"?`;
}

const round5 = (m: number) => Math.round(m / 5) * 5;

/** Default parameter for templates that need one (target wake / lights-out), from the user's own data. */
export function defaultTargetMin(
  template: ExperimentTemplate,
  a: Pick<Analysis, 'chronotype' | 'latencyMin'> & { profile?: { workWakeMin: number } },
): number | undefined {
  if (template.adherence.kind === 'wake-window') {
    return round5(a.chronotype.habitualWork?.wakeMin ?? a.chronotype.habitual?.wakeMin ?? a.profile?.workWakeMin ?? 7 * 60);
  }
  if (template.adherence.kind === 'bedtime-by') {
    const onset = a.chronotype.habitual?.onsetMin ?? 23 * 60 + 15;
    return round5(((onset - a.latencyMin - 30) % 1440 + 1440) % 1440);
  }
  return undefined;
}

export function createExperiment(
  template: ExperimentTemplate,
  opts: { startDate: string; now: number; targetMin?: number; id?: string },
): Experiment {
  return {
    id: opts.id ?? `exp-${template.id}-${opts.now.toString(36)}`,
    templateId: template.id,
    title: template.title,
    startDate: opts.startDate,
    durationDays: template.durationDays,
    status: 'active',
    createdAt: opts.now,
    adherence: {},
    targetMin: opts.targetMin,
  };
}

// ---------- Adherence ----------

/** Everything the experiment models read (built from the analysis + stored data). */
export interface ExperimentData {
  /** The day the user is "living" (Analysis.day). */
  today: string;
  nights: Night[];
  scores: Record<string, { total: number }>;
  vitals: Record<string, NightVitals>;
  dayLogs: Record<string, DayLog>;
  caffeine: CaffeineDose[];
  workouts?: Workout[];
}

export function experimentData(a: Pick<Analysis, 'day' | 'nights' | 'scores'>, data: Pick<SleepDataset, 'vitals' | 'dayLogs' | 'caffeine' | 'workouts'>): ExperimentData {
  return { today: a.day, nights: a.nights, scores: a.scores, vitals: data.vitals, dayLogs: data.dayLogs, caffeine: data.caffeine, workouts: data.workouts };
}

export interface Adherence {
  value?: boolean;
  source: 'manual' | 'data' | 'none';
  /** Short explanation of an inferred value. */
  reason?: string;
}

const tagsOn = (d: ExperimentData, date: string) => d.dayLogs[date]?.tags ?? [];

/** Infers whether day `date` followed the rule, from logs and watch data. Undefined when it can't tell. */
export function inferAdherence(e: Pick<Experiment, 'templateId' | 'targetMin'>, date: string, d: ExperimentData): Adherence {
  const t = templateFor(e);
  if (!t) return { source: 'none' };
  const rule = t.adherence;
  const tags = tagsOn(d, date);
  const nightAfter = d.nights.find((n) => n.wakeDate === addDays(date, 1) && n.main);
  switch (rule.kind) {
    case 'caffeine-cutoff': {
      const from = atMinutes(date, rule.cutoffMin);
      const to = atMinutes(date, 28 * 60);
      const late = d.caffeine.find((c) => c.time >= from && c.time < to);
      if (late) return { value: false, source: 'data', reason: `${late.label || 'Caffeine'} logged at ${formatClock(minutesOfDay(late.time))}` };
      if (tags.includes('late-caffeine')) return { value: false, source: 'data', reason: 'Journal: late caffeine' };
      // Only trust "nothing logged" from someone who actually logs caffeine.
      const lo = atMinutes(addDays(date, -14), 0);
      const hi = atMinutes(addDays(date, 2), 0);
      if (d.caffeine.some((c) => c.time >= lo && c.time < hi)) return { value: true, source: 'data', reason: 'No caffeine logged after the cut-off' };
      return { source: 'none' };
    }
    case 'avoid-tag': {
      const hit = rule.tags.find((x) => tags.includes(x));
      if (hit) return { value: false, source: 'data', reason: 'Logged in your journal' };
      if (rule.absenceCounts && tags.length > 0) return { value: true, source: 'data', reason: 'Journaled that evening without it' };
      return { source: 'none' };
    }
    case 'do-tag': {
      if ((rule.unless ?? []).some((x) => tags.includes(x))) return { value: false, source: 'data', reason: 'Journal: screens in bed' };
      if (rule.tags.some((x) => tags.includes(x))) return { value: true, source: 'data', reason: 'Logged in your journal' };
      return { source: 'none' };
    }
    case 'wake-window': {
      if (e.targetMin === undefined || !nightAfter?.main) return { source: 'none' };
      const off = clockDiff(e.targetMin, minutesOfDay(nightAfter.main.finalWake));
      const ok = Math.abs(off) <= rule.toleranceMin;
      return { value: ok, source: 'data', reason: `Woke at ${formatClock(minutesOfDay(nightAfter.main.finalWake))}` };
    }
    case 'bedtime-by': {
      if (e.targetMin === undefined || !nightAfter?.main) return { source: 'none' };
      const late = clockDiff(e.targetMin, minutesOfDay(nightAfter.main.start));
      return { value: late <= rule.toleranceMin, source: 'data', reason: `In bed at ${formatClock(minutesOfDay(nightAfter.main.start))}` };
    }
    case 'no-naps': {
      const day = d.nights.find((n) => n.wakeDate === date);
      if ((day?.naps.length ?? 0) > 0) return { value: false, source: 'data', reason: 'Your watch recorded a nap' };
      if (tags.includes('nap')) return { value: false, source: 'data', reason: 'Journal: napped' };
      // The watch was worn around that day, so a missing nap means no nap.
      if (nightAfter || day?.main) return { value: true, source: 'data', reason: 'No nap recorded' };
      return { source: 'none' };
    }
    case 'exercise-before': {
      const limit = atMinutes(date, rule.clockMin);
      const ws = (d.workouts ?? []).filter((w) => dateKey(w.start) === date);
      if (ws.some((w) => w.end > limit) || tags.includes('late-exercise')) return { value: false, source: 'data', reason: 'Exercise ran past the cut-off' };
      if (ws.length) return { value: true, source: 'data', reason: 'Workout finished in time' };
      if (tags.includes('exercise')) return { value: true, source: 'data', reason: 'Journal: exercised' };
      return { source: 'none' };
    }
  }
}

/** Manual answer if given, otherwise inferred. */
export function adherenceFor(e: Experiment, date: string, d: ExperimentData): Adherence {
  const manual = e.adherence[date];
  if (manual !== undefined) return { value: manual, source: 'manual' };
  return inferAdherence(e, date, d);
}

// ---------- Progress & results ----------

export type DayStatus = 'kept' | 'missed' | 'unknown' | 'today' | 'upcoming';

export interface ExperimentDay {
  date: string;
  /** 0-based day number. */
  index: number;
  status: DayStatus;
  adherence: Adherence;
  /** The night that followed this day has been recorded. */
  hasNight: boolean;
}

export type Signal = 'strong' | 'moderate' | 'weak' | 'none' | 'insufficient';

export interface MetricResult {
  key: ExperimentMetricKey;
  label: string;
  baseline?: number;
  experiment?: number;
  diff?: number;
  p?: number;
  d?: number;
  nExperiment: number;
  nBaseline: number;
  improved?: boolean;
  signal: Signal;
  /** "Time to fall asleep dropped 9 min — strong signal". */
  text: string;
  /** The same without the metric name: "Dropped 9 min — strong signal". */
  verdict: string;
  baselineText?: string;
  experimentText?: string;
}

export interface Recommendation {
  kind: RecommendationKind;
  title: string;
  detail: string;
}

export interface ExperimentResult {
  days: ExperimentDay[];
  /** Days whose night is over. */
  elapsed: number;
  kept: number;
  missed: number;
  unknown: number;
  /** kept / (kept + missed) */
  adherencePct?: number;
  /** Kept days whose night was recorded — the ones compared with the baseline. */
  nightsAnalysed: number;
  baselineNights: number;
  metrics: MetricResult[];
  recommendation: Recommendation;
  /** Every night of the period is over. */
  complete: boolean;
  /** Days left including today. */
  remaining: number;
  /** Most recent finished day that still needs a yes/no answer. */
  needsAnswer?: string;
}

const BASELINE_DAYS = 28;
const MIN_BASELINE = 5;
const MIN_NIGHTS = 3;

function rowFor(n: Night, d: ExperimentData): ExperimentRow {
  return { night: n, score: n.main ? d.scores[n.main.id]?.total : undefined, vitals: n.main ? d.vitals[n.main.id] : undefined, energy: d.dayLogs[n.wakeDate]?.energy };
}

export function signalOf(p: number | undefined, effect: number | undefined, nA: number, nB: number): Signal {
  if (p === undefined || effect === undefined || nA < MIN_NIGHTS || nB < MIN_BASELINE) return 'insufficient';
  if (Math.abs(effect) < 0.25) return 'none';
  if (p < 0.05 && Math.abs(effect) >= 0.5) return 'strong';
  if (p < 0.15) return 'moderate';
  if (p < 0.3) return 'weak';
  return 'none';
}

const SIGNAL_TEXT: Record<Signal, string> = {
  strong: 'strong signal',
  moderate: 'moderate signal',
  weak: 'weak signal — needs more nights',
  none: 'no clear change',
  insufficient: 'not enough nights yet',
};

export function compareMetric(key: ExperimentMetricKey, exp: ExperimentRow[], base: ExperimentRow[]): MetricResult {
  const m = EXPERIMENT_METRICS[key];
  const a = exp.map(m.get).filter((x): x is number => x !== undefined && Number.isFinite(x));
  const b = base.map(m.get).filter((x): x is number => x !== undefined && Number.isFinite(x));
  const res = a.length >= 2 && b.length >= 2 ? welchTTest(a, b) : undefined;
  const tiny = res ? Math.abs(res.diff) < m.minDiff : false;
  const signal = res && tiny && a.length >= MIN_NIGHTS && b.length >= MIN_BASELINE ? 'none' : signalOf(res?.p, res?.d, a.length, b.length);
  const out: MetricResult = {
    key,
    label: m.label,
    nExperiment: a.length,
    nBaseline: b.length,
    signal,
    text: `${m.label}: ${SIGNAL_TEXT.insufficient}`,
    verdict: 'Not enough nights yet',
    baselineText: b.length ? m.value(mean(b)) : undefined,
    experimentText: a.length ? m.value(mean(a)) : undefined,
  };
  if (!res) return out;
  const improved = m.higherIsBetter ? res.diff > 0 : res.diff < 0;
  Object.assign(out, { baseline: res.meanB, experiment: res.meanA, diff: res.diff, p: res.p, d: res.d, improved });
  if (signal === 'insufficient') return out;
  if (signal === 'none') {
    const change = `no clear change (${res.diff >= 0 ? '+' : '−'}${m.diff(res.diff)})`;
    out.text = `${m.label}: ${change}`;
    out.verdict = `${change.charAt(0).toUpperCase()}${change.slice(1)}`;
  } else {
    const change = `${res.diff > 0 ? 'rose' : 'dropped'} ${m.diff(res.diff)} — ${SIGNAL_TEXT[signal]}`;
    out.text = `${m.label} ${change}`;
    out.verdict = `${change.charAt(0).toUpperCase()}${change.slice(1)}`;
  }
  return out;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function recommend(r: Omit<ExperimentResult, 'recommendation'>, durationDays: number): Recommendation {
  const interim = !r.complete;
  const unanswered = r.unknown > 0 ? ` ${r.unknown} day${r.unknown === 1 ? '' : 's'} still need a yes/no answer — tap the dots to fill them in.` : '';
  if (r.baselineNights < MIN_BASELINE) {
    return {
      kind: 'too-early',
      title: 'Building a baseline',
      detail: `eepy compares experiment nights with the ${BASELINE_DAYS} nights before you started, and only ${r.baselineNights} were recorded. Results become meaningful as more nights come in.`,
    };
  }
  if (r.nightsAnalysed < MIN_NIGHTS) {
    if (r.complete) {
      return {
        kind: 'extend',
        title: 'Inconclusive — extend it',
        detail: `${r.nightsAnalysed === 0 ? 'No recorded nights' : `Only ${r.nightsAnalysed} recorded night${r.nightsAnalysed === 1 ? '' : 's'}`} followed the rule — too few to compare.${unanswered || ' Add 7 more nights to get an answer.'}`,
      };
    }
    return { kind: 'too-early', title: 'Too early to tell', detail: `Results appear after ${MIN_NIGHTS} nights that followed the rule. Keep going!${unanswered}` };
  }
  const usable = r.metrics.filter((m) => m.signal !== 'insufficient');
  const clear = (m: MetricResult) => m.signal === 'strong' || m.signal === 'moderate';
  const good = usable.filter((m) => m.improved && clear(m));
  const bad = usable.filter((m) => !m.improved && clear(m));
  const hint = usable.filter((m) => m.improved && m.signal === 'weak');
  const lowAdherence = r.adherencePct !== undefined && r.adherencePct < 0.6;

  // A handful of nights is enough to show a direction, not to give a verdict.
  if (interim && r.nightsAnalysed < 5) {
    const lead = good[0] ?? bad[0] ?? hint[0];
    return {
      kind: 'too-early',
      title: 'Early days',
      detail: `${lead ? `Early sign: ${lowerFirst(lead.text.replace(/ — .*$/, ''))}. ` : 'No clear change yet. '}Keep going — ${r.remaining} night${r.remaining === 1 ? '' : 's'} left.${unanswered}`,
    };
  }
  const prefix = interim ? 'So far: ' : '';
  if (good.length && !bad.length) {
    return {
      kind: 'keep',
      title: `${prefix}Keep it`,
      detail: `${good.map((m) => m.text).join('; ')}. This change seems to work for you${interim ? ' — finish the remaining nights to confirm' : ''}.`,
    };
  }
  if (good.length && bad.length) {
    return {
      kind: 'extend',
      title: `${prefix}Mixed results — extend it`,
      detail: `${good[0].text}, but ${lowerFirst(bad[0].text)}. Another ${Math.min(7, durationDays)} nights will show which effect is real.`,
    };
  }
  if (bad.length) {
    return {
      kind: 'no-effect',
      title: `${prefix}It didn't help`,
      detail: `${bad[0].text}. Fine to drop it — not every rule suits everyone.`,
    };
  }
  if (hint.length || lowAdherence) {
    return {
      kind: 'extend',
      title: `${prefix}Inconclusive — extend it`,
      detail: lowAdherence
        ? `You kept the rule on ${Math.round((r.adherencePct ?? 0) * 100)}% of days, which leaves few nights to compare. Try another 7 nights.`
        : `${hint[0].text.replace(/ — .*$/, '')}, but it's not clear-cut yet. Another 7 nights would firm it up.`,
    };
  }
  return {
    kind: 'no-effect',
    title: `${prefix}No clear effect`,
    detail: `Your sleep looked about the same as before. It's fine to drop this rule${interim ? ' if it is a hassle' : ''} and try something else.`,
  };
}

/** Day-by-day progress plus a before/after comparison of the nights that followed the rule. */
export function computeExperimentResult(e: Experiment, d: ExperimentData): ExperimentResult {
  const days: ExperimentDay[] = [];
  const keptRows: ExperimentRow[] = [];
  let kept = 0;
  let missed = 0;
  let unknown = 0;
  let needsAnswer: string | undefined;
  const ended = e.status !== 'active' && e.finishedAt !== undefined ? dateKey(e.finishedAt) : undefined;
  for (let i = 0; i < e.durationDays; i++) {
    const date = addDays(e.startDate, i);
    const night = d.nights.find((n) => n.wakeDate === addDays(date, 1) && n.main);
    const adherence = adherenceFor(e, date, d);
    // Days after an early finish/abandon aren't part of the experiment.
    const cut = ended !== undefined && date >= ended;
    const over = date < d.today && !cut;
    let status: DayStatus;
    if (cut) {
      status = 'upcoming';
    } else if (!over) {
      status = date === d.today ? 'today' : 'upcoming';
      // Behaviour already logged today (e.g. a late coffee) shows up straight away.
      if (date === d.today && adherence.value === false) status = 'missed';
    } else if (adherence.value === true) status = 'kept';
    else if (adherence.value === false) status = 'missed';
    else status = 'unknown';
    if (status === 'kept') kept++;
    if (status === 'missed') missed++;
    if (status === 'unknown') {
      unknown++;
      needsAnswer = date;
    }
    if (status === 'kept' && night) keptRows.push(rowFor(night, d));
    days.push({ date, index: i, status, adherence, hasNight: !!night });
  }
  const elapsed = days.filter((x) => x.status === 'kept' || x.status === 'missed' || x.status === 'unknown').length;
  const before = e.startDate;
  const baseRows = d.nights
    .filter((n) => n.main && n.wakeDate <= before && daysBetween(n.wakeDate, before) < BASELINE_DAYS)
    .map((n) => rowFor(n, d));
  const t = templateFor(e);
  const metrics = (t?.metrics ?? ['score', 'tst', 'latency']).map((k) => compareMetric(k, keptRows, baseRows));
  const lastDay = addDays(e.startDate, e.durationDays - 1);
  const partial = {
    days,
    elapsed,
    kept,
    missed,
    unknown,
    adherencePct: kept + missed > 0 ? kept / (kept + missed) : undefined,
    nightsAnalysed: keptRows.length,
    baselineNights: baseRows.length,
    metrics,
    complete: lastDay < d.today,
    remaining: Math.max(0, daysBetween(d.today, lastDay) + 1),
    needsAnswer,
  };
  return { ...partial, recommendation: recommend(partial, e.durationDays) };
}

/** Freezes the outcome so history keeps it after the nights leave the analysis window. */
export function finishExperiment(e: Experiment, d: ExperimentData, now: number, status: 'completed' | 'abandoned' = 'completed'): Experiment {
  const r = computeExperimentResult(e, d);
  return {
    ...e,
    status,
    finishedAt: now,
    outcome: { kind: r.recommendation.kind, headline: r.recommendation.title.replace(/^So far: /, ''), adherencePct: r.adherencePct, nights: r.nightsAnalysed },
  };
}

export function activeExperiment(experiments: Experiment[]): Experiment | undefined {
  return experiments.filter((e) => e.status === 'active').sort((a, b) => b.createdAt - a.createdAt)[0];
}

// ---------- Suggestions ----------

export interface TemplateSuggestion {
  template: ExperimentTemplate;
  score: number;
  /** Why it's suggested for this user, if there's a personal reason. */
  reason?: string;
}

export interface SuggestionInput {
  day: string;
  insights: Insight[];
  tips: Tip[];
  nights: Night[];
  needMin: number;
  chronotype: Pick<Analysis['chronotype'], 'category' | 'habitual' | 'socialJetlagMin'>;
  caffeine: CaffeineDose[];
  dayLogs: Record<string, DayLog>;
  experiments: Experiment[];
}

export function suggestionInput(a: Analysis, data: Pick<SleepDataset, 'caffeine' | 'dayLogs'>, experiments: Experiment[]): SuggestionInput {
  return {
    day: a.day,
    insights: a.insights,
    tips: a.tips,
    nights: a.nights,
    needMin: a.need.needMin,
    chronotype: a.chronotype,
    caffeine: data.caffeine,
    dayLogs: data.dayLogs,
    experiments,
  };
}

/** Templates ordered by how relevant they are to this user's insights, tips and recent data. */
export function rankTemplates(input: SuggestionInput): TemplateSuggestion[] {
  const active = new Set(input.experiments.filter((e) => e.status === 'active').map((e) => e.templateId));
  const recent = (id: string) =>
    input.experiments.find((e) => e.templateId === id && e.status !== 'active' && daysBetween(dateKey(e.finishedAt ?? e.createdAt), input.day) < 60);
  const since = addDays(input.day, -14);
  const recentNights = input.nights.filter((n) => n.main && n.wakeDate > since);
  const tagCount = (tag: string) => Object.values(input.dayLogs).filter((l) => l.date > addDays(input.day, -28) && l.tags.includes(tag)).length;

  const out: TemplateSuggestion[] = [];
  for (const t of EXPERIMENT_TEMPLATES) {
    if (active.has(t.id)) continue;
    let score = t.base;
    const reasons: { w: number; text: string }[] = [];
    for (const rel of t.relevance.insights) {
      const ins = input.insights.find((i) => i.id === rel.id && (!rel.kind || i.kind === rel.kind));
      if (ins) {
        const w = 30 + 40 * ins.strength;
        score += w;
        reasons.push({ w, text: ins.title });
      }
    }
    for (const id of t.relevance.tips) {
      const tip = input.tips.find((x) => x.id === id);
      if (tip) {
        const w = tip.priority / 4;
        score += w;
        reasons.push({ w: w * 0.8, text: tip.title });
      }
    }
    // Direct data signals.
    if (t.id === 'caffeine-cutoff') {
      const lateDays = new Set(input.caffeine.filter((c) => dateKey(c.time) > since && minutesOfDay(c.time) >= 14 * 60).map((c) => dateKey(c.time))).size;
      if (lateDays >= 3) {
        score += 8 + lateDays * 2;
        reasons.push({ w: 8 + lateDays * 2, text: `You had caffeine after 14:00 on ${lateDays} of the last 14 days` });
      }
    }
    if (t.id === 'consistent-wake') {
      const sd = input.chronotype.habitual?.wakeSdMin;
      if (sd !== undefined && sd >= 40) {
        score += Math.min(30, sd / 2);
        reasons.push({ w: Math.min(30, sd / 2), text: `Your wake time varies by about ±${Math.round(sd)} min` });
      }
    }
    if (t.id === 'earlier-bedtime' && recentNights.length >= 5) {
      const gap = input.needMin - mean(recentNights.map((n) => n.totalSleepMin));
      if (gap >= 25) {
        score += Math.min(35, gap / 2);
        reasons.push({ w: Math.min(35, gap / 2), text: `You're averaging ${formatDuration(gap)} under your sleep need` });
      }
    }
    if (t.id === 'morning-light' && (input.chronotype.category === 'late' || input.chronotype.category === 'moderately-late')) {
      score += 12;
      reasons.push({ w: 12, text: 'Your body clock runs late — morning light pulls it earlier' });
    }
    if (t.id === 'no-naps') {
      const naps = recentNights.reduce((s, n) => s + n.naps.length, 0);
      const lat = recentNights.map((n) => n.main!.latencyMin).filter((x) => x >= 1);
      if (naps >= 3 && lat.length >= 5 && mean(lat) > 20) {
        score += 15;
        reasons.push({ w: 15, text: `${naps} naps in two weeks and it takes you ${Math.round(mean(lat))} min to fall asleep` });
      }
    }
    if (t.id === 'no-alcohol') {
      const n = tagCount('alcohol');
      if (n >= 3) {
        score += 4 + n;
        reasons.push({ w: 4 + n, text: `Alcohol on ${n} evenings in the last 4 weeks` });
      }
    }
    if (t.id === 'no-screens') {
      const n = tagCount('screens');
      if (n >= 4) {
        score += 4 + n / 2;
        reasons.push({ w: 4 + n / 2, text: `Screens in bed on ${n} evenings in the last 4 weeks` });
      }
    }
    const tried = recent(t.id);
    // Something tried in the last two months goes to the back of the queue.
    if (tried) score -= 80;
    reasons.sort((a, b) => b.w - a.w);
    out.push({
      template: t,
      score,
      reason: tried ? `You tried this recently${tried.outcome ? ` (${lowerFirst(tried.outcome.headline)})` : ''}` : reasons[0]?.text,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Notification-friendly reminder for an experiment: when (epoch ms) and what, for a given day. */
export function reminderFor(
  e: Experiment,
  date: string,
  times: { bedtime: number; wake: number },
): { at: number; text: string } | undefined {
  const t = templateFor(e);
  if (!t) return undefined;
  const r = t.reminder;
  const text = fillTarget(r.text, e.targetMin);
  if (r.anchor === 'clock') return { at: atMinutes(date, r.offsetMin), text };
  if (r.anchor === 'bedtime') return { at: times.bedtime + r.offsetMin * 60_000, text };
  if (r.anchor === 'wake') return { at: times.wake + r.offsetMin * 60_000, text };
  if (e.targetMin === undefined) return undefined;
  // Target lights-out: after noon it's this evening, otherwise just after midnight.
  const target = atMinutes(e.targetMin >= 12 * 60 ? date : addDays(date, 1), e.targetMin);
  return { at: target + r.offsetMin * 60_000, text };
}

/** Whether a finished day needs a yes/no answer from the user. */
export function needsQuestion(e: Experiment, date: string, d: ExperimentData): boolean {
  if (e.status !== 'active') return false;
  if (date < e.startDate || date > addDays(e.startDate, e.durationDays - 1)) return false;
  return adherenceFor(e, date, d).value === undefined;
}
