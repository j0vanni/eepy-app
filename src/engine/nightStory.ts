/**
 * Night story: a plain-English account of one night, built only from data eepy already has — how
 * fast you fell asleep, when deep sleep came, awakenings (and whether heart rate rose then), REM,
 * heart rate and breathing — compared with your own recent nights, plus the evening factors that
 * plausibly explain what was different.
 *
 * Rules (STORY_RULES):
 * - "Usual" = median of up to 30 main nights in the 45 days before this one; a comparison needs
 *   at least 5 such nights for that metric (otherwise values are described without comparison).
 * - Notable differences: time to fall asleep ±max(5 min, 40%); total sleep ±30 min; deep sleep
 *   ±max(10 min, 20%); REM share ±4 points and ±15%; time awake +max(15 min, 50%) or
 *   −max(10 min, 50%); lowest heart rate ±3 bpm; HRV ±15%; score ±8; sleep onset ±45 min.
 * - Deep sleep "came early" when ≥ 60% of it was in the first half of the sleep period, "late"
 *   when < 40%. Named awakenings are ≥ 5 min; heart rate "rose then" when a 10-minute bin around
 *   the awakening is ≥ 5 bpm above sleep in the hour either side.
 * - A factor is "likely" only when it was present that evening AND at least one effect it
 *   plausibly has showed up tonight (EFFECTS below, e.g. alcohol → less REM, more time awake,
 *   higher or late-settling heart rate, lower HRV). When insights.ts has measured a personal effect
 *   for it, that wording is added ("on nights after …, your REM sleep is usually 5 points lower").
 *   Present without a matching effect → "also logged" (never blamed). Caffeine counts from 25 mg
 *   still active at lights-out (caffeineAt, personal half-life); naps from 15 min.
 * Staging and heart rate come from a wrist sensor, so the copy says "likely", never "caused".
 */
import { assessBreathing, breathingSummaryFor } from './breathing';
import { caffeineAt } from './caffeine';
import type { Insight, InsightEffect } from './insights';
import type { Night, SessionMetrics } from './sessions';
import { median } from './stats';
import { TAG_BY_ID } from './tags';
import { addDays, circularMeanMinutes, clockDiff, formatDuration, formatTime, getClockFormat, HOUR, minutesOfDay, MINUTE } from './time';
import type { CaffeineDose, DayLog, NightVitals, Profile, Workout } from './types';
import { isLightWorkout, workoutLabel, workoutsBeforeSleep } from './workouts';

export const STORY_RULES = {
  baselineNights: 30,
  baselineDays: 45,
  minBaseline: 5,
  latencyMin: 5,
  latencyRel: 0.4,
  tstMin: 30,
  deepMin: 10,
  deepRel: 0.2,
  remPts: 0.04,
  remRel: 0.15,
  wasoUpMin: 15,
  wasoDownMin: 10,
  wasoRel: 0.5,
  hrBpm: 3,
  hrvRel: 0.15,
  scorePts: 8,
  onsetMin: 45,
  namedAwakeningMin: 5,
  hrRiseBpm: 5,
  caffeineMg: 25,
  napMin: 15,
} as const;

/** A difference from the user's usual night (or an absolute flag when there's no baseline yet). */
export type Deviation =
  | 'latencyUp'
  | 'latencyDown'
  | 'tstDown'
  | 'tstUp'
  | 'deepDown'
  | 'deepUp'
  | 'remDown'
  | 'remUp'
  | 'wasoUp'
  | 'wasoDown'
  | 'hrUp'
  | 'hrDown'
  | 'lateNadir'
  | 'hrvDown'
  | 'hrvUp'
  | 'lateOnset'
  | 'earlyOnset'
  | 'scoreDown'
  | 'scoreUp';

export type StoryTone = 'good' | 'neutral' | 'bad';

/** A run of text; `strong` = a number worth bolding, `factor` = id of the StoryFactor it names. */
export interface StoryPart {
  text: string;
  strong?: boolean;
  factor?: string;
}

export type StoryTopic = 'duration' | 'onset' | 'timing' | 'deep' | 'awake' | 'rem' | 'heart' | 'hrv' | 'breathing' | 'factors' | 'personal' | 'helped' | 'noted' | 'hint' | 'stages' | 'baseline';

export interface StorySentence {
  topic: StoryTopic;
  tone: StoryTone;
  parts: StoryPart[];
}

export interface StoryFactor {
  /** 'tag:alcohol', 'caffeine', 'workout', 'nap', 'bedtime'. */
  id: string;
  kind: 'tag' | 'caffeine' | 'workout' | 'nap' | 'bedtime';
  role: 'likely' | 'helped' | 'noted';
  /** Phrase used in the story: "drinking alcohol", "~60 mg of caffeine still active at lights-out". */
  label: string;
  /** Short form for the one-liner: "alcohol", "late caffeine". */
  short: string;
  /** Tonight's differences this factor plausibly explains. */
  explains: Deviation[];
  /** Personal effect from insights.ts, as a sentence. */
  personal?: string;
  tag?: string;
  /** Evening date (YYYY-MM-DD) the factor belongs to — for linking to the journal / caffeine log. */
  date: string;
}

