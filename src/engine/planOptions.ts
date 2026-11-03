/**
 * "Options for tonight": several ways to spend tonight, each simulated, scored and explained — and
 * eepy's pick with the steps that led to it ("how eepy decided").
 *
 * Candidates (only the ones that apply):
 *   plan          eepy's plan (schedule.planTonight, as the analysis has it)
 *   skip-routine  the plan for that morning without the two-step routine (a two-step morning)
 *   earliest      the earliest lights-out you can likely fall asleep at (usual onset − the debt-aware
 *                 body-clock advance), when it's 15+ min off the plan — e.g. the 5-hour floor put
 *                 the plan before the body clock is ready — but never before the full-need time
 *   catch-up      your full need + the debt extra (the need-based time), with its expected time lying awake
 *   later         "can't make it": 30 min later (from an hour before lights-out); also without the routine
 *   nap           the plan + a 20-min nap tomorrow afternoon
 *   sleep-in      up to an hour later, only on a morning without a fixed alarm (costs body-clock time)
 * After eepy's lights-out has passed ("still up"): bed now (by now + 15 min), bed now without the
 * routine, bed now + a nap tomorrow, bed now + sleeping in, and another 30 min up.
 *
 * Each one is replayed by the what-if simulator (simulate.simulateTomorrow: sleep, time to fall
 * asleep including lying awake from an early lights-out, debt after tonight, tomorrow's energy and
 * focus), then projected over the next six nights of the week plan (debt with the real 14-night
 * model). A transparent utility (UTILITY) weighs sleep (more when the night is short or you're run
 * down), debt in a week, tomorrow (more with an early or important first event), lying awake, the
 * routine, realism (a lights-out far before when you've actually been going to bed) and the
 * body-clock cost of sleeping in. The plan — or the option already in use — stays the pick unless
 * another one beats it by UTILITY.keepMargin. Nothing is applied here: using an option is the user's
 * tap (src/state/planOptions.ts sets `settings.tonight` and/or `wakePlan[date].twoStep`).
 *
 * Learning (adherence.ts): how late you've been for the plan feeds realism, the reasoning and a
 * wind-down nudge; the advance rate feeds the ramp of coming nights (analysis.ts → planTonight).
 */
import { ADHERENCE, Adherence, AdvanceRate, estimateAdherence, PlanLog } from './adherence';
import type { Analysis } from './analysis';
import { applyTonightOverride, BODY_CLOCK, bodyClockAdvanceMin, planTonight, timeTonight, TonightChoice, TonightOverride, TonightPlan } from './schedule';
import { Scenario, ScenarioOutcome, SIM, simulateTomorrow } from './simulate';
import { projectDebt } from './sleepDebt';
import { addDays, atMinutes, clamp, clockDiff, formatDuration, formatTime, HOUR, MINUTE, minutesOfDay, weekdayOfKey } from './time';
import type { TwoStepPlan } from './twoStep';
import type { Profile, SleepDataset } from './types';
import { preShiftTonight, recoveryExtraMin } from './weekPlan';

export type PlanOptionId =
  | 'plan'
  | 'skip-routine'
  | 'earliest'
  | 'catch-up'
  | 'later'
  | 'later-skip'
  | 'nap'
  | 'sleep-in'
  | 'now'
  | 'now-skip'
  | 'now-nap'
  | 'now-sleep-in'
  | 'stay-up'
  | 'current';

/** ahead = lights-out is more than an hour away; evening = within the hour; still-up = eepy's lights-out has passed. */
export type PlanMode = 'ahead' | 'evening' | 'still-up';

/** The weights. Points are only compared with each other; every part is shown in `parts`. */
export const UTILITY = {
  /** Points per hour of expected sleep tonight: on a short night (under 5 h, or under 75% of your need), up to your need, beyond it. */
  sleepShortPerH: 14,
  sleepPerH: 10,
  sleepExtraPerH: 5,
  shortNightMin: 300,
  shortNightShare: 0.75,
  /** Points per hour of sleep debt left a week from now. */
  debtWeekPerH: -2,
  /** Tomorrow: per point of average energy and per hour of focus time … */
  energyPerPt: 0.4,
  focusPerH: 0.4,
  /** … counting this much more with an early first event, and again with an important one. */
  earlyEventBoost: 0.5,
  importantEventBoost: 0.5,
  /** Per minute of expected extra time lying awake (lights-out before the body clock is ready). */
  lyingAwakePerMin: -0.25,
  /** Keeping your two-step routine (0 when you're run down: sleep wins). About 35 min of sleep on a normal night. */
  routine: 6,
  /** Per minute a lights-out is earlier than you've actually been going to bed, beyond the grace (less grace when you're often late). */
  realismPerMin: -0.04,
  realismGraceMin: 60,
  /** Per hour slept in (it shifts the body clock later) — triple while eepy is easing your body clock earlier. */
  sleepInPerH: -3,
  easingSleepIn: 3,
  /** Fitting a nap into tomorrow. */
  napEffort: -1.5,
  /** Run down (low readiness or HRV, a recovery warning, sick): sleep counts this much more, lying awake this much more, sleeping in half as much. */
  strainedSleep: 1.3,
  strainedLyingAwake: 1.5,
  strainedSleepIn: 0.5,
  /** Insomnia mode: lying awake costs double. */
  insomniaLyingAwake: 2,
  /** The plan (or the option in use) stays eepy's pick unless another option beats it by this much. */
  keepMargin: 3,
} as const;

/** Options timing. */
export const OPTIONS = {
  /** "Evening": this close to eepy's lights-out the "can't make it" option appears. */
  eveningMin: 60,
  laterMin: 30,
  /** "Bed now": lights out this long from now (rounded up to 5 min). */
  nowLeadMin: 15,
  stayUpMin: 30,
  /** A time that saves or moves less than this isn't a different option. */
  minDiffMin: 15,
  maxSleepInMin: 60,
  napSleepMin: 20,
  /** Tomorrow's nap ends by 3 PM (and 5 h before lights-out). */
  napLatestMin: 15 * 60,
  /** Nights projected (tonight included). */
  weekNights: 7,
} as const;

const IMPORTANT_EVENT = /\b(exams?|tests?|quiz|interviews?|presentations?|presenting|pitch|demo|defen[cs]e|viva|flights?|surgery|deadline|audition|race|match|competition|recital|performance|oral)\b/i;

export interface UtilityParts {
  sleep: number;
  debt: number;
  tomorrow: number;
  lyingAwake: number;
  routine: number;
  realism: number;
  bodyClock: number;
  effort: number;
}

export interface ProjectedNight {
  wakeDate: string;
  bedtime: number;
  sleepMin: number;
  /** Debt the morning after (the 14-night model). */
  debtAfterMin: number;
}

/** How to use an option (src/state/planOptions.ts does it). */
export interface OptionApply {
  wakeDate: string;
  /** `settings.tonight` (undefined = eepy's own times). */
  tonight?: TonightOverride;
  /** `wakePlan[wakeDate].twoStep`: true / false, or null = what your week says. */
  routine: boolean | null;
}

