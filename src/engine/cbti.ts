/**
 * CBT-I (cognitive behavioural therapy for insomnia): a 6-week programme built on sleep
 * restriction — a prescribed time-in-bed window anchored to a fixed wake time and titrated weekly
 * by sleep efficiency — plus stimulus control, cognitive work and relaxation.
 *
 * Everything here is pure. The window for any evening is recomputed from the programme's start,
 * its wake time, its starting window and the recorded nights, so the prescription can never drift
 * out of sync with the data and needs no "advance the week" step.
 *
 * Protocol (Spielman et al. 1987; AASM 2021 behavioural-treatment guideline):
 * - Starting window = average total sleep time of the last 7–14 recorded nights, never below 5h.
 * - Each completed week, by that week's sleep efficiency (time asleep ÷ time in bed):
 *   ≥ 90% → 15 min more (earlier bedtime), 85–90% → unchanged, < 85% → 15 min less.
 */
import { scoreQuiz } from './screening';
import type { Night } from './sessions';
import { addDays, atMinutes, clamp, daysBetween, formatClock, formatDuration, MINUTE, normalizeMinutes } from './time';
import type { Profile } from './types';

export const CBTI_WEEKS = 6;
/** The window never goes below this (standard protocol). */
export const CBTI_MIN_WINDOW_MIN = 300;
/** Gentler floor when extra sleepiness would be risky (sleepy at baseline, driving, safety-critical work). */
export const CBTI_GENTLE_MIN_WINDOW_MIN = 360;
export const CBTI_MAX_WINDOW_MIN = 540;
export const CBTI_STEP_MIN = 15;
export const CBTI_BASELINE_MIN_NIGHTS = 7;
export const CBTI_BASELINE_MAX_NIGHTS = 14;
/** Baseline nights must fall in the last four weeks. */
export const CBTI_BASELINE_LOOKBACK_DAYS = 28;
/** A week needs this many recorded nights before its efficiency moves the window. */
export const CBTI_MIN_WEEK_NIGHTS = 4;
export const EFFICIENCY_EXPAND = 0.9;
export const EFFICIENCY_SHRINK = 0.85;

/** A manual window change (e.g. "+15 min, I'm too sleepy"). Titration continues from it. */
export interface CbtiWeek {
  /** Evening (date key) from which this window applies. */
  weekStart: string;
  windowMin: number;
  /** Sleep efficiency when the change was made, for the history. */
  efficiency?: number;
}

export interface CbtiBaseline {
  /** Recorded nights used. */
  nights: number;
  avgSleepMin: number;
  avgInBedMin: number;
  /** Time asleep ÷ time in bed over the baseline nights (0–1). */
  efficiency: number;
  /** Starting window: average sleep rounded to 15 min, floor applied. */
  windowMin: number;
  /** Enough nights for a trustworthy starting window. */
  enough: boolean;
}

export interface CbtiProgram {
  active: boolean;
  /** Evening (date key) of the first programme night. Week 1 is the 7 nights from this evening. */
  startedAt: string;
  /** Fixed wake time the window is anchored to (minutes after midnight), every day of the week. */
  wakeMin: number;
  /** Starting time in bed (minutes), from the baseline. Later weeks are titrated from this. */
  windowMin: number;
  /** Manual window changes, oldest first. */
  weeks: CbtiWeek[];
  /** Lowest window allowed (5h standard, 6h gentle). */
  minWindowMin?: number;
  baseline?: CbtiBaseline;
  /** Date the user stopped the programme. */
  stoppedAt?: string;
}

export type AdjustmentVerdict = 'expand' | 'hold' | 'shrink' | 'insufficient';

export interface CbtiAdjustment {
  /** Change to the window in minutes, after floors and caps (+15 / 0 / −15). */
  deltaMin: number;
  verdict: AdjustmentVerdict;
  /** Short reason, e.g. "Efficiency 92% (≥ 90%): 15 min more in bed." */
  reason: string;
}