export interface NightStory {
  sessionId: string;
  wakeDate: string;
  sentences: StorySentence[];
  factors: StoryFactor[];
  deviations: Deviation[];
  /** One line for the morning report / Today card. */
  oneLiner: string;
  /** All sentences as plain text. */
  text: string;
  /** Nights the comparison is based on. */
  baselineNights: number;
  staged: boolean;
}

export interface NightStoryInput {
  night: SessionMetrics;
  nights: Night[];
  vitals: Record<string, NightVitals>;
  dayLogs: Record<string, DayLog>;
  caffeine: CaffeineDose[];
  profile: Pick<Profile, 'caffeineHalfLifeH' | 'caffeineBedtimeLimitMg'>;
  workouts?: Workout[];
  /** Analysis insights; their measured personal effects are quoted when they match. */
  insights?: Insight[];
  scores?: Record<string, { total: number } | undefined>;
}

/** What each evening factor plausibly does to a night (sleep-research consensus, kept modest). */
const EFFECTS: Record<string, { hurts?: Deviation[]; helps?: Deviation[] }> = {
  alcohol: { hurts: ['remDown', 'wasoUp', 'hrUp', 'lateNadir', 'hrvDown'] },
  'late-caffeine': { hurts: ['latencyUp', 'deepDown', 'wasoUp'] },
  'late-meal': { hurts: ['hrUp', 'lateNadir', 'wasoUp', 'latencyUp'] },
  'late-exercise': { hurts: ['latencyUp', 'hrUp', 'lateNadir'] },
  exercise: { helps: ['deepUp', 'latencyDown'] },
  screens: { hurts: ['latencyUp', 'lateOnset'] },
  stress: { hurts: ['latencyUp', 'wasoUp', 'hrUp', 'hrvDown'] },
  nicotine: { hurts: ['latencyUp', 'wasoUp'] },
  cannabis: { hurts: ['remDown'] },
  sick: { hurts: ['hrUp', 'wasoUp', 'hrvDown'] },
  travel: { hurts: ['latencyUp', 'wasoUp', 'lateOnset'] },
  'warm-room': { hurts: ['wasoUp', 'deepDown', 'remDown'] },
  noise: { hurts: ['wasoUp'] },
  'shared-bed': { hurts: ['wasoUp'] },
  nap: { hurts: ['latencyUp', 'deepDown'] },
  melatonin: { helps: ['latencyDown'] },
  'wind-down': { helps: ['latencyDown'] },
  reading: { helps: ['latencyDown'] },
  meditation: { helps: ['latencyDown', 'wasoDown'] },
  'hot-shower': { helps: ['latencyDown', 'deepUp'] },
  'outdoor-light': { helps: ['latencyDown'] },
};
const CAFFEINE_HURTS: Deviation[] = ['latencyUp', 'deepDown', 'wasoUp'];
const LATE_WORKOUT_HURTS: Deviation[] = ['latencyUp', 'hrUp', 'lateNadir', 'deepDown'];
const WORKOUT_HELPS: Deviation[] = ['deepUp', 'latencyDown'];

/** Whole-night totals: a factor never counts as "likely" because of these alone (an alarm shortens nights too). */
const AGGREGATE = new Set<Deviation>(['tstDown', 'tstUp', 'scoreDown', 'scoreUp']);
/** At most this many "likely factors" per night, strongest first. */
const MAX_LIKELY = 3;

const BAD: Deviation[] = ['wasoUp', 'remDown', 'deepDown', 'latencyUp', 'tstDown', 'hrUp', 'lateNadir', 'hrvDown', 'scoreDown'];
const GOOD: Deviation[] = ['latencyDown', 'deepUp', 'remUp', 'wasoDown', 'tstUp', 'hrDown', 'hrvUp', 'scoreUp'];

interface Usual {
  n: number;
  latency?: number;
  tst?: number;
  deepMin?: number;
  remPct?: number;
  waso?: number;
  onsetMin?: number;
  hrMin?: number;
  hrv?: number;
  score?: number;
}

const defined = <T>(x: T | undefined): x is T => x !== undefined;