export interface PlanOption {
  id: PlanOptionId;
  title: string;
  /** "Lights out 11:42 PM · routine 4:47 AM · up 6:00 AM" */
  times: string;
  /** "lights out 11:51 PM and skip the routine (+19m sleep)" — the reasoning's conclusion. */
  decision: string;
  /** "Lights out by 12:20 AM, skip the routine" — the Still-up card's headline. */
  headline: string;
  bedtime: number;
  wake: number;
  noAlarm: boolean;
  /** The cycle-timed alarm ending the main sleep (the routine alarm on a two-step morning). */
  alarm?: number;
  routine?: { alarm: number; backToSleep: number; awakeMin: number };
  nap?: { start: number; minutes: number; sleepMin: number };
  sleepMin: number;
  /** vs eepy's plan (or, still up, vs going to bed now with the plan's routine). */
  deltaSleepMin: number;
  deltaBedMin: number;
  latencyMin: number;
  /** Extra time lying awake because lights-out is before the body clock is ready. */
  lyingAwakeMin: number;
  debtAfterMin: number;
  /** Debt a week from now: tonight like this, then eepy's plan. */
  debtWeekMin: number;
  /** Tonight like this, then eepy's plan for the next six nights (what using it changes). */
  week: ProjectedNight[];
  /** For a strategy (skip the routine, earliest, full catch-up): the week if you kept doing it every night. */
  kept?: { rule: string; week: ProjectedNight[]; debtWeekMin: number };
  energy: number;
  focusHours: number;
  pros: string[];
  cons: string[];
  utility: number;
  parts: UtilityParts;
  apply: OptionApply;
  inUse: boolean;
  recommended: boolean;
  /** eepy's plan (or bed now with it, still up). */
  isDefault: boolean;
}

export interface PlanOptions {
  mode: PlanMode;
  wakeDate: string;
  /** Recommended first, then the rest in a fixed order. */
  options: PlanOption[];
  recommended: PlanOption;
  /** What eepy would do without your input: the plan (or bed now, still up). */
  defaultOption: PlanOption;
  /** The option in use tonight (`settings.tonight.choice`, or your own times). */
  inUse?: PlanOption;
  choice?: TonightChoice;
  /** eepy's plan for tonight (without your changes). */
  base: { bedtime: number; wake: number; windDownStart: number; routine?: { alarm: number; firstWake: number } };
  /** Back to eepy's plan. */
  reset: OptionApply;
  /** "How eepy decided", in order. */
  thinking: string[];
  /** Bedtime keeps slipping: start wind-down earlier (and turn on the screens-off reminder). */
  nudge?: { text: string; action?: 'screens-off' };
  adherence?: Adherence;
  advance?: AdvanceRate;
  strained?: string;
}

export interface PlanOptionsInput {
  analysis: Analysis;
  data: SleepDataset;
  now: number;
  /** `settings.tonight`. */
  override?: TonightOverride;
  /** What eepy planned on past nights (store `planLog`). */
  planLog?: PlanLog;
  /** An "I'm in bed" session is open for tonight: nothing to choose. */
  inBed?: boolean;
  /** Settings → screens-off reminder is on. */
  screensOffReminder?: boolean;
}

const ceil5 = (t: number) => Math.ceil(t / (5 * MINUTE)) * 5 * MINUTE;
const round5 = (t: number) => Math.round(t / (5 * MINUTE)) * 5 * MINUTE;
const signedMin = (m: number) => `${m >= 0 ? '+' : '−'}${formatDuration(Math.abs(Math.round(m)))}`;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The profile with one morning's routine choice set (null = what the week says). */
function withRoutine(profile: Profile, date: string, routine: boolean | null): Profile {
  const plan = { ...profile.wakePlan?.[date] };
  if (routine === null) delete plan.twoStep;
  else plan.twoStep = routine;
  const wakePlan = { ...profile.wakePlan };
  if (Object.keys(plan).length) wakePlan[date] = plan;
  else delete wakePlan[date];
  return { ...profile, wakePlan };
}

/** Tonight as eepy plans it for `profile` (the analysis' own inputs), eased like the analysis did. */
function replan(a: Analysis, profile: Profile): TonightPlan {
  const plan = planTonight({ ...a.planInput, profile });
  const ps = a.tonight.preShift;
  if (!ps) return plan;
  const forWake = a.upcoming.find((n) => n.wakeDate === ps.forDate)?.wake ?? plan.wake;
  return preShiftTonight(plan, ps.minutes, ps.forDate, forWake);
}

interface Shape {
  bedtime: number;
  wake: number;
  noAlarm: boolean;
  isWorkday: boolean;
  twoStep?: TwoStepPlan;
  alarm?: number;
  windDownStart: number;
}

interface Ctx {
  a: Analysis;
  data: SleepDataset;
  now: number;
  wakeDate: string;
  eff: number;
  latencyMin: number;
  needMin: number;
  debtMin: number;
  windDownMin: number;
  ramp: number;
  /** Usual sleep onset (clock minutes; the earlier of habit and the last three nights, as the planner uses). */
  onsetMin?: number;
  insomnia: boolean;
  strained?: string;
  tomorrowWeight: number;
  /** When you've actually been going to bed lately (clock minutes). */
  recentLightsOutMin?: number;
  lateMin: number;
  /** Two-step morning in eepy's plan … */
  routineDay: boolean;
  /** … with its routine alarm here. */
  routineAlarm?: number;
}

/** A night from a plan variant with lights-out (and wake-up) moved, timed like the analysis does. */
function shapeOf(ctx: Ctx, plan: TonightPlan, bedtime: number, wake?: number): Shape | undefined {
  const w = wake ?? plan.wake;
  if (w - bedtime < 90 * MINUTE) return undefined;
  const moved = bedtime === plan.bedtime && w === plan.wake ? plan : applyTonightOverride(plan, { wakeDate: plan.wakeDate, bedtime, wake: w }, ctx.windDownMin);
  const { tonight, alarm } = timeTonight(moved, ctx.a.cycleMin, ctx.latencyMin, ctx.a.efficiency);
  return {
    bedtime: tonight.bedtime,
    wake: tonight.wake,
    noAlarm: !!tonight.noAlarm,
    isWorkday: tonight.isWorkday,
    windDownStart: tonight.windDownStart,
    ...(tonight.twoStep ? { twoStep: tonight.twoStep } : {}),
    ...(tonight.noAlarm ? {} : { alarm: alarm.alarm }),
  };
}

/** Usual onset as a timestamp near `t` (the night `t` belongs to). */
function onsetNear(t: number, onsetMin: number): number {
  return t + clockDiff(minutesOfDay(t), onsetMin) * MINUTE;
}

/** Extra minutes lying awake for lights-out at `bed` (the simulator's rule: simulate.SIM.earlyBedLatencyShare). */
function lyingAwakeFor(bed: number, onset: number | undefined, debtMin: number): number {
  if (onset === undefined) return 0;
  const ahead = (onset - bed) / MINUTE;
  const allowed = bodyClockAdvanceMin(debtMin) + BODY_CLOCK.minHoldMin;
  return Math.min(SIM.maxEarlyBedLatencyMin, Math.max(0, ahead - allowed) * SIM.earlyBedLatencyShare);
}