export interface CbtiWeekSummary {
  week: number;
  /** First and last evening (date keys) of the week. */
  startEvening: string;
  endEvening: string;
  /** Window at the start of the week (from titration). */
  startWindowMin: number;
  /** Window in effect at the end of the week (after manual changes). */
  windowMin: number;
  nightsRecorded: number;
  efficiency?: number;
  avgSleepMin?: number;
  avgInBedMin?: number;
  /** Nights spent in bed inside the prescribed window (± a little slack). */
  nightsInWindow: number;
  /** All seven nights are in the past. */
  complete: boolean;
  /** Decision at the end of this week; for the current week, what would happen if it ended now. */
  adjustment: CbtiAdjustment;
}

export interface CbtiNightPoint {
  evening: string;
  wakeDate: string;
  week: number;
  windowMin: number;
  efficiency?: number;
  sleepMin?: number;
  inWindow?: boolean;
}

export interface CbtiStatus {
  week: number;
  /** Past the 6 programme weeks: keep the window and keep titrating. */
  maintenance: boolean;
  bedMin: number;
  wakeMin: number;
  /** Tonight's window. */
  windowMin: number;
  weeks: CbtiWeekSummary[];
  current: CbtiWeekSummary;
  lastCompleted?: CbtiWeekSummary;
  /** Morning (date key) when the current week's adjustment is decided; it applies from that evening. */
  nextReviewDate: string;
  daysLeftInWeek: number;
  lesson: CbtiLesson;
  nights: CbtiNightPoint[];
  /** What changed since last week (the second sentence of `reason`). */
  change: string;
  /** For Tonight's plan: "Week 2 of your insomnia programme: in bed 00:15–06:30 (6h 15m). …" */
  reason: string;
}

const round15 = (m: number) => Math.round(m / CBTI_STEP_MIN) * CBTI_STEP_MIN;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function cbtiFloor(program: Pick<CbtiProgram, 'minWindowMin'>): number {
  return Math.max(CBTI_MIN_WINDOW_MIN, program.minWindowMin ?? CBTI_MIN_WINDOW_MIN);
}

function clampWindow(windowMin: number, floor: number): number {
  return clamp(round15(windowMin), floor, CBTI_MAX_WINDOW_MIN);
}

/** Time asleep ÷ time in bed for a night's main sleep. */
export function nightEfficiency(n: Night): number | undefined {
  const m = n.main;
  if (!m || m.timeInBedMin <= 0) return undefined;
  return Math.min(1, m.totalSleepMin / m.timeInBedMin);
}

/** Starting window from the last 7–14 recorded nights (main sleep only; naps don't count). */
export function cbtiBaseline(nights: Night[], today: string, minWindowMin = CBTI_MIN_WINDOW_MIN): CbtiBaseline {
  const from = addDays(today, -CBTI_BASELINE_LOOKBACK_DAYS);
  const recent = nights
    .filter((n) => n.main && n.main.timeInBedMin > 0 && n.wakeDate > from && n.wakeDate <= today)
    .slice(-CBTI_BASELINE_MAX_NIGHTS);
  const floor = Math.max(CBTI_MIN_WINDOW_MIN, minWindowMin);
  if (recent.length === 0) {
    return { nights: 0, avgSleepMin: 0, avgInBedMin: 0, efficiency: 0, windowMin: floor, enough: false };
  }
  const sleep = recent.reduce((s, n) => s + n.main!.totalSleepMin, 0);
  const inBed = recent.reduce((s, n) => s + n.main!.timeInBedMin, 0);
  const avgSleepMin = sleep / recent.length;
  return {
    nights: recent.length,
    avgSleepMin,
    avgInBedMin: inBed / recent.length,
    efficiency: inBed > 0 ? sleep / inBed : 0,
    windowMin: clampWindow(avgSleepMin, floor),
    enough: recent.length >= CBTI_BASELINE_MIN_NIGHTS,
  };
}