function usualNight(input: NightStoryInput): Usual {
  const R = STORY_RULES;
  const m = input.night;
  const from = addDays(m.wakeDate, -R.baselineDays);
  const prev = input.nights
    .filter((n) => n.main && n.main.id !== m.id && n.wakeDate < m.wakeDate && n.wakeDate >= from)
    .slice(-R.baselineNights)
    .map((n) => n.main!);
  const med = (xs: (number | undefined)[]) => {
    const v = xs.filter(defined);
    return v.length >= R.minBaseline ? median(v) : undefined;
  };
  return {
    n: prev.length,
    latency: med(prev.map((x) => (x.latencyMin >= 1 && x.latencyMin < 120 ? x.latencyMin : undefined))),
    tst: med(prev.map((x) => x.totalSleepMin)),
    deepMin: med(prev.map((x) => (x.hasStages ? x.stageMin.deep : undefined))),
    remPct: med(prev.map((x) => x.stagePct?.rem)),
    waso: med(prev.map((x) => x.wasoMin)),
    onsetMin: prev.length >= R.minBaseline ? circularMeanMinutes(prev.map((x) => minutesOfDay(x.sleepOnset))) : undefined,
    hrMin: med(prev.map((x) => input.vitals[x.id]?.hrMin)),
    hrv: med(prev.map((x) => input.vitals[x.id]?.hrvRmssd)),
    score: med(prev.map((x) => input.scores?.[x.id]?.total)),
  };
}