/** Sleep points: an hour counts more on a night well short of your need, and less beyond your need. */
export function sleepPoints(sleepMin: number, needMin: number): number {
  const shortBelow = Math.max(UTILITY.shortNightMin, UTILITY.shortNightShare * needMin);
  const short = Math.min(sleepMin, shortBelow);
  const mid = clamp(sleepMin - shortBelow, 0, Math.max(0, needMin - shortBelow));
  const extra = Math.max(0, sleepMin - Math.max(needMin, shortBelow));
  return (UTILITY.sleepShortPerH * short + UTILITY.sleepPerH * mid + UTILITY.sleepExtraPerH * extra) / 60;
}

export interface UtilityInput {
  sleepMin: number;
  debtWeekMin: number;
  energy: number;
  focusHours: number;
  lyingAwakeMin: number;
  /** A two-step morning where this option keeps the routine. */
  keepsRoutine: boolean;
  bedtime: number;
  sleepInMin: number;
  nap: boolean;
}

export interface UtilityContext {
  needMin: number;
  strained: boolean;
  tomorrowWeight: number;
  insomnia: boolean;
  recentLightsOutMin?: number;
  /** How late you usually are for the plan (minutes). */
  lateMin: number;
  /** eepy is easing your body clock earlier (tonight or the next nights are held). */
  easing?: boolean;
}

/** The transparent score of one option: the sum of its parts. */
export function optionUtility(o: UtilityInput, c: UtilityContext): { total: number; parts: UtilityParts } {
  const U = UTILITY;
  const earlierThanUsual = c.recentLightsOutMin !== undefined ? clockDiff(minutesOfDay(o.bedtime), c.recentLightsOutMin) : 0;
  const grace = U.realismGraceMin - clamp(c.lateMin, 0, 45);
  const parts: UtilityParts = {
    sleep: sleepPoints(o.sleepMin, c.needMin) * (c.strained ? U.strainedSleep : 1),
    debt: (U.debtWeekPerH * o.debtWeekMin) / 60,
    tomorrow: (U.energyPerPt * o.energy + U.focusPerH * o.focusHours) * c.tomorrowWeight,
    lyingAwake: U.lyingAwakePerMin * o.lyingAwakeMin * (c.strained ? U.strainedLyingAwake : 1) * (c.insomnia ? U.insomniaLyingAwake : 1),
    routine: o.keepsRoutine && !c.strained ? U.routine : 0,
    realism: U.realismPerMin * Math.max(0, earlierThanUsual - grace),
    bodyClock: o.sleepInMin > 0 ? ((U.sleepInPerH * o.sleepInMin) / 60) * (c.strained ? U.strainedSleepIn : c.easing ? U.easingSleepIn : 1) : 0,
    effort: o.nap ? U.napEffort * (c.strained ? 1 / 3 : 1) : 0,
  };
  const total = Object.values(parts).reduce((s, x) => s + x, 0);
  return { total: Math.round(total * 10) / 10, parts };
}

interface Cand {
  id: PlanOptionId;
  title: string;
  /** The plan variant: eepy's plan, or eepy's plan for that morning without the routine. */
  plan: TonightPlan;
  skip: boolean;
  bedtime: number;
  wake?: number;
  nap?: boolean;
  sleepInMin?: number;
  /** A strategy you could keep up every night (projected as `kept`). */
  keep?: Keep;
}

type Keep = 'skip-routine' | 'catch-up' | 'earliest';

interface Evaluated {
  cand: Cand;
  shape: Shape;
  out: ScenarioOutcome;
  napPlan?: { start: number; minutes: number };
  week: ProjectedNight[];
  kept?: ProjectedNight[];
}

function scenarioOf(s: Shape, nap?: { start: number; minutes: number }): Scenario {
  return {
    bedtime: s.bedtime,
    wake: s.wake,
    ...(s.twoStep ? { routine: { start: s.twoStep.firstAlarm, minutes: s.twoStep.awakeMin } } : {}),
    ...(nap ? { tomorrowNap: nap } : {}),
  };
}

/** A 20-min nap tomorrow at the afternoon dip (by 3 PM and 5 h before lights-out), from a night's simulation. */
function napFor(ctx: Ctx, out: ScenarioOutcome): { start: number; minutes: number } | undefined {
  const napLatency = clamp(Math.round(ctx.latencyMin / 2), 5, 10);
  const minutes = OPTIONS.napSleepMin + napLatency;
  const wake = out.scenario.wake;
  const nextBed = ctx.a.upcoming[1]?.bedtime ?? out.scenario.bedtime + 24 * HOUR;
  const latestEnd = Math.min(atMinutes(ctx.wakeDate, OPTIONS.napLatestMin), nextBed - 5 * HOUR);
  const earliest = wake + 4 * HOUR;
  const want = out.tomorrow.dip ? out.tomorrow.dip.t - 15 * MINUTE : wake + 7 * HOUR;
  const start = round5(clamp(want, earliest, latestEnd - minutes * MINUTE));
  if (start < earliest - MINUTE || start + minutes * MINUTE > latestEnd + MINUTE) return undefined;
  return { start, minutes };
}

/**
 * Tonight and the next six nights: tonight like this, then eepy's week plan — or, with `keep`, the
 * same strategy every night. `planBed`: eepy's lights-out tonight (later than it, or sleeping in,
 * moves the next night's body clock a little later too).
 */