/** Creates a programme that starts tonight. */
export function startCbtiProgram(input: { nights: Night[]; today: string; wakeMin: number; minWindowMin?: number }): CbtiProgram {
  const minWindowMin = Math.max(CBTI_MIN_WINDOW_MIN, input.minWindowMin ?? CBTI_MIN_WINDOW_MIN);
  const baseline = cbtiBaseline(input.nights, input.today, minWindowMin);
  return {
    active: true,
    startedAt: input.today,
    wakeMin: Math.round(normalizeMinutes(input.wakeMin)),
    windowMin: baseline.windowMin,
    weeks: [],
    minWindowMin,
    baseline,
  };
}

/** Programme week (1-based) that the night starting on `evening` belongs to. */
export function cbtiWeekNumber(program: Pick<CbtiProgram, 'startedAt'>, evening: string): number {
  return Math.max(1, Math.floor(daysBetween(program.startedAt, evening) / 7) + 1);
}

/** First and last evening of a programme week. */
export function cbtiWeekRange(program: Pick<CbtiProgram, 'startedAt'>, week: number): { startEvening: string; endEvening: string } {
  const startEvening = addDays(program.startedAt, 7 * (week - 1));
  return { startEvening, endEvening: addDays(startEvening, 6) };
}

/**
 * The weekly titration rule: ≥ 90% → +15 min, 85–90% → unchanged, < 85% → −15 min, never below
 * the floor (5h) or above 9h. Weeks with fewer than 4 recorded nights leave the window alone.
 */
export function nextAdjustment(
  efficiency: number | undefined,
  nightsRecorded: number,
  windowMin: number,
  floorMin = CBTI_MIN_WINDOW_MIN,
): CbtiAdjustment {
  if (efficiency === undefined || nightsRecorded < CBTI_MIN_WEEK_NIGHTS) {
    return {
      deltaMin: 0,
      verdict: 'insufficient',
      reason: `Only ${nightsRecorded} night${nightsRecorded === 1 ? '' : 's'} recorded (need ${CBTI_MIN_WEEK_NIGHTS}): the window stays the same.`,
    };
  }
  const e = pct(efficiency);
  if (efficiency >= EFFICIENCY_EXPAND) {
    if (windowMin + CBTI_STEP_MIN > CBTI_MAX_WINDOW_MIN) {
      return { deltaMin: 0, verdict: 'hold', reason: `Efficiency ${e}: you're at the ${formatDuration(CBTI_MAX_WINDOW_MIN)} maximum window.` };
    }
    return { deltaMin: CBTI_STEP_MIN, verdict: 'expand', reason: `Efficiency ${e} (90% or more): 15 min more in bed, with a 15 min earlier bedtime.` };
  }
  if (efficiency >= EFFICIENCY_SHRINK) {
    return { deltaMin: 0, verdict: 'hold', reason: `Efficiency ${e} (85–90%): the window stays the same.` };
  }
  if (windowMin - CBTI_STEP_MIN < floorMin) {
    return {
      deltaMin: 0,
      verdict: 'hold',
      reason: `Efficiency ${e}: below 85%, but the window is already at its ${formatDuration(floorMin)} minimum.`,
    };
  }
  return { deltaMin: -CBTI_STEP_MIN, verdict: 'shrink', reason: `Efficiency ${e} (under 85%): 15 min less in bed, with a 15 min later bedtime.` };
}

/** Prescribed bedtime and wake as timestamps for the night starting on `evening`. */
export function cbtiNightWindow(evening: string, wakeMin: number, windowMin: number): { bedtime: number; wake: number } {
  const wake = atMinutes(addDays(evening, 1), wakeMin);
  return { bedtime: wake - windowMin * MINUTE, wake };
}