/** "3:10–3:24 AM" in 12-hour mode (one AM/PM when both share it), "03:10–03:24" in 24-hour mode. */
export function formatTimeRange(a: number, b: number): string {
  const x = formatTime(a);
  const y = formatTime(b);
  if (getClockFormat() === '12h') {
    const [xt, xs] = x.split(' ');
    const ys = y.split(' ')[1];
    if (xs && xs === ys) return `${xt}–${y}`;
  }
  return `${x}–${y}`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const mins = (x: number) => `${Math.round(x)} min`;
const capitalize = (x: string) => (x ? `${x[0].toUpperCase()}${x.slice(1)}` : x);

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Parts joined as "a, b and c", each item its own parts. */
function listParts(items: StoryPart[][]): StoryPart[] {
  const out: StoryPart[] = [];
  items.forEach((p, i) => {
    if (i > 0) out.push({ text: i === items.length - 1 ? ' and ' : ', ' });
    out.push(...p);
  });
  return out;
}

const t = (text: string): StoryPart => ({ text });
const v = (text: string): StoryPart => ({ text, strong: true });

function deviationOf(e: InsightEffect): Deviation | undefined {
  const up = e.diff > 0;
  switch (e.metric) {
    case 'latency':
      return up ? 'latencyUp' : 'latencyDown';
    case 'tst':
      return up ? 'tstUp' : 'tstDown';
    case 'deep':
      return up ? 'deepUp' : 'deepDown';
    case 'rem':
      return up ? 'remUp' : 'remDown';
    case 'waso':
      return up ? 'wasoUp' : 'wasoDown';
    case 'hrv':
      return up ? 'hrvUp' : 'hrvDown';
    case 'hr':
      return up ? 'hrUp' : 'hrDown';
    case 'score':
      return up ? 'scoreUp' : 'scoreDown';
    default:
      return undefined;
  }
}

/** "On nights after drinking alcohol, your REM sleep is usually 5 percentage points lower." */
function personalSentence(context: string, e: InsightEffect): string {
  const effect =
    e.metric === 'latency'
      ? e.diff > 0
        ? `you usually take ${e.amount} longer to fall asleep`
        : `you usually fall asleep ${e.amount} faster`
      : `your ${e.label} is usually ${e.amount} ${e.metric === 'tst' ? (e.diff > 0 ? 'longer' : 'shorter') : e.diff > 0 ? 'higher' : 'lower'}`;
  return `${context}, ${effect}.`;
}

/** "a running", "an elliptical", "an 18m", "a 45m" (numbers read as words: eight, eleven, eighteen). */
const withArticle = (x: string) => `${/^([aeiou]|8|11\D|18\D)/i.test(x) ? 'an' : 'a'} ${x}`;

/** Lower-cases a workout label unless it's an acronym ("Running" → "running", "HIIT" stays). */
const lowerLabel = (x: string) => (x === x.toUpperCase() ? x : x.toLowerCase());

export function buildNightStory(input: NightStoryInput): NightStory | undefined {
  const R = STORY_RULES;
  const m = input.night;
  if (m.isNap) return undefined;
  const u = usualNight(input);
  const vit = input.vitals[m.id];
  const eve = addDays(m.wakeDate, -1);
  const dev = new Set<Deviation>();
  const sentences: StorySentence[] = [];
  const say = (topic: StoryTopic, tone: StoryTone, ...parts: (StoryPart | string)[]) =>
    sentences.push({ topic, tone, parts: parts.map((p) => (typeof p === 'string' ? t(p) : p)) });

  // ---- Differences from the usual night ----
  const latency = m.latencyMin >= 1 ? m.latencyMin : undefined;
  if (latency !== undefined && u.latency !== undefined) {
    const thr = Math.max(R.latencyMin, R.latencyRel * u.latency);
    if (latency - u.latency >= thr) dev.add('latencyUp');
    else if (u.latency - latency >= thr) dev.add('latencyDown');
  } else if (latency !== undefined && latency >= 30) dev.add('latencyUp');
  if (u.tst !== undefined) {
    if (m.totalSleepMin - u.tst >= R.tstMin) dev.add('tstUp');
    else if (u.tst - m.totalSleepMin >= R.tstMin) dev.add('tstDown');
  }
  const deep = m.hasStages ? m.stageMin.deep : undefined;
  if (deep !== undefined && u.deepMin !== undefined) {
    const thr = Math.max(R.deepMin, R.deepRel * u.deepMin);
    if (u.deepMin - deep >= thr) dev.add('deepDown');
    else if (deep - u.deepMin >= thr) dev.add('deepUp');
  }
  const rem = m.stagePct?.rem;
  if (rem !== undefined && u.remPct !== undefined && u.remPct > 0) {
    const d = rem - u.remPct;
    if (Math.abs(d) >= R.remPts && Math.abs(d) / u.remPct >= R.remRel) dev.add(d < 0 ? 'remDown' : 'remUp');
  }
  if (u.waso !== undefined) {
    if (m.wasoMin - u.waso >= Math.max(R.wasoUpMin, R.wasoRel * u.waso)) dev.add('wasoUp');
    else if (u.waso - m.wasoMin >= Math.max(R.wasoDownMin, R.wasoRel * u.waso)) dev.add('wasoDown');
  } else if (m.wasoMin >= 45) dev.add('wasoUp');
  const hrMin = vit?.hrMin;
  if (hrMin !== undefined && u.hrMin !== undefined) {
    if (hrMin - u.hrMin >= R.hrBpm) dev.add('hrUp');
    else if (u.hrMin - hrMin >= R.hrBpm) dev.add('hrDown');
  }
  const sleepSpanMin = (m.finalWake - m.sleepOnset) / MINUTE;
  const nadirFrac = vit?.hrNadirOffsetMin !== undefined && sleepSpanMin > 0 ? vit.hrNadirOffsetMin / sleepSpanMin : undefined;
  if (nadirFrac !== undefined && nadirFrac > 0.6) dev.add('lateNadir');
  const hrv = vit?.hrvRmssd;
  if (hrv !== undefined && u.hrv !== undefined) {
    if (hrv <= u.hrv * (1 - R.hrvRel)) dev.add('hrvDown');
    else if (hrv >= u.hrv * (1 + R.hrvRel)) dev.add('hrvUp');
  }
  const score = input.scores?.[m.id]?.total;
  if (score !== undefined && u.score !== undefined) {
    if (u.score - score >= R.scorePts) dev.add('scoreDown');
    else if (score - u.score >= R.scorePts) dev.add('scoreUp');
  }
  const onsetShift = u.onsetMin !== undefined ? clockDiff(u.onsetMin, minutesOfDay(m.sleepOnset)) : undefined;
  if (onsetShift !== undefined && onsetShift >= R.onsetMin) dev.add('lateOnset');
  if (onsetShift !== undefined && onsetShift <= -R.onsetMin) dev.add('earlyOnset');

  // ---- Sentences ----
  if (dev.has('tstDown')) say('duration', 'bad', v(formatDuration(m.totalSleepMin)), ' asleep — ', v(formatDuration(u.tst! - m.totalSleepMin)), ' less than usual.');
  else if (dev.has('tstUp')) say('duration', 'good', v(formatDuration(m.totalSleepMin)), ' asleep — ', v(formatDuration(m.totalSleepMin - u.tst!)), ' more than usual.');
  else if (u.tst === undefined) say('duration', 'neutral', v(formatDuration(m.totalSleepMin)), ' asleep.');

  if (latency !== undefined) {
    if (dev.has('latencyDown')) say('onset', 'good', 'Asleep in ', v(mins(latency)), ' — quicker than usual.');
    else if (dev.has('latencyUp'))
      say('onset', 'bad', 'It took ', v(mins(latency)), ' to fall asleep', ...(u.latency !== undefined ? [' — longer than your usual ', v(mins(u.latency)), '.'] : [' — on the long side (under 20 min is typical).']));
    else if (u.latency !== undefined) say('onset', 'neutral', 'Asleep in ', v(mins(latency)), ', about your usual.');
    else say('onset', latency <= 20 ? 'good' : 'neutral', 'Asleep in ', v(mins(latency)), '.');
  }
  if (onsetShift !== undefined && Math.abs(onsetShift) >= R.onsetMin) {
    say('timing', 'neutral', 'You fell asleep at ', v(formatTime(m.sleepOnset)), ', ', v(formatDuration(Math.abs(onsetShift))), onsetShift > 0 ? ' later than usual.' : ' earlier than usual.');
  }

  if (deep !== undefined) {
    const mid = m.sleepOnset + (m.finalWake - m.sleepOnset) / 2;
    const firstHalf = m.segments.filter((s) => s.stage === 'deep').reduce((acc, s) => acc + Math.max(0, Math.min(s.end, mid) - s.start), 0) / MINUTE;
    const share = deep > 0 ? firstHalf / deep : undefined;
    const when = deep >= 15 && share !== undefined ? (share >= 0.6 ? 'early' : share < 0.4 ? 'late' : undefined) : undefined;
    const cmp: (StoryPart | string)[] =
      u.deepMin === undefined ? [] : dev.has('deepDown') || dev.has('deepUp') ? [' vs your usual ', v(formatDuration(u.deepMin))] : [', your normal'];
    const tone: StoryTone = dev.has('deepDown') ? 'bad' : dev.has('deepUp') || when === 'early' ? 'good' : 'neutral';
    if (deep < 1) say('deep', u.deepMin !== undefined ? 'bad' : 'neutral', 'No deep sleep was detected — wrist staging can miss it, so watch the trend rather than one night.');
    else if (when === 'early' && dev.has('deepDown')) say('deep', tone, 'Deep sleep came early but was short: ', v(formatDuration(deep)), ...cmp, '.');
    else if (when === 'early' && dev.has('deepUp')) say('deep', tone, 'Deep sleep came early and there was more of it: ', v(formatDuration(deep)), ...cmp, '.');
    else if (when) say('deep', tone, `Deep sleep came ${when === 'early' ? 'early' : 'late in the night'} (`, v(formatDuration(deep)), ...cmp, ').');
    else if (dev.has('deepDown')) say('deep', tone, 'Less deep sleep than usual: ', v(formatDuration(deep)), ...cmp, '.');
    else if (dev.has('deepUp')) say('deep', tone, 'More deep sleep than usual: ', v(formatDuration(deep)), ...cmp, '.');
    else say('deep', tone, v(formatDuration(deep)), ' of deep sleep', ...cmp, '.');
  }

  // Awakenings, with heart rate around them when the 10-minute HR curve is there.
  const wakes = m.segments.filter((s) => s.stage === 'awake' && s.start >= m.sleepOnset && s.end <= m.finalWake);
  const named = wakes
    .filter((s) => s.end - s.start >= R.namedAwakeningMin * MINUTE)
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, 2)
    .sort((a, b) => a.start - b.start);
  const curve = vit?.hrCurve ?? [];
  const binAt = (p: [number, number]) => m.start + p[0] * MINUTE;
  const asleepBins = curve.filter((p) => !wakes.some((w) => binAt(p) < w.end && binAt(p) + 10 * MINUTE > w.start) && binAt(p) >= m.sleepOnset && binAt(p) < m.finalWake);
  const sleepingHr = asleepBins.length >= 6 ? median(asleepBins.map((p) => p[1])) : undefined;
  /** Heart rate around an awakening vs. sleep in the hour either side (heart rate drifts over the night). */
  const rose = (w: { start: number; end: number }) => {
    if (sleepingHr === undefined) return undefined;
    const around = curve.filter((p) => binAt(p) < w.end + 5 * MINUTE && binAt(p) + 10 * MINUTE > w.start - 5 * MINUTE);
    const nearby = asleepBins.filter((p) => binAt(p) >= w.start - HOUR && binAt(p) < w.end + HOUR && !around.includes(p));
    const base = nearby.length >= 3 ? median(nearby.map((p) => p[1])) : sleepingHr;
    return around.length ? Math.max(...around.map((p) => p[1])) - base >= R.hrRiseBpm : undefined;
  };
  const awakeTone: StoryTone = dev.has('wasoUp') ? 'bad' : dev.has('wasoDown') ? 'good' : 'neutral';
  if (named.length) {
    const flags = named.map(rose);
    const parts: (StoryPart | string)[] = ['You were awake ', ...listParts(named.map((w) => [v(formatTimeRange(w.start, w.end))]))];
    if (flags.every((f) => f === true)) parts.push(named.length > 1 ? ', and your heart rate rose each time' : ' and your heart rate rose then');
    else if (flags.some((f) => f === true)) parts.push(`; your heart rate rose during the ${flags[0] ? 'first' : 'second'}`);
    const shorter = m.awakenings - named.length;
    if (shorter > 0) parts.push(` (plus ${shorter} shorter wake-up${shorter === 1 ? '' : 's'})`);
    parts.push('.');
    if (dev.has('wasoUp') && u.waso !== undefined) {
      parts.push(' In all, ', v(formatDuration(m.wasoMin)), ' awake during the night', ...(u.waso >= 1 ? [' — more than your usual ', v(formatDuration(u.waso)), '.'] : [' — usually you barely wake at all.']));
    }
    say('awake', awakeTone, ...parts);
  } else if (m.wasoMin < 10) {
    say('awake', 'good', m.awakenings ? 'You slept through, apart from a few brief stirrings.' : 'You slept through without waking.');
  } else {
    say('awake', awakeTone, v(formatDuration(m.wasoMin)), ` awake during the night across ${m.awakenings} short wake-up${m.awakenings === 1 ? '' : 's'}.`);
  }

  if (rem !== undefined) {
    if (dev.has('remDown'))
      say('rem', 'bad', 'REM was short (', v(pct(rem)), ' vs your usual ', v(pct(u.remPct!)), ')', dev.has('tstDown') ? ' — most REM comes late in the night, so a short night cuts it first.' : '.');
    else if (dev.has('remUp')) say('rem', 'good', 'Plenty of REM (', v(pct(rem)), ' vs your usual ', v(pct(u.remPct!)), ').');
    else if (u.remPct !== undefined) say('rem', 'neutral', 'REM was in your normal range (', v(pct(rem)), ').');
    else say('rem', 'neutral', 'REM made up ', v(pct(rem)), ' of your sleep (20–25% is typical).');
  }

  if (hrMin !== undefined) {
    const parts: (StoryPart | string)[] = ['Heart rate bottomed out at ', v(`${hrMin} bpm`)];
    if (vit?.hrNadirOffsetMin !== undefined) parts.push(' around ', v(formatTime(m.sleepOnset + vit.hrNadirOffsetMin * MINUTE)));
    if (dev.has('hrUp')) parts.push(', ', v(`${Math.round(hrMin - u.hrMin!)} bpm`), ' above your usual');
    else if (dev.has('hrDown')) parts.push(', ', v(`${Math.round(u.hrMin! - hrMin)} bpm`), ' below your usual');
    if (dev.has('lateNadir')) parts.push(' — late in the night, which often follows alcohol, a late meal or a late workout.');
    else if (nadirFrac !== undefined && nadirFrac <= 0.5) parts.push(dev.has('hrUp') ? '.' : ' — early in the night, a sign your body settled quickly.');
    else parts.push('.');
    say('heart', dev.has('hrUp') || dev.has('lateNadir') ? 'bad' : dev.has('hrDown') || (nadirFrac !== undefined && nadirFrac <= 0.5) ? 'good' : 'neutral', ...parts);
  }
  if (hrv !== undefined && (dev.has('hrvDown') || dev.has('hrvUp'))) {
    say('hrv', dev.has('hrvDown') ? 'bad' : 'good', 'HRV was ', dev.has('hrvDown') ? 'lower' : 'higher', ' than usual (', v(`${hrv} ms`), ' vs ', v(`${Math.round(u.hrv!)} ms`), ').');
  }

  const breathing = assessBreathing(breathingSummaryFor(input.vitals, m.id));
  if (breathing && (breathing.level === 'some' || breathing.level === 'frequent') && breathing.odi3 !== undefined) {
    say(
      'breathing',
      breathing.level === 'frequent' ? 'bad' : 'neutral',
      'Your watch saw ',
      v(`${breathing.odi3 < 10 ? breathing.odi3.toFixed(1) : Math.round(breathing.odi3)}`),
      ` oxygen dips an hour — ${breathing.level === 'frequent' ? 'more than is typical' : 'a few more than typical'}; see the breathing check.`,
    );
  }

  // ---- Evening factors ----
  const factors = findFactors(input, dev, u, onsetShift, eve);
  const likely = factors.filter((f) => f.role === 'likely');
  const helped = factors.filter((f) => f.role === 'helped');
  const noted = factors.filter((f) => f.role === 'noted');
  const factorPart = (f: StoryFactor): StoryPart[] => [{ text: f.label, factor: f.id }];
  if (likely.length) {
    say('factors', 'bad', likely.length > 1 ? 'Likely factors: ' : 'Likely factor: ', ...listParts(likely.map(factorPart)), '.');
    for (const f of likely.filter((x) => x.personal).slice(0, 2)) say('personal', 'neutral', f.personal!);
  }
  if (helped.length) {
    say('helped', 'good', 'Probably helped: ', ...listParts(helped.map(factorPart)), '.');
    for (const f of helped.filter((x) => x.personal).slice(0, 1)) say('personal', 'neutral', f.personal!);
  }
  if (noted.length) say('noted', 'neutral', 'Also logged, with no obvious effect tonight: ', ...listParts(noted.map(factorPart)), '.');
  const bad = BAD.filter((d) => dev.has(d));
  if (!likely.length && bad.length && !input.dayLogs[eve]) {
    say('hint', 'neutral', 'Nothing was logged for that evening — tagging evenings in the Journal lets eepy point to likely causes.');
  }
  if (!m.hasStages) say('stages', 'neutral', 'This sleep has no stage data, so only timing and wake-ups are described.');
  if (u.n < R.minBaseline) say('baseline', 'neutral', `eepy needs ${R.minBaseline - u.n} more night${R.minBaseline - u.n === 1 ? '' : 's'} to know what's usual for you.`);

  const deviations = [...dev];
  return {
    sessionId: m.id,
    wakeDate: m.wakeDate,
    sentences,
    factors,
    deviations,
    oneLiner: oneLiner(m, u, dev, likely),
    text: sentences.map((s) => s.parts.map((p) => p.text).join('')).join(' '),
    baselineNights: u.n,
    staged: m.hasStages,
  };
}