function projectWeek(ctx: Ctx, c: Cand, s: Shape, out: ScenarioOutcome, planBed: number, keep?: Keep): ProjectedNight[] {
  const { a, eff, latencyMin, needMin } = ctx;
  const sleepOf = (bed: number, wake: number, awakeMin: number) => Math.max(0, Math.round(((wake - bed) / MINUTE - latencyMin - awakeMin) * eff));
  const coming: { wakeDate: string; sleepMin: number }[] = [{ wakeDate: ctx.wakeDate, sleepMin: out.sleep.sleepMin + out.tomorrowNapSleepMin }];
  const nights: ProjectedNight[] = [{ wakeDate: ctx.wakeDate, bedtime: s.bedtime, sleepMin: Math.round(out.sleep.sleepMin), debtAfterMin: Math.round(out.debtMin) }];
  // Later than eepy's plan tonight, or sleeping in: the next night's body clock runs a little later too.
  const lateBy = Math.max(0, (s.bedtime - planBed) / MINUTE);
  const echo = keep ? 0 : Math.round(lateBy / 3 + (c.sleepInMin ?? 0) / 2);
  let debt = out.debtMin;
  for (let k = 1; k < OPTIONS.weekNights; k++) {
    const up = a.upcoming[k];
    if (!up) break;
    let bed = up.bedtime;
    let sleep = up.sleepMin;
    const awake = up.twoStep?.awakeMin ?? 0;
    if (keep === 'skip-routine' && up.twoStep) {
      // eepy's plan for that morning without the routine: the 30 min back as sleep on a short (held) night, or a later lights-out.
      if (up.heldBack) sleep += Math.round(awake * eff);
      else bed += awake * MINUTE;
    } else if (keep === 'catch-up' || keep === 'earliest') {
      const extra = !ctx.insomnia && debt >= 60 ? Math.min(60, recoveryExtraMin(debt)) : 0;
      const needBed = up.wake - Math.round(needMin / eff + latencyMin + extra + awake) * MINUTE;
      const onset = ctx.onsetMin !== undefined ? onsetNear(up.bedtime, ctx.onsetMin - ctx.ramp * k) : undefined;
      if (keep === 'catch-up') {
        if (needBed < bed) {
          bed = needBed;
          sleep = sleepOf(bed, up.wake, awake + lyingAwakeFor(bed, onset, debt));
        }
      } else if (onset !== undefined) {
        const feasible = Math.max(needBed, onset - bodyClockAdvanceMin(debt) * MINUTE);
        if (feasible < bed) {
          bed = feasible;
          sleep = sleepOf(bed, up.wake, awake);
        }
      }
    } else if (k === 1 && echo > 0) {
      if (up.heldBack) {
        bed += echo * MINUTE;
        sleep -= echo * eff;
      } else sleep -= echo * 0.5 * eff;
    }
    sleep = Math.max(0, Math.round(sleep));
    coming.push({ wakeDate: up.wakeDate, sleepMin: sleep });
    debt = projectDebt(a.nights, needMin, coming)[coming.length - 1];
    nights.push({ wakeDate: up.wakeDate, bedtime: bed, sleepMin: sleep, debtAfterMin: Math.round(debt) });
  }
  return nights;
}

const KEPT_RULE: Record<Keep, string> = {
  'skip-routine': 'skipping the routine every two-step morning',
  'catch-up': 'lights out at your full-need time every night',
  earliest: 'lights out at the earliest you can fall asleep every night',
};

function timesOf(s: Shape, mode: PlanMode, nap?: { start: number }): string {
  const bed = `${mode === 'still-up' ? 'Lights out by' : 'Lights out'} ${formatTime(s.bedtime)}`;
  const morning = s.noAlarm
    ? `wake ~${formatTime(s.wake)} (no alarm)`
    : s.twoStep
      ? `routine ${formatTime(s.twoStep.firstAlarm)} · up ${formatTime(s.wake)}`
      : `alarm ${formatTime(s.alarm ?? s.wake)}`;
  return [bed, morning, nap ? `nap ${formatTime(nap.start)}` : ''].filter(Boolean).join(' · ');
}