/** In bed no more than 20 min before the window opens and out of sleep by 30 min after it closes. */
function keptWindow(n: Night, evening: string, wakeMin: number, windowMin: number): boolean | undefined {
  const m = n.main;
  if (!m) return undefined;
  const { bedtime, wake } = cbtiNightWindow(evening, wakeMin, windowMin);
  return m.start >= bedtime - 20 * MINUTE && m.finalWake <= wake + 30 * MINUTE;
}

interface Timeline {
  weeks: CbtiWeekSummary[];
  nights: CbtiNightPoint[];
  windowTonight: number;
}

function buildTimeline(program: CbtiProgram, nights: Night[], today: string): Timeline {
  const floor = cbtiFloor(program);
  const currentWeek = cbtiWeekNumber(program, today);
  const byWake = new Map(nights.map((n) => [n.wakeDate, n]));
  const overrides = [...(program.weeks ?? [])].sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));

  const weeks: CbtiWeekSummary[] = [];
  const points: CbtiNightPoint[] = [];
  let window = clampWindow(program.windowMin, floor);
  let windowTonight = window;

  for (let week = 1; week <= currentWeek; week++) {
    const { startEvening, endEvening } = cbtiWeekRange(program, week);
    const startWindowMin = window;
    // Window in effect on an evening of this week: titrated start, then the latest manual change so far.
    const windowOn = (evening: string) => {
      let w = startWindowMin;
      for (const o of overrides) {
        const inThisWeek = week === 1 ? o.weekStart <= endEvening : o.weekStart >= startEvening && o.weekStart <= endEvening;
        if (inThisWeek && o.weekStart <= evening) w = clampWindow(o.windowMin, floor);
      }
      return w;
    };

    let sleep = 0;
    let inBed = 0;
    let recorded = 0;
    let inWindow = 0;
    for (let d = 0; d < 7; d++) {
      const evening = addDays(startEvening, d);
      const wakeDate = addDays(evening, 1);
      if (wakeDate > today) break; // tonight and later haven't happened yet
      const w = windowOn(evening);
      const n = byWake.get(wakeDate);
      const eff = n ? nightEfficiency(n) : undefined;
      const kept = n && eff !== undefined ? keptWindow(n, evening, program.wakeMin, w) : undefined;
      if (n?.main && eff !== undefined) {
        recorded++;
        sleep += n.main.totalSleepMin;
        inBed += n.main.timeInBedMin;
        if (kept) inWindow++;
      }
      points.push({ evening, wakeDate, week, windowMin: w, efficiency: eff, sleepMin: n?.main?.totalSleepMin, inWindow: kept });
    }

    const windowMin = windowOn(endEvening);
    if (week === currentWeek) windowTonight = windowOn(today);
    const efficiency = inBed > 0 ? sleep / inBed : undefined;
    const complete = today > endEvening;
    const adjustment = nextAdjustment(efficiency, recorded, windowMin, floor);
    weeks.push({
      week,
      startEvening,
      endEvening,
      startWindowMin,
      windowMin,
      nightsRecorded: recorded,
      efficiency,
      avgSleepMin: recorded ? sleep / recorded : undefined,
      avgInBedMin: recorded ? inBed / recorded : undefined,
      nightsInWindow: inWindow,
      complete,
      adjustment,
    });
    window = complete ? clampWindow(windowMin + adjustment.deltaMin, floor) : windowMin;
  }
  return { weeks, nights: points, windowTonight };
}

/** Week-by-week history of a programme up to (and including) the current week. */
export function cbtiTimeline(program: CbtiProgram, nights: Night[], today: string): CbtiWeekSummary[] {
  return buildTimeline(program, nights, today).weeks;
}