function findFactors(input: NightStoryInput, dev: Set<Deviation>, u: Usual, onsetShift: number | undefined, eve: string): StoryFactor[] {
  const R = STORY_RULES;
  const m = input.night;
  const insight = (id: string) => input.insights?.find((i) => i.id === id)?.effect;
  const out: StoryFactor[] = [];

  /**
   * Decides the role from the generic effects and (if measured) the personal one. A personal
   * effect alone makes a factor likely only for a specific metric (not total sleep / score).
   */
  const judge = (hurts: Deviation[], helps: Deviation[], personal?: InsightEffect) => {
    const pd = personal ? deviationOf(personal) : undefined;
    const hurtsSeen = hurts.filter((d) => dev.has(d));
    const helpsSeen = helps.filter((d) => dev.has(d));
    // A usually-helpful habit (no generic harms) is never blamed, whatever a correlation says.
    const trustHarm = !!personal && !personal.better && hurts.length > 0;
    if (trustHarm && pd && dev.has(pd) && !AGGREGATE.has(pd)) return { role: 'likely' as const, explains: [...new Set([pd, ...hurtsSeen])], personal: true };
    if (hurtsSeen.length) return { role: 'likely' as const, explains: hurtsSeen, personal: trustHarm };
    if (personal && personal.better && pd && dev.has(pd) && !AGGREGATE.has(pd)) return { role: 'helped' as const, explains: [...new Set([pd, ...helpsSeen])], personal: true };
    if (helpsSeen.length) return { role: 'helped' as const, explains: helpsSeen, personal: !!personal && personal.better };
    if (hurts.length) return { role: 'noted' as const, explains: [], personal: false };
    return undefined;
  };

  // Caffeine still active when the lights went out.
  const lightsOut = m.start;
  const doses = input.caffeine.filter((d) => d.time <= lightsOut && d.time > lightsOut - 24 * HOUR);
  const mg = caffeineAt(doses, lightsOut, input.profile.caffeineHalfLifeH);
  const tags = input.dayLogs[eve]?.tags ?? [];
  const skipTags = new Set<string>();
  if (mg >= R.caffeineMg) {
    const personal = insight('caffeine:bedtime');
    const j = judge(CAFFEINE_HURTS, [], personal);
    const rounded = mg >= 100 ? Math.round(mg / 10) * 10 : Math.round(mg / 5) * 5;
    if (j && (j.role !== 'noted' || mg >= input.profile.caffeineBedtimeLimitMg)) {
      out.push({
        id: 'caffeine',
        kind: 'caffeine',
        role: j.role,
        label: `~${rounded} mg of caffeine still active at lights-out`,
        short: 'late caffeine',
        explains: j.explains,
        personal: j.personal && personal ? personalSentence('On nights with caffeine still active at bedtime', personal) : undefined,
        date: eve,
      });
    }
    skipTags.add('late-caffeine');
  }

  // Workouts recorded by the watch.
  const wk = workoutsBeforeSleep([{ wakeDate: m.wakeDate, sleepOnset: m.sleepOnset }], input.workouts ?? []).get(m.wakeDate);
  const lastActive = wk?.workouts.filter((w) => !isLightWorkout(w) && w.end <= m.sleepOnset + 15 * MINUTE).slice(-1)[0];
  if (wk?.timing === 'late' && lastActive) {
    const personal = insight('workout:late');
    const j = judge(LATE_WORKOUT_HURTS, [], personal);
    if (j && j.role !== 'noted') {
      out.push({
        id: 'workout',
        kind: 'workout',
        role: j.role,
        label: `${withArticle(lowerLabel(workoutLabel(lastActive)))} workout ending ${formatDuration((wk.gapH ?? 0) * 60)} before you fell asleep`,
        short: 'a late workout',
        explains: j.explains,
        personal: j.personal && personal ? personalSentence('After late workouts', personal) : undefined,
        date: eve,
      });
    }
    skipTags.add('late-exercise').add('exercise');
  } else if (wk?.active && lastActive) {
    const personal = insight('workout:days');
    const j = judge([], WORKOUT_HELPS, personal);
    if (j && j.role === 'helped') {
      out.push({
        id: 'workout',
        kind: 'workout',
        role: 'helped',
        label: `your ${lowerLabel(workoutLabel(lastActive))} workout earlier in the day`,
        short: 'exercise',
        explains: j.explains,
        personal: j.personal && personal ? personalSentence('On workout days', personal) : undefined,
        date: eve,
      });
    }
    skipTags.add('exercise');
  }

  // Naps earlier that day.
  const naps = input.nights
    .filter((n) => n.wakeDate === eve || n.wakeDate === m.wakeDate)
    .flatMap((n) => n.naps)
    .filter((x) => x.end <= m.start && x.end >= m.start - 14 * HOUR);
  const napMin = naps.reduce((s, x) => s + x.totalSleepMin, 0);
  if (napMin >= R.napMin) {
    const lastEnd = Math.max(...naps.map((x) => x.end));
    const late = minutesOfDay(lastEnd) >= 15 * 60 || m.start - lastEnd < 6 * HOUR;
    const long = napMin >= 45;
    const hurts: Deviation[] = late || long ? ['latencyUp', 'deepDown'] : ['latencyUp'];
    const personal = insight('tag:nap');
    const j = judge(hurts, [], personal);
    if (j && j.role === 'likely') {
      out.push({
        id: 'nap',
        kind: 'nap',
        role: 'likely',
        label: `${withArticle(formatDuration(napMin))} nap ending at ${formatTime(lastEnd)}`,
        short: late ? 'a late nap' : 'a long nap',
        explains: j.explains,
        personal: j.personal && personal ? personalSentence('On days you nap', personal) : undefined,
        date: eve,
      });
    }
    skipTags.add('nap');
  }

  // An unusual bedtime, when it plausibly cost sleep (late) or made falling asleep harder (early).
  if (onsetShift !== undefined && Math.abs(onsetShift) >= 60) {
    const hurts: Deviation[] = onsetShift > 0 ? ['tstDown', 'remDown'] : ['latencyUp'];
    const seen = hurts.filter((d) => dev.has(d));
    if (seen.length) {
      out.push({
        id: 'bedtime',
        kind: 'bedtime',
        role: 'likely',
        label: onsetShift > 0 ? 'the later bedtime' : 'the earlier bedtime',
        short: onsetShift > 0 ? 'a late bedtime' : 'an early bedtime',
        explains: seen,
        date: eve,
      });
    }
  }

  // Journal tags for that evening.
  for (const tag of tags) {
    if (skipTags.has(tag)) continue;
    const eff = EFFECTS[tag];
    if (!eff) continue;
    const def = TAG_BY_ID[tag];
    const phrase = def?.phrase ?? tag;
    const personal = insight(`tag:${tag}`);
    const j = judge(eff.hurts ?? [], eff.helps ?? [], personal);
    if (!j) continue;
    out.push({
      id: `tag:${tag}`,
      kind: 'tag',
      role: j.role,
      label: phrase,
      short: phrase,
      explains: j.explains,
      personal: j.personal && personal ? personalSentence(`On nights after ${phrase}`, personal) : undefined,
      tag,
      date: eve,
    });
  }

  const rank = { likely: 0, helped: 1, noted: 2 };
  const sorted = out.sort((a, b) => rank[a.role] - rank[b.role] || b.explains.length - a.explains.length || Number(!!b.personal) - Number(!!a.personal));
  // Keep the story readable: the strongest few likely factors; the rest aren't blamed.
  return sorted.filter((f, i) => f.role !== 'likely' || i < MAX_LIKELY);
}