/** Everything eepy considers for tonight, scored, with its pick and the reasoning. Undefined when there's nothing to choose. */
export function planTonightOptions(input: PlanOptionsInput): PlanOptions | undefined {
  const { analysis: a, data, now } = input;
  if (input.inBed) return undefined;
  // A prescribed window (the insomnia programme) wins over everything.
  if (a.planInput.sleepWindow) return undefined;
  const profile = a.planInput.profile;
  const wakeDate = a.tonight.wakeDate;
  const override = input.override?.wakeDate === wakeDate ? input.override : undefined;
  const choice = override?.choice;
  // The morning's routine choice before any option switched it.
  const originalRoutine: boolean | null = choice && choice.routineBefore !== undefined ? choice.routineBefore : (profile.wakePlan?.[wakeDate]?.twoStep ?? null);
  const baseProfile = choice && choice.routineBefore !== undefined ? withRoutine(profile, wakeDate, choice.routineBefore) : profile;
  const basePlan = override ? replan(a, baseProfile) : a.tonight;
  // The plan has passed its own wake-up (a stale analysis): nothing sensible to offer.
  if (now >= basePlan.wake - 90 * MINUTE) return undefined;

  const eff = clamp(a.efficiency, 0.8, 0.97);
  const adherence = estimateAdherence({ nights: a.nights, timelines: a.timelines, planLog: input.planLog, latencyMin: a.latencyMin, today: a.day });
  const onsets = [a.chronotype.habitual?.onsetMin, a.recentOnsetMin].filter((m): m is number => m !== undefined);
  // The planner holds against the earlier of the habit and the last three nights.
  const onsetMin = onsets.length ? onsets.reduce((x, y) => (clockDiff(x, y) < 0 ? y : x)) : undefined;
  const strained = strainOf(a, data);
  const cal = basePlan.calendar;
  const earlyEvent = !!cal && (cal.drove || cal.eventStart - basePlan.wake <= (cal.prepMin + 30) * MINUTE);
  const importantEvent = !!cal?.eventTitle && IMPORTANT_EVENT.test(cal.eventTitle);
  const ctx: Ctx = {
    a,
    data,
    now,
    wakeDate,
    eff,
    latencyMin: a.latencyMin,
    needMin: a.need.needMin,
    debtMin: a.debt.debtMin,
    windDownMin: profile.windDownMin,
    ramp: a.advance?.rampMinPerNight ?? BODY_CLOCK.rampMinPerNight,
    onsetMin,
    insomnia: profile.insomniaMode,
    strained,
    tomorrowWeight: 1 + (earlyEvent ? UTILITY.earlyEventBoost : 0) + (importantEvent ? UTILITY.importantEventBoost : 0),
    recentLightsOutMin: adherence?.recentLightsOutMin ?? (a.recentOnsetMin !== undefined ? a.recentOnsetMin - a.latencyMin : undefined),
    lateMin: adherence?.usualLateMin ?? 0,
    routineDay: !!basePlan.twoStep,
    ...(basePlan.twoStep ? { routineAlarm: basePlan.twoStep.firstAlarm } : {}),
  };

  const mode: PlanMode = now >= basePlan.bedtime ? 'still-up' : now >= basePlan.bedtime - OPTIONS.eveningMin * MINUTE ? 'evening' : 'ahead';
  const skipPlan = basePlan.twoStep ? replan(a, withRoutine(baseProfile, wakeDate, false)) : undefined;
  const onsetTonight = onsetMin !== undefined ? onsetNear(basePlan.bedtime, onsetMin) : undefined;
  const advance = bodyClockAdvanceMin(ctx.debtMin);
  const earliestFeasible = onsetTonight !== undefined ? round5(onsetTonight - advance * MINUTE) : undefined;
  const awakeMin = basePlan.twoStep?.awakeMin ?? 0;
  const extra = !ctx.insomnia && ctx.debtMin >= 60 ? Math.min(60, a.planInput.payoffExtraMin ?? Math.round(ctx.debtMin / 6 / 5) * 5) : 0;
  const catchUpBed = round5(basePlan.wake - Math.round(ctx.needMin / eff + ctx.latencyMin + extra + awakeMin) * MINUTE);
  const soonest = ceil5(now + 10 * MINUTE);
  const diff = OPTIONS.minDiffMin * MINUTE;

  const cands: Cand[] = [];
  const add = (c: Cand) => cands.push(c);
  if (mode !== 'still-up') {
    add({ id: 'plan', title: "eepy's plan", plan: basePlan, skip: false, bedtime: basePlan.bedtime });
    if (skipPlan) add({ id: 'skip-routine', title: 'Skip the routine', plan: skipPlan, skip: true, bedtime: skipPlan.bedtime, keep: 'skip-routine' });
    const catchUpShown = !ctx.insomnia && catchUpBed <= basePlan.bedtime - diff && catchUpBed >= soonest && ctx.debtMin >= 30;
    // Earlier than the full-need time only buys sleep you don't need; within a few minutes of the plan it's the plan.
    if (!ctx.insomnia && earliestFeasible !== undefined && Math.abs(earliestFeasible - basePlan.bedtime) >= diff && earliestFeasible >= soonest && earliestFeasible >= catchUpBed + 10 * MINUTE) {
      add({ id: 'earliest', title: "Earliest you'll fall asleep", plan: basePlan, skip: false, bedtime: earliestFeasible, keep: 'earliest' });
    }
    if (catchUpShown) add({ id: 'catch-up', title: 'Full catch-up', plan: basePlan, skip: false, bedtime: catchUpBed, keep: 'catch-up' });
    if (mode === 'evening') {
      const later = ceil5(Math.max(basePlan.bedtime + OPTIONS.laterMin * MINUTE, now + 20 * MINUTE));
      add({ id: 'later', title: "Can't make it", plan: basePlan, skip: false, bedtime: later });
      if (skipPlan) add({ id: 'later-skip', title: 'Later, skip the routine', plan: skipPlan, skip: true, bedtime: later });
    }
    if (!ctx.insomnia && (ctx.debtMin >= 60 || strained)) add({ id: 'nap', title: 'Plan + nap tomorrow', plan: basePlan, skip: false, bedtime: basePlan.bedtime, nap: true });
    if (!ctx.insomnia && !basePlan.isWorkday) {
      const sleepIn = sleepInMinFor(profile, basePlan);
      if (sleepIn >= OPTIONS.minDiffMin) add({ id: 'sleep-in', title: 'Sleep in a little', plan: basePlan, skip: false, bedtime: basePlan.bedtime, wake: basePlan.wake + sleepIn * MINUTE, sleepInMin: sleepIn });
    }
  } else {
    const bed = ceil5(now + OPTIONS.nowLeadMin * MINUTE);
    add({ id: 'now', title: 'Bed now', plan: basePlan, skip: false, bedtime: bed });
    if (skipPlan) add({ id: 'now-skip', title: 'Bed now, skip the routine', plan: skipPlan, skip: true, bedtime: bed });
    if (!ctx.insomnia && (ctx.debtMin >= 60 || strained)) add({ id: 'now-nap', title: 'Bed now + nap tomorrow', plan: basePlan, skip: false, bedtime: bed, nap: true });
    if (!ctx.insomnia && !basePlan.isWorkday) {
      const sleepIn = sleepInMinFor(profile, basePlan);
      if (sleepIn >= OPTIONS.minDiffMin) add({ id: 'now-sleep-in', title: 'Bed now, sleep in', plan: basePlan, skip: false, bedtime: bed, wake: basePlan.wake + sleepIn * MINUTE, sleepInMin: sleepIn });
    }
    if (basePlan.wake - bed >= 3 * HOUR + OPTIONS.stayUpMin * MINUTE) {
      add({ id: 'stay-up', title: `Another ${OPTIONS.stayUpMin} min up`, plan: basePlan, skip: false, bedtime: bed + OPTIONS.stayUpMin * MINUTE });
    }
  }

  // Simulate each one (the default first: its tomorrow sets the nap time).
  const evaluated: Evaluated[] = [];
  const defaultId: PlanOptionId = mode === 'still-up' ? 'now' : 'plan';
  let defaultOut: ScenarioOutcome | undefined;
  for (const c of cands) {
    const s = shapeOf(ctx, c.plan, c.bedtime, c.wake);
    if (!s) continue;
    const napPlan = c.nap ? (defaultOut ? napFor(ctx, defaultOut) : undefined) : undefined;
    if (c.nap && !napPlan) continue;
    const out = simulateTomorrow(a, data, scenarioOf(s, napPlan)).scenario;
    if (c.id === defaultId) defaultOut = out;
    evaluated.push({ cand: c, shape: s, out, napPlan, week: [] });
  }
  const def = evaluated.find((e) => e.cand.id === defaultId);
  if (!def) return undefined;
  // Your own times for tonight that aren't one of the options (or the option no longer applies).
  const tonightNow = a.tonight;
  const routineNow = !!tonightNow.twoStep;
  const sameShape = (e: Evaluated) =>
    Math.abs(e.shape.bedtime - tonightNow.bedtime) <= 5 * MINUTE && Math.abs(e.shape.wake - tonightNow.wake) <= MINUTE && !!e.shape.twoStep === routineNow;
  let inUse: Evaluated | undefined;
  if (choice) inUse = evaluated.find((e) => e.cand.id === choice.id && sameShape(e));
  else if (override) inUse = evaluated.find((e) => !e.cand.nap && e.cand.id !== 'plan' && sameShape(e)) ?? evaluated.find((e) => e.cand.id === 'plan' && sameShape(e));
  else if (mode !== 'still-up') inUse = def;
  if (!inUse && override && tonightNow.bedtime > now) {
    const s: Shape = {
      bedtime: tonightNow.bedtime,
      wake: tonightNow.wake,
      noAlarm: !!tonightNow.noAlarm,
      isWorkday: tonightNow.isWorkday,
      windDownStart: tonightNow.windDownStart,
      ...(tonightNow.twoStep ? { twoStep: tonightNow.twoStep } : {}),
      ...(tonightNow.noAlarm ? {} : { alarm: a.alarm.alarm }),
    };
    const c: Cand = { id: 'current', title: choice?.title ?? 'Your own times', plan: tonightNow, skip: !routineNow && ctx.routineDay, bedtime: s.bedtime, wake: s.wake };
    const napPlan = choice?.napAt !== undefined ? { start: choice.napAt, minutes: OPTIONS.napSleepMin + clamp(Math.round(ctx.latencyMin / 2), 5, 10) } : undefined;
    const out = simulateTomorrow(a, data, scenarioOf(s, napPlan)).scenario;
    inUse = { cand: { ...c, nap: !!napPlan }, shape: s, out, napPlan, week: [] };
    evaluated.push(inUse);
  }
  for (const e of evaluated) {
    e.week = projectWeek(ctx, e.cand, e.shape, e.out, basePlan.bedtime);
    if (e.cand.keep) e.kept = projectWeek(ctx, e.cand, e.shape, e.out, basePlan.bedtime, e.cand.keep);
  }

  const uctx: UtilityContext = {
    needMin: ctx.needMin,
    strained: !!strained,
    tomorrowWeight: ctx.tomorrowWeight,
    insomnia: ctx.insomnia,
    recentLightsOutMin: ctx.recentLightsOutMin,
    lateMin: ctx.lateMin,
    easing: basePlan.gradual || a.upcoming.slice(1, 4).some((n) => n.heldBack),
  };
  const scored = evaluated.map((e) => {
    const week = e.week;
    const u = optionUtility(
      {
        sleepMin: e.out.sleep.sleepMin,
        debtWeekMin: week[week.length - 1].debtAfterMin,
        energy: e.out.tomorrow.avgEnergy,
        focusHours: e.out.tomorrow.focusHours,
        lyingAwakeMin: e.out.sleep.latencyParts.earlyBedMin,
        keepsRoutine: ctx.routineDay && !!e.shape.twoStep,
        bedtime: e.shape.bedtime,
        sleepInMin: e.cand.sleepInMin ?? 0,
        nap: !!e.napPlan,
      },
      uctx,
    );
    return { e, u };
  });
  const incumbent = scored.find((x) => x.e === (inUse ?? def))!;
  const best = scored.reduce((b, x) => (x.u.total > b.u.total ? x : b));
  const pick = best.u.total >= incumbent.u.total + UTILITY.keepMargin ? best : incumbent;
  const defScored = scored.find((x) => x.e === def)!;

  const reset: OptionApply = { wakeDate, routine: originalRoutine };
  const options = scored.map(({ e, u }) => toOption(ctx, mode, e, u, { def: defScored.e, inUse, pick: pick.e, originalRoutine }));
  const byId = new Map(options.map((o, i) => [scored[i].e, o]));
  const recommended = byId.get(pick.e)!;
  const defaultOption = byId.get(def)!;
  const inUseOption = inUse ? byId.get(inUse) : undefined;
  const ordered = [recommended, ...options.filter((o) => o !== recommended)];

  const thinking = reasoning(ctx, mode, { basePlan, earliestFeasible, onsetTonight, adherence, recommended, defaultOption, options, strained, earlyEvent, importantEvent });
  const nudge = nudgeFor(ctx, adherence, basePlan, input.screensOffReminder);

  return {
    mode,
    wakeDate,
    options: ordered,
    recommended,
    defaultOption,
    ...(inUseOption ? { inUse: inUseOption } : {}),
    ...(choice ? { choice } : {}),
    base: {
      bedtime: basePlan.bedtime,
      wake: basePlan.wake,
      windDownStart: basePlan.windDownStart,
      ...(basePlan.twoStep ? { routine: { alarm: basePlan.twoStep.firstAlarm, firstWake: basePlan.twoStep.firstWake } } : {}),
    },
    reset,
    thinking,
    ...(nudge ? { nudge } : {}),
    ...(adherence ? { adherence } : {}),
    ...(a.advance ? { advance: a.advance } : {}),
    ...(strained ? { strained } : {}),
  };
}