/** What changed since last week, e.g. "15 min more than last week: your sleep efficiency was 92%." */
function windowChange(windowMin: number, last?: CbtiWeekSummary): string {
  if (!last) return "Same wake time every day; if you can't sleep, get up until you're sleepy.";
  const e = last.efficiency !== undefined ? pct(last.efficiency) : '';
  const change = windowMin - last.windowMin;
  const { verdict, deltaMin } = last.adjustment;
  if (change !== deltaMin) return `You adjusted it by ${change > 0 ? '+' : ''}${change} min this week.`;
  if (verdict === 'insufficient') return 'Unchanged: too few nights were recorded last week.';
  if (change > 0) return `${change} min more than last week: your sleep efficiency was ${e}.`;
  if (change < 0) return `${-change} min less than last week: your sleep efficiency was ${e}.`;
  if (last.efficiency !== undefined && last.efficiency < EFFICIENCY_SHRINK) return `Unchanged: efficiency was ${e}, but this is the minimum window.`;
  if (last.efficiency !== undefined && last.efficiency >= EFFICIENCY_EXPAND) return `Unchanged: efficiency was ${e}, but this is the maximum window.`;
  return `Same as last week (sleep efficiency ${e}).`;
}

/** Everything the programme dashboard needs, for the night starting on `today`. */
export function cbtiStatus(program: CbtiProgram, nights: Night[], today: string): CbtiStatus {
  const { weeks, nights: points, windowTonight } = buildTimeline(program, nights, today);
  const current = weeks[weeks.length - 1];
  const lastCompleted = weeks.length > 1 ? weeks[weeks.length - 2] : undefined;
  const bedMin = normalizeMinutes(program.wakeMin - windowTonight);
  const change = windowChange(windowTonight, lastCompleted);
  return {
    week: current.week,
    maintenance: current.week > CBTI_WEEKS,
    bedMin,
    wakeMin: program.wakeMin,
    windowMin: windowTonight,
    weeks,
    current,
    lastCompleted,
    nextReviewDate: addDays(current.endEvening, 1),
    daysLeftInWeek: Math.max(0, daysBetween(today, current.endEvening) + 1),
    lesson: lessonForWeek(current.week),
    nights: points,
    change,
    reason: `Week ${current.week} of your insomnia programme${current.week > CBTI_WEEKS ? ' (maintenance)' : ''}: in bed ${formatClock(bedMin)}–${formatClock(program.wakeMin)} (${formatDuration(windowTonight)}). ${change}`,
  };
}

/** The window to plan tonight around, if a programme is running. */
export function currentCbtiWindow(
  program: CbtiProgram | undefined,
  nights: Night[],
  today: string,
): { bedMin: number; wakeMin: number; reason: string } | undefined {
  if (!program?.active) return undefined;
  const s = cbtiStatus(program, nights, today);
  return { bedMin: s.bedMin, wakeMin: s.wakeMin, reason: s.reason };
}

/** A manual change to tonight's window (kept for the rest of the week; titration continues from it). */
export function adjustCbtiWindow(program: CbtiProgram, nights: Night[], today: string, deltaMin: number): CbtiProgram {
  const s = cbtiStatus(program, nights, today);
  const windowMin = clampWindow(s.windowMin + deltaMin, cbtiFloor(program));
  const weeks = [...(program.weeks ?? []).filter((w) => w.weekStart !== today), { weekStart: today, windowMin, efficiency: s.current.efficiency }];
  return { ...program, weeks };
}

// ---------------------------------------------------------------------------------------------
// Lessons and rules

export interface CbtiLesson {
  week: number;
  id: 'restriction' | 'stimulus' | 'cognitive' | 'relaxation' | 'consolidation' | 'maintenance';
  title: string;
  summary: string;
  points: string[];
  practice: string[];
}

