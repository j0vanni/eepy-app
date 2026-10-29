/**
 * Goals & streaks (consistent wake time, low sleep debt, caffeine cut-off kept, …).
 *
 * Every goal is evaluated per calendar day D:
 * - night goals (wake, debt, need, asleep on time) look at the main sleep that ended on the morning of D;
 * - day goals (caffeine cut-off, wind-down) look at what happened during day D / its evening.
 */
import type { Analysis } from './analysis';
import { planTonight } from './schedule';
import type { Night } from './sessions';
import { debtOnDate } from './sleepDebt';
import { addDays, atMinutes, clockDiff, formatClock, formatDuration, formatTime, MINUTE, minutesOfDay } from './time';
import type { CaffeineDose, DayLog, Profile, SleepDataset } from './types';

export type GoalId = 'consistent-wake' | 'debt-under-2h' | 'caffeine-cutoff' | 'in-bed-on-time' | 'meet-need' | 'wind-down';

export interface GoalSetting {
  id: GoalId;
  enabled: boolean;
  /** Date the goal was switched on (YYYY-MM-DD). */
  startedAt: string;
  /** Goal parameter as a clock time (minutes after midnight): wake target, caffeine cut-off or lights-out. */
  targetMin?: number;
}

/** Journal tags that count as a wind-down routine. `wind-down` is set from the goal card itself. */
export const WIND_DOWN_TAG = 'wind-down';
const WIND_DOWN_TAGS = [WIND_DOWN_TAG, 'reading', 'meditation', 'hot-shower'];

export interface GoalDef {
  id: GoalId;
  title: string;
  description: string;
  icon: string;
  /** Adjustable clock-time parameter. */
  param?: { label: string; stepMin: number };
}

export const GOAL_DEFS: GoalDef[] = [
  {
    id: 'consistent-wake',
    title: 'Consistent wake time',
    description: 'Up within 30 minutes of your target, every day — the strongest anchor for your body clock.',
    icon: 'alarm-check',
    param: { label: 'Target wake time', stepMin: 15 },
  },
  {
    id: 'in-bed-on-time',
    title: 'Asleep on time',
    description: "Fall asleep within 30 minutes of the night's planned lights-out.",
    icon: 'bed-clock',
    param: { label: 'Fixed lights-out (optional)', stepMin: 15 },
  },
  {
    id: 'meet-need',
    title: 'Meet your sleep need',
    description: 'Sleep at least your personal need (naps count), give or take 15 minutes.',
    icon: 'battery-charging-high',
  },
  {
    id: 'debt-under-2h',
    title: 'Sleep debt under 2h',
    description: 'Keep your rolling 14-night sleep debt below two hours.',
    icon: 'scale-balance',
  },
  {
    id: 'caffeine-cutoff',
    title: 'Caffeine cut-off kept',
    description: 'No caffeine logged after your cut-off time.',
    icon: 'coffee-off-outline',
    param: { label: 'Cut-off', stepMin: 30 },
  },
  {
    id: 'wind-down',
    title: 'Wind-down done',
    description: 'A screen-free wind-down before bed: tap "I wound down" or tag reading, meditation or a warm shower in the journal.',
    icon: 'weather-night',
  },
];

export const GOAL_BY_ID: Record<GoalId, GoalDef> = Object.fromEntries(GOAL_DEFS.map((g) => [g.id, g])) as Record<GoalId, GoalDef>;

/** Up to this many goals at a time keeps the focus. */
export const MAX_GOALS = 3;

export type GoalDayStatus = 'met' | 'missed' | 'unknown' | 'pending';

export interface GoalDay {
  date: string;
  status: GoalDayStatus;
  detail?: string;
}

export interface GoalProgress {
  setting: GoalSetting;
  def: GoalDef;
  /** Oldest → newest, ending today. */
  days: GoalDay[];
  today: GoalDay;
  currentStreak: number;
  bestStreak: number;
  /** Met / known over the last 7 finished days. */
  weekMet: number;
  weekKnown: number;
}

export interface GoalsSummary {
  goals: GoalProgress[];
  /** Share of goal-days met over the last 7 days (0–100). */
  weeklyScore?: number;
}

export interface GoalInput {
  today: string;
  now: number;
  nights: Night[];
  needMin: number;
  latencyMin: number;
  efficiency: number;
  habitualOnsetMin?: number;
  dayLogs: Record<string, DayLog>;
  caffeine: CaffeineDose[];
  profile: Profile;
  /** Default caffeine cut-off for today (engine-computed), minutes after midnight. */
  caffeineCutoffMin?: number;
}