/** Run down: low readiness or HRV, a recovery warning, or "sick" in the journal (today or yesterday). */
function strainOf(a: Analysis, data: SleepDataset): string | undefined {
  const sick = [a.day, addDays(a.day, -1)].some((d) => data.dayLogs[d]?.tags.includes('sick'));
  if (sick) return 'You logged being sick';
  if (a.recoveryAlert?.level === 'warning') return 'Your body shows signs of strain';
  const r = a.readiness;
  if (r && r.score < 55) return `Readiness is low today (${r.score})`;
  const hrv = r?.contributors.find((c) => c.key === 'hrv');
  if (hrv && hrv.score < 58) return 'Your HRV is well below normal';
  return undefined;
}

/** Up to an hour later on a morning without a fixed alarm — never more than 2 h after your workday wake-up. */
function sleepInMinFor(profile: Profile, plan: TonightPlan): number {
  const workWake = atMinutes(plan.wakeDate, profile.workWakeMin);
  return Math.max(0, Math.min(OPTIONS.maxSleepInMin, Math.round((workWake + 2 * HOUR - plan.wake) / MINUTE)));
}

function toOption(
  ctx: Ctx,
  mode: PlanMode,
  e: Evaluated,
  u: { total: number; parts: UtilityParts },
  rel: { def: Evaluated; inUse?: Evaluated; pick: Evaluated; originalRoutine: boolean | null },
): PlanOption {
  const { cand: c, shape: s, out } = e;
  const sleepMin = Math.round(out.sleep.sleepMin);
  const deltaSleepMin = Math.round(out.sleep.sleepMin - rel.def.out.sleep.sleepMin);
  const deltaBedMin = Math.round((s.bedtime - rel.def.shape.bedtime) / MINUTE);
  const lyingAwakeMin = Math.round(out.sleep.latencyParts.earlyBedMin);
  const week = e.week;
  const debtWeekMin = week[week.length - 1].debtAfterMin;
  const napSleepMin = Math.round(out.tomorrowNapSleepMin);
  const nap = e.napPlan ? { start: e.napPlan.start, minutes: e.napPlan.minutes, sleepMin: napSleepMin } : undefined;
  const routineAfter = c.skip ? false : rel.originalRoutine;
  const apply: OptionApply =
    c.id === 'plan'
      ? { wakeDate: ctx.wakeDate, routine: rel.originalRoutine }
      : {
          wakeDate: ctx.wakeDate,
          routine: routineAfter,
          tonight: {
            wakeDate: ctx.wakeDate,
            ...(s.bedtime !== c.plan.bedtime ? { bedtime: s.bedtime } : {}),
            ...(s.wake !== c.plan.wake ? { wake: s.wake } : {}),
            choice: {
              id: c.id,
              title: c.title,
              ...(routineAfter !== rel.originalRoutine ? { routineBefore: rel.originalRoutine } : {}),
              ...(nap ? { napAt: nap.start } : {}),
            },
          },
        };
  const defDebtWeek = rel.def.week[rel.def.week.length - 1].debtAfterMin;
  const keptDebtWeek = e.kept ? e.kept[e.kept.length - 1].debtAfterMin : undefined;
  const texts = prosCons(ctx, mode, e, { sleepMin, deltaSleepMin, deltaBedMin, lyingAwakeMin, debtWeekMin, defDebtWeek, keptDebtWeek, napSleepMin, defEnergy: rel.def.out.tomorrow.avgEnergy });
  return {
    id: c.id,
    title: c.title,
    times: timesOf(s, mode, nap),
    decision: decisionOf(c, s, mode, deltaSleepMin, nap),
    headline: headlineOf(c, s, mode, nap),
    bedtime: s.bedtime,
    wake: s.wake,
    noAlarm: s.noAlarm,
    ...(s.alarm !== undefined ? { alarm: s.alarm } : {}),
    ...(s.twoStep ? { routine: { alarm: s.twoStep.firstAlarm, backToSleep: s.twoStep.backToSleep, awakeMin: s.twoStep.awakeMin } } : {}),
    ...(nap ? { nap } : {}),
    sleepMin,
    deltaSleepMin,
    deltaBedMin,
    latencyMin: Math.round(out.sleep.latencyMin),
    lyingAwakeMin,
    debtAfterMin: Math.round(out.debtMin),
    debtWeekMin,
    week,
    ...(e.kept && c.keep ? { kept: { rule: KEPT_RULE[c.keep], week: e.kept, debtWeekMin: e.kept[e.kept.length - 1].debtAfterMin } } : {}),
    energy: Math.round(out.tomorrow.avgEnergy),
    focusHours: Math.round(out.tomorrow.focusHours * 10) / 10,
    pros: texts.pros,
    cons: texts.cons,
    utility: u.total,
    parts: u.parts,
    apply,
    inUse: e === rel.inUse,
    recommended: e === rel.pick,
    isDefault: e === rel.def,
  };
}