export const CBTI_LESSONS: CbtiLesson[] = [
  {
    week: 1,
    id: 'restriction',
    title: 'Sleep diary & sleep restriction',
    summary:
      'Lying in bed awake teaches your brain that bed is a place for being awake. For now you spend only as long in bed as you actually sleep, so sleep pressure builds and sleep becomes deeper and more continuous.',
    points: [
      'Your window starts at your average sleep time from the last two weeks (never under 5 hours). It grows as your sleep consolidates.',
      'Get up at the same time every day, weekends included, however the night went. A fixed wake time anchors your body clock.',
      'Expect to feel sleepier for the first one to two weeks. That pressure is what does the work. It passes.',
      'Your watch is your sleep diary. Wear it every night; log nights it missed so the weekly adjustment is fair.',
    ],
    practice: [
      'Stay up until the window opens, even if you feel tired earlier: do something calm in dim light.',
      'Skip naps, and don\'t drive or use machinery if you feel drowsy.',
    ],
  },
  {
    week: 2,
    id: 'stimulus',
    title: 'Stimulus control',
    summary:
      'Stimulus control (Bootzin) re-links bed with falling asleep quickly. It is one of the most effective single parts of CBT-I.',
    points: [
      'Go to bed only when sleepy (eyes heavy, head nodding), not just tired, and not before your window opens.',
      'Use the bed only for sleep and sex. No phone, TV, work or planning in bed.',
      'If you can\'t sleep after about 20 minutes (estimate it, don\'t check the clock), get up and go somewhere dim and calm. Return when sleepy. Repeat as often as needed.',
      'The same applies to waking in the night and lying awake.',
    ],
    practice: ['Pick your "get-up spot" now: a chair, a dim lamp, a dull book or calm music.', 'Turn the clock away from the bed.'],
  },
  {
    week: 3,
    id: 'cognitive',
    title: 'Worry time & thoughts about sleep',
    summary:
      'A racing mind and worry about sleep keep you alert. Give worries their own time slot, and test the beliefs that make bad nights feel catastrophic.',
    points: [
      'Worry time: 15 minutes in the early evening, well before bed. Write down each worry and one next step, then close the notebook.',
      'If a worry comes up in bed, note "that\'s for worry time" and let it go.',
      'Check unhelpful beliefs. "If I don\'t get 8 hours, tomorrow is ruined": most people function better than they predict after a short night.',
      'Trying hard to sleep backfires. Lying in the dark with the intention of resting while gently staying awake (paradoxical intention) lowers sleep effort.',
    ],
    practice: ['Do worry time on at least 5 days this week.', 'When you catch a catastrophic sleep thought, write a more balanced version.'],
  },
  {
    week: 4,
    id: 'relaxation',
    title: 'Relaxation',
    summary:
      'Hyperarousal is at the heart of insomnia. A daily relaxation practice lowers it. Practise it during the day too, not only as a way to force sleep.',
    points: [
      'Slow breathing: breathe out longer than you breathe in, about 6 breaths a minute, for 5–10 minutes.',
      'Progressive muscle relaxation: tense each muscle group for 5 seconds, then release for 15, from feet to face.',
      'Body scan or a short guided meditation during your wind-down hour.',
      'Relaxation is a skill: it works better after a week of practice. Don\'t judge it by one night.',
    ],
    practice: ['Practise once in the day and once in your wind-down, every day this week.'],
  },
  {
    week: 5,
    id: 'consolidation',
    title: 'Consolidation & sleep habits',
    summary:
      'Your window has been growing as your efficiency improves. This week, remove the things that fragment sleep, so the extra time in bed stays as real sleep.',
    points: [
      'Caffeine: none in the 8 hours before your window opens.',
      'Alcohol helps you drop off but breaks up the second half of the night. Avoid it in the 3 hours before bed.',
      'Daytime activity and morning daylight strengthen the body clock. Finish hard workouts 2 hours or more before bed.',
      'Keep the bedroom cool, dark and quiet. Keep a dim, screen-free hour before bed.',
    ],
    practice: ['Keep the wake time and window exactly as prescribed: consistency now locks in the gains.'],
  },
  {
    week: 6,
    id: 'maintenance',
    title: 'Maintenance & relapse prevention',
    summary:
      'You have the tools. Bad nights will still happen sometimes, after stress, illness or travel. What matters is how you respond to them.',
    points: [
      'Don\'t compensate after a bad night: no sleeping in, early nights or long naps. Those restart the cycle.',
      'Keep your wake time. Let the window grow by 15 minutes a week while efficiency stays at 90% or more and you still feel sleepy in the day.',
      'If insomnia returns for more than a few nights, go back to stimulus control and a week of restriction straight away.',
      'If sleep stays poor, or you are very sleepy in the day, see a doctor or a CBT-I clinician.',
    ],
    practice: ['Write your personal relapse plan: your wake time, your window, and the first three things you\'ll do.'],
  },
];