export function goalInput(a: Analysis, data: Pick<SleepDataset, 'dayLogs' | 'caffeine' | 'profile'>): GoalInput {
  return {
    today: a.day,
    now: a.now,
    nights: a.nights,
    needMin: a.need.needMin,
    latencyMin: a.latencyMin,
    efficiency: a.efficiency,
    habitualOnsetMin: a.chronotype.habitual?.onsetMin,
    dayLogs: data.dayLogs,
    caffeine: data.caffeine,
    profile: data.profile,
    caffeineCutoffMin: a.caffeine.cutoff.cutoff !== undefined ? Math.round(minutesOfDay(a.caffeine.cutoff.cutoff) / 30) * 30 : undefined,
  };
}

/** Default parameter for a newly enabled goal. */
export function defaultGoalTarget(id: GoalId, input: Pick<GoalInput, 'profile' | 'caffeineCutoffMin'>): number | undefined {
  if (id === 'consistent-wake') return input.profile.workWakeMin;
  if (id === 'caffeine-cutoff') return input.caffeineCutoffMin !== undefined ? Math.min(input.caffeineCutoffMin, 16 * 60) : 14 * 60;
  return undefined;
}

function plannedBedtime(input: GoalInput, wakeDate: string, setting: GoalSetting): number {
  const evening = addDays(wakeDate, -1);
  if (setting.targetMin !== undefined) {
    return atMinutes(setting.targetMin >= 12 * 60 ? evening : wakeDate, setting.targetMin);
  }
  // Recreate that evening's plan: same need, the debt as of that morning, habitual timing.
  return planTonight({
    profile: input.profile,
    today: evening,
    needMin: input.needMin,
    debtMin: debtOnDate(input.nights, input.needMin, evening),
    efficiency: input.efficiency,
    latencyMin: input.latencyMin,
    habitualOnsetMin: input.habitualOnsetMin,
  }).bedtime;
}

export function evaluateGoalDay(setting: GoalSetting, date: string, input: GoalInput, byDate: Map<string, Night>): GoalDay {
  const isToday = date === input.today;
  const night = byDate.get(date);
  const main = night?.main;
  const pendingNight = (): GoalDay => ({ date, status: isToday ? 'pending' : 'unknown', detail: isToday ? "Waiting for last night's data" : 'No sleep recorded' });
  switch (setting.id) {
    case 'consistent-wake': {
      if (!main) return pendingNight();
      const target = setting.targetMin ?? input.profile.workWakeMin;
      const off = clockDiff(target, minutesOfDay(main.finalWake));
      return {
        date,
        status: Math.abs(off) <= 30 ? 'met' : 'missed',
        detail: `Up at ${formatTime(main.finalWake)} (${off === 0 ? 'on target' : `${Math.round(Math.abs(off))} min ${off > 0 ? 'late' : 'early'}`})`,
      };
    }
    case 'debt-under-2h': {
      if (!main) return pendingNight();
      const debt = debtOnDate(input.nights, input.needMin, date);
      return { date, status: debt < 120 ? 'met' : 'missed', detail: `Debt ${formatDuration(debt)}` };
    }
    case 'meet-need': {
      if (!main) return pendingNight();
      const ok = night!.totalSleepMin >= input.needMin - 15;
      return { date, status: ok ? 'met' : 'missed', detail: `${formatDuration(night!.totalSleepMin)} of ${formatDuration(input.needMin)}` };
    }
    case 'in-bed-on-time': {
      if (!main) return pendingNight();
      const planned = plannedBedtime(input, date, setting);
      const late = (main.sleepOnset - planned) / MINUTE;
      return {
        date,
        status: late <= 30 ? 'met' : 'missed',
        detail: `Asleep ${formatTime(main.sleepOnset)}, planned ${formatTime(planned)}`,
      };
    }
    case 'caffeine-cutoff': {
      const cutoff = setting.targetMin ?? 14 * 60;
      const from = atMinutes(date, cutoff);
      const to = atMinutes(date, 28 * 60);
      const late = input.caffeine.find((c) => c.time >= from && c.time < to);
      if (late) return { date, status: 'missed', detail: `${late.mg} mg at ${formatTime(late.time)}` };
      if (input.dayLogs[date]?.tags.includes('late-caffeine')) return { date, status: 'missed', detail: 'Journal: late caffeine' };
      if (isToday) return { date, status: 'pending', detail: input.now >= from ? `Nothing after ${formatClock(cutoff)} so far` : `Cut-off ${formatClock(cutoff)}` };
      // "Nothing logged" only means something for someone who logs caffeine.
      const lo = atMinutes(addDays(date, -7), 0);
      const hi = atMinutes(addDays(date, 8), 0);
      if (input.caffeine.some((c) => c.time >= lo && c.time < hi)) return { date, status: 'met', detail: `Nothing after ${formatClock(cutoff)}` };
      return { date, status: 'unknown', detail: 'No caffeine logged' };
    }
    case 'wind-down': {
      const tags = input.dayLogs[date]?.tags ?? [];
      if (tags.includes('screens')) return { date, status: 'missed', detail: 'Journal: screens in bed' };
      if (tags.some((t) => WIND_DOWN_TAGS.includes(t))) return { date, status: 'met', detail: 'Wound down' };
      if (isToday) return { date, status: 'pending', detail: 'Tonight' };
      return { date, status: 'unknown', detail: 'Not logged' };
    }
  }
}