function decisionOf(c: Cand, s: Shape, mode: PlanMode, deltaSleepMin: number, nap?: { start: number }): string {
  const bed = `lights out ${mode === 'still-up' ? 'by ' : ''}${formatTime(s.bedtime)}`;
  const gain = Math.abs(deltaSleepMin) >= 5 ? ` (${signedMin(deltaSleepMin)} sleep)` : '';
  switch (c.id) {
    case 'plan':
      return `keep eepy's plan — ${bed}${s.twoStep ? `, routine alarm ${formatTime(s.twoStep.firstAlarm)}` : ''}`;
    case 'skip-routine':
    case 'later-skip':
    case 'now-skip':
      return `${bed} and skip the routine${gain}`;
    case 'earliest':
      return `${bed}, the earliest you're likely to fall asleep${gain}`;
    case 'catch-up':
      return `${bed} for your full need${gain}`;
    case 'nap':
    case 'now-nap':
      return `${bed}${c.skip ? ', skip the routine' : ''} and nap 20 min around ${formatTime(nap!.start)} tomorrow`;
    case 'sleep-in':
    case 'now-sleep-in':
      return `${bed} and sleep in until ${formatTime(s.wake)}${gain}`;
    case 'current':
      return `stick with your choice — ${bed}`;
    default:
      return `${bed}${gain}`;
  }
}

function headlineOf(c: Cand, s: Shape, mode: PlanMode, nap?: { start: number }): string {
  const bed = `Lights out ${mode === 'still-up' ? 'by ' : ''}${formatTime(s.bedtime)}`;
  const parts = [bed];
  if (c.skip) parts.push('skip the routine');
  else if (s.twoStep) parts.push(`routine ${formatTime(s.twoStep.firstAlarm)}`);
  if (s.wake !== c.plan.wake) parts.push(`sleep in until ${formatTime(s.wake)}`);
  if (nap) parts.push(`nap ${formatTime(nap.start)} tomorrow`);
  return parts.join(', ');
}

function prosCons(
  ctx: Ctx,
  mode: PlanMode,
  e: Evaluated,
  n: { sleepMin: number; deltaSleepMin: number; deltaBedMin: number; lyingAwakeMin: number; debtWeekMin: number; defDebtWeek: number; keptDebtWeek?: number; napSleepMin: number; defEnergy: number },
): { pros: string[]; cons: string[] } {
  const { cand: c, shape: s, out } = e;
  const pros: string[] = [];
  const cons: string[] = [];
  const need = ctx.needMin;
  const more = n.deltaSleepMin >= 5 ? `+${formatDuration(n.deltaSleepMin)} sleep` : '';
  const less = n.deltaSleepMin <= -5 ? `${signedMin(n.deltaSleepMin)} sleep` : '';
  const short = n.sleepMin < need - 30 ? `${formatDuration(n.sleepMin)} sleep — ${formatDuration(need - n.sleepMin)} under your need` : '';
  const debtBetter = n.debtWeekMin <= n.defDebtWeek - 10 ? `Debt in a week ${formatDuration(n.debtWeekMin)} instead of ${formatDuration(n.defDebtWeek)}` : '';
  const debtWorse = n.debtWeekMin >= n.defDebtWeek + 10 ? `Debt in a week ${formatDuration(n.debtWeekMin)} instead of ${formatDuration(n.defDebtWeek)}` : '';
  const lateNote = ctx.lateMin >= ADHERENCE.lateMin ? `You've been going to bed ~${ctx.lateMin} min after the plan lately` : '';
  const recover = ctx.strained ? `${ctx.strained} — extra sleep helps you recover` : '';
  const routineMorning = ctx.routineDay;
  const push = (list: string[], ...xs: string[]) => xs.forEach((x) => x && list.push(x));
  switch (c.id) {
    case 'plan':
    case 'now':
      if (routineMorning && s.twoStep) push(pros, `Keeps your routine at ${formatTime(s.twoStep.firstAlarm)}`);
      if (c.id === 'plan' && c.plan.gradual) push(pros, `Eases your body clock earlier, ~${ctx.ramp} min a night`);
      if (n.sleepMin >= need - 15) push(pros, `Covers your ${formatDuration(need)} need`);
      if (c.id === 'now') push(pros, 'As close to the plan as it gets now');
      if (!pros.length) push(pros, 'Nothing to change');
      push(cons, short, c.id === 'plan' ? lateNote : '');
      if (n.lyingAwakeMin >= 10) push(cons, `~${n.lyingAwakeMin} min lying awake before you drift off`);
      break;
    case 'skip-routine':
    case 'now-skip':
    case 'later-skip':
      push(pros, more || (n.deltaBedMin >= 5 ? `Lights out ${n.deltaBedMin} min later, same sleep` : ''), `One alarm at ${formatTime(s.alarm ?? s.wake)}`, recover);
      push(pros, 'Do the routine tonight in your wind-down instead');
      push(cons, routineMorning && ctx.routineAlarm !== undefined ? `No routine at ${formatTime(ctx.routineAlarm)} tomorrow` : '', less, c.id === 'later-skip' ? short : '');
      break;
    case 'earliest':
      if (n.deltaBedMin < 0) {
        push(pros, more, debtBetter, 'No lying awake: your body clock should be ready');
        push(cons, `Lights out ${formatDuration(-n.deltaBedMin)} earlier — wind-down from ${formatTime(s.windDownStart)}`, lateNote ? `${lateNote}; earlier still is hard to keep` : '');
      } else {
        // The plan is earlier than the body clock is ready (the 5-hour floor): when you'll actually be sleepy.
        push(pros, `Lights out ${formatDuration(n.deltaBedMin)} later, when you're likely to be sleepy`, 'Less time lying awake');
        push(cons, less, short);
      }
      break;
    case 'catch-up':
      push(pros, more, debtBetter, `Time in bed for your full need${ctx.debtMin >= 60 ? ' and some debt' : ''}`);
      push(cons, n.lyingAwakeMin >= 5 ? `Expect ~${n.lyingAwakeMin} min lying awake — your body clock isn't ready that early` : '', 'Lying awake a lot can make falling asleep harder on later nights', lateNote ? `${lateNote}; this is even earlier` : '');
      break;
    case 'later':
    case 'stay-up':
      push(pros, `Lights out ${formatTime(s.bedtime)} — for an evening that runs late`);
      push(cons, less, short, debtWorse);
      if (e.week[1] && e.week[1].bedtime > (ctx.a.upcoming[1]?.bedtime ?? Infinity) + 4 * MINUTE) push(cons, `Tomorrow's lights-out ~${Math.round((e.week[1].bedtime - ctx.a.upcoming[1].bedtime) / MINUTE)} min later too (body clock)`);
      break;
    case 'nap':
    case 'now-nap': {
      const dEnergy = Math.round(out.tomorrow.avgEnergy - n.defEnergy);
      push(pros, `~${n.napSleepMin} min of sleep tomorrow around ${formatTime(e.napPlan!.start)}`, dEnergy >= 1 ? `Tomorrow's energy +${dEnergy}` : 'Takes the edge off the afternoon dip', debtBetter, recover);
      if (c.skip) push(pros, more);
      push(cons, `Keep it to 20 min and done by ${formatTime(e.napPlan!.start + e.napPlan!.minutes * MINUTE)} — longer or later makes tomorrow night harder`, 'Needs a quiet 25 min tomorrow', c.id === 'now-nap' ? short : '');
      break;
    }
    case 'sleep-in':
    case 'now-sleep-in':
      push(pros, more, s.noAlarm ? 'No alarm — wake when you wake' : '', recover);
      push(cons, `Shifts your body clock: tomorrow night you'll likely get sleepy ~${Math.round((c.sleepInMin ?? 0) / 2)} min later`);
      break;
    case 'current':
      push(pros, 'What you chose for tonight');
      push(cons, less, short);
      break;
  }
  if (mode === 'still-up' && c.id !== 'stay-up' && !cons.length && n.sleepMin < need - 30) push(cons, short);
  const out3 = { pros: pros.slice(0, 3), cons: cons.slice(0, 3) };
  // A strategy: what keeping it up every night would do.
  if (n.keptDebtWeek !== undefined && n.keptDebtWeek <= n.defDebtWeek - 30) out3.pros.push(`Every night like this: ${formatDuration(n.keptDebtWeek)} of debt in a week`);
  return out3;
}