export function lessonForWeek(week: number): CbtiLesson {
  return CBTI_LESSONS[clamp(Math.floor(week), 1, CBTI_WEEKS) - 1];
}

export interface CbtiRule {
  id: 'sleepy' | 'bed-only' | 'get-up' | 'repeat' | 'wake' | 'no-naps';
  title: string;
  detail: string;
}

/** Stimulus-control rules (Bootzin 1972), with the user's wake time filled in. */
export function stimulusControlRules(wakeMin?: number): CbtiRule[] {
  return [
    { id: 'sleepy', title: 'Go to bed only when sleepy', detail: 'Sleepy, not just tired, and not before your window opens.' },
    { id: 'bed-only', title: 'Bed is for sleep (and sex) only', detail: 'No phone, TV, reading, work or worrying in bed.' },
    {
      id: 'get-up',
      title: "Can't sleep? Get up",
      detail: 'After about 20 minutes awake (don\'t watch the clock), go to another dim room and do something calm until you\'re sleepy.',
    },
    { id: 'repeat', title: 'Repeat as often as needed', detail: 'Including when you wake in the night and can\'t get back to sleep.' },
    {
      id: 'wake',
      title: wakeMin === undefined ? 'Same wake time every day' : `Get up at ${formatClock(wakeMin)} every day`,
      detail: 'Weekends too, however you slept.',
    },
    { id: 'no-naps', title: 'No naps', detail: 'If you must for safety, keep it under 20 minutes and before 15:00.' },
  ];
}

// ---------------------------------------------------------------------------------------------
// Safety

export type CbtiCondition = 'bipolar' | 'epilepsy' | 'apnoea' | 'pregnancy' | 'alertness';

export const CBTI_CONDITIONS: { id: CbtiCondition; label: string; sub: string }[] = [
  { id: 'bipolar', label: 'Bipolar disorder', sub: 'Including a past diagnosis' },
  { id: 'epilepsy', label: 'Epilepsy or seizures', sub: 'Any seizure disorder' },
  { id: 'apnoea', label: 'Sleep apnoea, untreated or suspected', sub: 'Loud snoring, pauses in breathing, gasping' },
  { id: 'pregnancy', label: 'Pregnant', sub: 'Or might be' },
  { id: 'alertness', label: 'Driving or safety-critical work', sub: 'Professional driving, machinery, medical or shift work needing high alertness' },
];

export interface CbtiSafetyFlag {
  id: CbtiCondition | 'stopbang' | 'ess' | 'ess-missing' | 'stopbang-missing' | 'isi-missing' | 'isi-low';
  /** clinician: do it only with a clinician · caution: gentler floor + talk to a clinician · info: tip. */
  severity: 'clinician' | 'caution' | 'info';
  title: string;
  detail: string;
}

export interface CbtiSafety {
  flags: CbtiSafetyFlag[];
  /** At least one condition means sleep restriction should be supervised by a clinician. */
  needsClinician: boolean;
  /** Recommended floor for the window. */
  minWindowMin: number;
}