/** Streaks skip up to this many consecutive days without data instead of breaking. */
const MAX_GAP = 2;

export function streaks(days: GoalDay[]): { current: number; best: number } {
  let best = 0;
  let run = 0;
  let gap = 0;
  for (const d of days) {
    if (d.status === 'met') {
      run++;
      gap = 0;
      best = Math.max(best, run);
    } else if (d.status === 'missed') {
      run = 0;
      gap = 0;
    } else if (d.status === 'unknown') {
      gap++;
      if (gap > MAX_GAP) run = 0;
    }
  }
  // Current: walk back from the newest day; today's pending status doesn't count against it.
  let current = 0;
  gap = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d.status === 'pending') continue;
    if (d.status === 'met') {
      current++;
      gap = 0;
    } else if (d.status === 'missed') break;
    else if (++gap > MAX_GAP) break;
  }
  return { current, best };
}

export function evaluateGoals(settings: GoalSetting[], input: GoalInput, historyDays = 60): GoalsSummary {
  const byDate = new Map(input.nights.map((n) => [n.wakeDate, n]));
  const goals: GoalProgress[] = [];
  let met = 0;
  let known = 0;
  for (const setting of settings) {
    if (!setting.enabled) continue;
    const def = GOAL_BY_ID[setting.id];
    if (!def) continue;
    const days: GoalDay[] = [];
    for (let i = historyDays - 1; i >= 0; i--) days.push(evaluateGoalDay(setting, addDays(input.today, -i), input, byDate));
    const { current, best } = streaks(days);
    const week = days.slice(-8).filter((d) => d.status !== 'pending').slice(-7);
    const weekMet = week.filter((d) => d.status === 'met').length;
    const weekKnown = week.filter((d) => d.status === 'met' || d.status === 'missed').length;
    met += weekMet;
    known += weekKnown;
    goals.push({ setting, def, days, today: days[days.length - 1], currentStreak: current, bestStreak: best, weekMet, weekKnown });
  }
  return { goals, weeklyScore: known > 0 ? Math.round((met / known) * 100) : undefined };
}

/** Met / known for each enabled goal over an inclusive date range (used by the weekly review). */
export function goalAdherence(settings: GoalSetting[], input: GoalInput, from: string, to: string): { id: GoalId; title: string; met: number; known: number }[] {
  const byDate = new Map(input.nights.map((n) => [n.wakeDate, n]));
  const out: { id: GoalId; title: string; met: number; known: number }[] = [];
  for (const s of settings) {
    if (!s.enabled || !GOAL_BY_ID[s.id]) continue;
    let met = 0;
    let known = 0;
    for (let d = from; d <= to && d <= input.today; d = addDays(d, 1)) {
      const st = evaluateGoalDay(s, d, input, byDate).status;
      if (st === 'met') met++;
      if (st === 'met' || st === 'missed') known++;
    }
    out.push({ id: s.id, title: GOAL_BY_ID[s.id].title, met, known });
  }
  return out;
}

/** Turns a goal on (keeping its original start date if it was on before) or off. */
export function toggleGoal(settings: GoalSetting[], id: GoalId, enabled: boolean, today: string, targetMin?: number): GoalSetting[] {
  const cur = settings.find((g) => g.id === id);
  const next: GoalSetting = cur
    ? { ...cur, enabled, startedAt: enabled && !cur.enabled ? today : cur.startedAt, targetMin: cur.targetMin ?? targetMin }
    : { id, enabled, startedAt: today, targetMin };
  return [...settings.filter((g) => g.id !== id), next];
}

export function setGoalTarget(settings: GoalSetting[], id: GoalId, targetMin: number | undefined): GoalSetting[] {
  return settings.map((g) => (g.id === id ? { ...g, targetMin } : g));
}