function reasoning(
  ctx: Ctx,
  mode: PlanMode,
  r: {
    basePlan: TonightPlan;
    earliestFeasible?: number;
    onsetTonight?: number;
    adherence?: Adherence;
    recommended: PlanOption;
    defaultOption: PlanOption;
    options: PlanOption[];
    strained?: string;
    earlyEvent: boolean;
    importantEvent: boolean;
  },
): string[] {
  const { a } = ctx;
  const steps: string[] = [];
  const p = r.basePlan;
  steps.push(ctx.debtMin >= 30 ? `You have ${formatDuration(ctx.debtMin)} of sleep debt.` : 'No sleep debt to speak of.');
  if (r.onsetTonight !== undefined) {
    const from = r.earliestFeasible !== undefined && ctx.debtMin >= 30 ? ` — with that debt you can likely fall asleep from about ${formatTime(r.earliestFeasible)}` : '';
    steps.push(`You've been falling asleep around ${formatTime(r.onsetTonight)}${from}.`);
  }
  const day = DAY_NAMES[weekdayOfKey(ctx.wakeDate)];
  if (p.noAlarm) steps.push(`No alarm ${day} morning — it's a free day.`);
  else if (p.twoStep) steps.push(`Tomorrow starts at ${formatTime(p.wake)} with your routine at ${formatTime(p.twoStep.firstWake)}.`);
  else steps.push(`Tomorrow starts at ${formatTime(p.wake)}.`);
  if (p.calendar && (r.earlyEvent || r.importantEvent)) {
    const title = p.calendar.eventTitle ? ` (“${p.calendar.eventTitle}”)` : '';
    steps.push(`First event at ${formatTime(p.calendar.eventStart)}${title} — tomorrow's energy counts ${r.earlyEvent && r.importantEvent ? 'double' : 'extra'}.`);
  }
  const ad = r.adherence;
  if (ad) {
    const n = ad.recentNights;
    const nights = n === 1 ? 'Last night' : `Last ${n} nights`;
    if (ad.recentLateMin >= ADHERENCE.onTimeMin) steps.push(`${nights} you went to bed ~${ad.recentLateMin} min after the plan.`);
    else if (ad.recentLateMin <= -ADHERENCE.onTimeMin) steps.push(`${nights} you went to bed ~${-ad.recentLateMin} min before the plan.`);
    else steps.push(`${nights} you went to bed close to the plan.`);
  }
  const adv = a.advance;
  const held = p.gradual || a.upcoming.slice(1, 4).some((n) => n.heldBack);
  if (adv?.adapted && held) {
    const moved =
      adv.observedMinPerNight >= 1
        ? `moved ~${Math.round(adv.observedMinPerNight)} min earlier a night`
        : adv.observedMinPerNight <= -1
          ? `drifted ~${Math.round(-adv.observedMinPerNight)} min later a night`
          : 'barely moved';
    steps.push(`Your sleep onset has ${moved} this week, so coming nights step ${adv.rampMinPerNight} min earlier each, not ${BODY_CLOCK.rampMinPerNight}.`);
  }
  if (r.strained) {
    const over = ctx.routineDay ? 'sleep wins over the routine' : 'sleep wins over a strict early lights-out';
    steps.push(`${r.strained} → ${over}.`);
  }
  if (mode === 'still-up') steps.push(`It's ${formatTime(ctx.now)} and the planned ${formatTime(p.bedtime)} lights-out has passed.`);
  else if (mode === 'evening') steps.push(`It's ${formatTime(ctx.now)} — ${formatDuration(Math.max(1, (p.bedtime - ctx.now) / MINUTE))} to the planned lights-out.`);
  const rec = r.recommended;
  if (rec === r.defaultOption || (rec.inUse && rec.id === 'current')) {
    const runnerUp = r.options.filter((o) => o !== rec).sort((x, y) => y.utility - x.utility)[0];
    const gain = runnerUp && runnerUp.deltaSleepMin - rec.deltaSleepMin >= 5 ? `would add ${formatDuration(runnerUp.deltaSleepMin - rec.deltaSleepMin)} of sleep` : 'scores a little higher';
    const close = runnerUp && runnerUp.utility > rec.utility ? ` (“${runnerUp.title}” ${gain} — not enough to change it.)` : '';
    steps.push(`So: ${rec.decision}.${close}`);
  } else {
    steps.push(`So: ${rec.decision}.`);
  }
  return steps;
}

function nudgeFor(ctx: Ctx, ad: Adherence | undefined, p: TonightPlan, screensOffOn: boolean | undefined): PlanOptions['nudge'] {
  if (!ad) return undefined;
  const late = Math.max(ad.recentLateMin, ad.usualLateMin);
  if (late < ADHERENCE.lateMin) return undefined;
  const lead = Math.min(60, Math.round(late / 5) * 5);
  const start = p.windDownStart - lead * MINUTE;
  const reminder = screensOffOn === false;
  return {
    text: `Planning earlier won't help while bedtime keeps slipping ~${late} min — start wind-down at ${formatTime(start)} instead of ${formatTime(p.windDownStart)}${reminder ? ' and turn on the screens-off reminder' : ''}.`,
    ...(reminder ? { action: 'screens-off' as const } : {}),
  };
}