/** Contra-indications and cautions for sleep restriction, from the user's answers and saved self-checks. */
export function cbtiSafety(profile: Pick<Profile, 'screenings'>, declared: Partial<Record<CbtiCondition, boolean>>): CbtiSafety {
  const flags: CbtiSafetyFlag[] = [];
  const s = profile.screenings ?? {};
  if (declared.bipolar) {
    flags.push({
      id: 'bipolar',
      severity: 'clinician',
      title: 'Bipolar disorder',
      detail: 'Sleep loss can trigger mania or hypomania. Only use sleep restriction with your psychiatrist\'s guidance.',
    });
  }
  if (declared.epilepsy) {
    flags.push({
      id: 'epilepsy',
      severity: 'clinician',
      title: 'Epilepsy',
      detail: 'Sleep loss lowers the seizure threshold. Talk to your neurologist before restricting sleep.',
    });
  }
  if (declared.apnoea) {
    flags.push({
      id: 'apnoea',
      severity: 'clinician',
      title: 'Sleep apnoea',
      detail: 'Untreated apnoea makes restriction unsafe (more daytime sleepiness) and can itself cause broken sleep. Get it assessed and treated first.',
    });
  }
  const sb = s.stopbang;
  if (sb && !declared.apnoea && scoreQuiz('stopbang', sb.answers).band.level === 'alert') {
    flags.push({
      id: 'stopbang',
      severity: 'clinician',
      title: 'High sleep-apnoea risk',
      detail: `Your STOP-Bang score (${sb.score}) suggests a high risk of sleep apnoea. Ask a doctor about a sleep study before restricting sleep.`,
    });
  }
  if (declared.pregnancy) {
    flags.push({
      id: 'pregnancy',
      severity: 'clinician',
      title: 'Pregnancy',
      detail: 'Don\'t use sleep restriction in pregnancy without medical advice. Stimulus control, worry time and relaxation are safe to use.',
    });
  }
  if (declared.alertness) {
    flags.push({
      id: 'alertness',
      severity: 'caution',
      title: 'Your work or driving needs high alertness',
      detail: 'Restriction makes you sleepier for the first weeks. eepy uses a gentler 6 h minimum. Never drive or operate machinery when drowsy, and consider doing the programme with a clinician.',
    });
  }
  const ess = s.ess?.score;
  if (ess !== undefined && ess >= 11) {
    flags.push({
      id: 'ess',
      severity: 'caution',
      title: 'Already sleepy in the day',
      detail: `Your daytime-sleepiness score is ${ess} (11 or more is above normal). Restriction adds sleepiness, so eepy uses a gentler 6 h minimum. Please check with a doctor first${ess >= 16 ? ': a score this high needs medical assessment' : ''}.`,
    });
  }
  if (ess === undefined) {
    flags.push({ id: 'ess-missing', severity: 'info', title: 'Take the daytime-sleepiness check', detail: 'It takes 1 minute and tells eepy whether restriction would make you dangerously sleepy.' });
  }
  if (!sb) {
    flags.push({ id: 'stopbang-missing', severity: 'info', title: 'Take the sleep-apnoea check', detail: 'Apnoea can look like insomnia, and restriction isn\'t safe with untreated apnoea.' });
  }
  const isi = s.isi?.score;
  if (isi === undefined) {
    flags.push({ id: 'isi-missing', severity: 'info', title: 'Take the insomnia check', detail: 'Your score shows whether this programme fits, and lets you measure progress after 6 weeks.' });
  } else if (isi < 8) {
    flags.push({
      id: 'isi-low',
      severity: 'info',
      title: 'Your insomnia check is in the normal range',
      detail: `Your score is ${isi}. CBT-I is designed for persistent insomnia (trouble sleeping 3 or more nights a week for 3 months or more).`,
    });
  }
  const gentle = flags.some((f) => f.id === 'alertness' || f.id === 'ess');
  return {
    flags,
    needsClinician: flags.some((f) => f.severity === 'clinician'),
    minWindowMin: gentle ? CBTI_GENTLE_MIN_WINDOW_MIN : CBTI_MIN_WINDOW_MIN,
  };
}