function oneLiner(m: SessionMetrics, u: Usual, dev: Set<Deviation>, likely: StoryFactor[]): string {
  const phrase: Partial<Record<Deviation, string>> = {
    wasoUp: `restless (${formatDuration(m.wasoMin)} awake)`,
    remDown: m.stagePct && u.remPct !== undefined ? `REM short (${pct(m.stagePct.rem)} vs ${pct(u.remPct)})` : 'REM short',
    deepDown: 'less deep sleep than usual',
    latencyUp: `slow to fall asleep (${mins(m.latencyMin)})`,
    tstDown: `${formatDuration(m.totalSleepMin)} asleep, ${formatDuration((u.tst ?? m.totalSleepMin) - m.totalSleepMin)} short of usual`,
    hrUp: 'heart rate higher than usual',
    lateNadir: 'heart rate settled late',
    latencyDown: `asleep in ${mins(m.latencyMin)}`,
    deepUp: 'more deep sleep than usual',
    remUp: 'plenty of REM',
    wasoDown: 'fewer wake-ups than usual',
    tstUp: `${formatDuration(m.totalSleepMin)} asleep, more than usual`,
  };
  const bad = BAD.filter((d) => dev.has(d) && phrase[d]).slice(0, 2);
  const good = GOOD.filter((d) => dev.has(d) && phrase[d]).slice(0, 2);
  const shorts = [...new Set(likely.map((f) => f.short))].slice(0, 2);
  if (bad.length) return `${capitalize(joinList(bad.map((d) => phrase[d]!)))}${shorts.length ? ` — likely ${joinList(shorts)}` : ''}.`;
  if (good.length) return `${capitalize(joinList(good.map((d) => phrase[d]!)))} — a good night.`;
  if (u.n < STORY_RULES.minBaseline) return `${formatDuration(m.totalSleepMin)} asleep${m.latencyMin >= 1 ? `, asleep in ${mins(m.latencyMin)}` : ''}.`;
  return `A typical night for you${m.latencyMin >= 1 ? ` — asleep in ${mins(m.latencyMin)}` : ''}.`;
}
