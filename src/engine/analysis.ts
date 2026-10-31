import { CircadianParams, EnergyForecast, forecastEnergy, Interval, sleepPressureAt } from './alertness';
import { assessBreathing, breathingSummaryFor, breathingTrend, BreathingTrend } from './breathing';
import { caffeineAt, caffeineCutoff, CaffeineCutoff } from './caffeine';
import { CbtiProgram, currentCbtiWindow } from './cbti';
import { analyzeChronotype, ChronotypeResult } from './chronotype';
import { buildDailyPlan, buildTips, PlanItem, Tip } from './coach';
import { generateInsights, Insight, NightRow } from './insights';
import { NapRecommendation, recommendNap, UpcomingDemand } from './nap';
import { buildNightStory, NightStory } from './nightStory';
import { analyzeRegularity, RegularityResult } from './regularity';
import { applyTonightOverride, planTonight, smartAlarm, TonightOverride, TonightPlan, wakeTargetFor } from './schedule';
import {
  analyzeSessions,
  buildNights,
  Night,
  personalCycleMin,
  personalEfficiency,
  personalLatencyMin,
  SessionMetrics,
} from './sessions';
import { computeSleepDebt, debtOnDate, SleepDebtResult } from './sleepDebt';
import { ageFromBirthYear, estimateSleepNeed, SleepNeedEstimate } from './sleepNeed';
import { scoreSleep, SleepScore } from './sleepScore';
import { addDays, atMinutes, dateKey, HOUR, MINUTE, minutesOfDay, normalizeMinutes } from './time';
import { isSleepStage, SleepDataset } from './types';
import { detectRecoveryAlert, RecoveryAlert } from './recovery';
import { computeReadiness, Readiness } from './vitals';

export interface Analysis {
  now: number;
  /** Calendar day the user is "living" (before 4am counts as the previous day). */
  day: string;
  age: number;
  metrics: SessionMetrics[];
  nights: Night[];
  /** The most recent night that has a main sleep. */
  lastNight?: Night;
  /** Whether `lastNight` is the night that ended this morning. */
  lastNightIsCurrent: boolean;
  scores: Record<string, SleepScore>;
  need: SleepNeedEstimate;
  debt: SleepDebtResult;
  chronotype: ChronotypeResult;
  regularity: RegularityResult;
  latencyMin: number;
  cycleMin: number;
  efficiency: number;
  habitualMidSleepMin: number;
  wakeTime: number;
  tonight: TonightPlan;
  alarm: ReturnType<typeof smartAlarm>;
  energy: EnergyForecast;
  caffeine: { nowMg: number; cutoff: CaffeineCutoff };
  nap: NapRecommendation;
  readiness?: Readiness;
  insights: Insight[];
  plan: PlanItem[];
  tips: Tip[];
  /** Homeostatic sleep pressure (0–1, two-process model) now and at tonight's planned bedtime. */
  sleepPressure: { now: number; atBedtime: number };
  recoveryAlert?: RecoveryAlert;
  /** Every asleep interval used by the models (recent days, plus an assumed night if last night is missing). */
  sleeps: Interval[];
  /** The personal circadian adjustment in effect (learned from check-ins), if any. */
  circadian?: CircadianParams;
  /** Plain-English story of `lastNight` (nightStory.ts). */
  lastNightStory?: NightStory;
  /** 30-night breathing check from overnight SpO₂ (breathing.ts). */
  breathing?: BreathingTrend;
}

export const ANALYSIS_WINDOW_DAYS = 120;

export interface AnalyzeOptions {
  preferredOrigins?: string[];
  upcoming?: UpcomingDemand;
  /** Learned personal circadian parameters (calibration.ts). */
  circadian?: CircadianParams;
  /** Start of tomorrow's first calendar event (epoch ms). */
  firstEventTomorrow?: number;
  /** Title of that event, for the plan's rationale. */
  firstEventTitle?: string;
  /** Minutes the user needs between waking and the first event (calendar settings). */
  firstEventPrepMin?: number;
  /** Active CBT-I programme, which prescribes the sleep window. */
  cbti?: CbtiProgram;
  /** The user's own bedtime / wake-up for tonight ("Adjust tonight"). */
  tonightOverride?: TonightOverride;
}

function sleepIntervals(metrics: SessionMetrics[], since: number): Interval[] {
  const out: Interval[] = [];
  for (const m of metrics) {
    if (m.end < since) continue;
    for (const s of m.segments) if (isSleepStage(s.stage)) out.push({ start: s.start, end: s.end });
  }
  return out;
}

export function analyze(data: SleepDataset, now: number, opts: AnalyzeOptions = {}): Analysis {
  const { profile, dayLogs } = data;
  const day = minutesOfDay(now) < 240 ? addDays(dateKey(now), -1) : dateKey(now);
  const age = ageFromBirthYear(profile.birthYear, day);

  // 120 days covers every model (insights use 90) and keeps the engine fast on-device.
  const metrics = analyzeSessions(
    data.sessions.filter((s) => s.start < now && s.end > now - ANALYSIS_WINDOW_DAYS * 24 * HOUR),
    { preferredOrigins: opts.preferredOrigins },
  );
  const nights = buildNights(metrics).filter((n) => n.wakeDate <= dateKey(now));
  const need = estimateSleepNeed({ nights, dayLogs, profile, asOfDate: day });
  const debt = computeSleepDebt(nights, need.needMin, day);
  const chronotype = analyzeChronotype({ nights, profile, dayLogs });
  const latencyMin = personalLatencyMin(nights);
  const cycleMin = personalCycleMin(nights);
  const efficiency = personalEfficiency(nights);
  const defaultWake = wakeTargetFor(profile, day).wakeMin;
  const habitualMidSleepMin =
    chronotype.habitual?.midSleepMin ?? normalizeMinutes(defaultWake - need.needMin / 2);

  const scores: Record<string, SleepScore> = {};
  for (const n of nights) {
    if (n.main) scores[n.main.id] = scoreSleep(n.main, { needMin: need.needMin, age, habitualMidSleepMin });
  }
  const regularity = analyzeRegularity(metrics, nights, day, chronotype.habitual?.midSleepSdMin);

  const planned = planTonight({
    profile,
    today: day,
    needMin: need.needMin,
    debtMin: debt.debtMin,
    payoffExtraMin: debt.payoff?.extraMinPerNight,
    efficiency,
    latencyMin,
    habitualOnsetMin: chronotype.habitual?.onsetMin,
    firstEventStart: opts.firstEventTomorrow,
    firstEventTitle: opts.firstEventTitle,
    firstEventPrepMin: opts.firstEventPrepMin,
    sleepWindow: currentCbtiWindow(opts.cbti, nights, day),
  });
  // Everything below (alarm, caffeine cut-off, forecast, nap advice) follows an adjusted night.
  const tonight = applyTonightOverride(planned, opts.tonightOverride, profile.windDownMin);
  const alarm = smartAlarm(tonight.bedtime, tonight.wake, cycleMin, latencyMin);

  // Today's wake-up. If last night hasn't synced yet, assume a habitual night so the model stays sane.
  const currentNight = nights.find((n) => n.wakeDate === day && n.main);
  const sleeps = sleepIntervals(metrics, now - 5 * 24 * HOUR);
  let wakeTime: number;
  let assumedLastNight = false;
  if (currentNight?.main) {
    wakeTime = currentNight.main.finalWake;
  } else {
    wakeTime = atMinutes(day, chronotype.habitual?.wakeMin ?? defaultWake);
    if (wakeTime > now) wakeTime = Math.min(now, wakeTime);
    sleeps.push({ start: wakeTime - need.needMin * MINUTE, end: wakeTime });
    assumedLastNight = true;
  }
  const energy = forecastEnergy({
    sleeps,
    now,
    wakeTime,
    bedtime: tonight.bedtime,
    nextWake: tonight.wake,
    midSleepMin: habitualMidSleepMin,
    debtMin: debt.debtMin,
    assumedLastNight,
    circadian: opts.circadian,
  });

  const doses = data.caffeine.filter((d) => d.time > now - 36 * HOUR && d.time <= now);
  const cutoff = caffeineCutoff(doses, tonight.bedtime, profile.caffeineHalfLifeH, profile.caffeineBedtimeLimitMg);
  const caffeine = { nowMg: caffeineAt(doses, now, profile.caffeineHalfLifeH), cutoff };

  // Most recent sleepiness rating from the last 3 hours: a check-in/ping or the journal.
  const log = dayLogs[day];
  const ratings = [
    ...(data.checkins ?? []).map((c) => ({ time: c.time, kss: c.kss })),
    ...(log?.sleepiness !== undefined && log.sleepinessAt !== undefined ? [{ time: log.sleepinessAt, kss: log.sleepiness }] : []),
  ].filter((r) => r.time <= now && now - r.time < 3 * HOUR);
  const recentSleepiness = ratings.length ? ratings.reduce((a, b) => (b.time > a.time ? b : a)).kss : undefined;
  const napsTodayMin = (nights.find((n) => n.wakeDate === day)?.naps ?? [])
    .filter((m) => m.end <= now)
    .reduce((s, m) => s + m.totalSleepMin, 0);
  const nap = recommendNap({
    now,
    wakeTime,
    bedtime: tonight.bedtime,
    nextWake: tonight.wake,
    sleeps,
    midSleepMin: habitualMidSleepMin,
    needMin: need.needMin,
    debtMin: debt.debtMin,
    lastNightSleepMin: currentNight?.main?.totalSleepMin,
    napsTodayMin,
    latencyMin,
    cycleMin,
    caffeineCutoff: cutoff.cutoff,
    insomniaMode: profile.insomniaMode,
    sleepiness: recentSleepiness,
    upcoming: opts.upcoming,
    forecast: energy,
    circadian: opts.circadian,
  });

  const lastNight = [...nights].reverse().find((n) => n.main);
  const readiness = computeReadiness({
    nights,
    vitals: data.vitals,
    daily: data.daily,
    asOfDate: day,
    lastSleepScore: currentNight?.main ? scores[currentNight.main.id]?.total : undefined,
    debtMin: debt.debtMin,
    regularityScore: regularity.consistencyScore,
  });

  const breathing = breathingTrend({ nights, vitals: data.vitals, asOfDate: day });
  const rows: NightRow[] = nights
    .filter((n) => n.main)
    .slice(-90)
    .map((n) => ({ night: n, score: scores[n.main!.id]?.total, vitals: data.vitals[n.main!.id] }));
  const insights = generateInsights({
    rows,
    nights,
    dayLogs,
    daily: data.daily,
    caffeine: data.caffeine,
    profile,
    chronotype,
    needMin: need.needMin,
    workouts: data.workouts ?? [],
    breathing,
  });
  const lastNightStory = lastNight?.main
    ? buildNightStory({
        night: lastNight.main,
        nights,
        vitals: data.vitals,
        dayLogs,
        caffeine: data.caffeine,
        profile,
        workouts: data.workouts,
        insights,
        scores,
      })
    : undefined;

  const plan = buildDailyPlan({ wakeTime, energy, nap, caffeine: cutoff, tonight, alarm });
  const tips = buildTips({ nights, debt, regularity, chronotype, caffeine: cutoff, profile, tonight, age });

  return {
    now,
    day,
    age,
    metrics,
    nights,
    lastNight,
    lastNightIsCurrent: !!currentNight,
    scores,
    need,
    debt,
    chronotype,
    regularity,
    latencyMin,
    cycleMin,
    efficiency,
    habitualMidSleepMin,
    wakeTime,
    tonight,
    alarm,
    energy,
    caffeine,
    nap,
    readiness,
    insights,
    plan,
    tips,
    sleepPressure: { now: sleepPressureAt(sleeps, now), atBedtime: sleepPressureAt(sleeps, tonight.bedtime) },
    recoveryAlert: detectRecoveryAlert({ nights, vitals: data.vitals, daily: data.daily, asOfDate: day }),
    sleeps,
    circadian: opts.circadian,
    lastNightStory,
    breathing,
  };
}

export interface TrendRow {
  date: string;
  sleepMin?: number;
  napMin: number;
  score?: number;
  debtMin: number;
  onsetMin?: number;
  wakeMin?: number;
  deepPct?: number;
  remPct?: number;
  hrv?: number;
  hrMin?: number;
  /** Breathing check: SpO₂ dips of ≥ 3% per hour (only nights dense enough to count them). */
  spo2Dips?: number;
}

/** Per-day series for the Trends screen (debt is recomputed as of each morning). */
export function trendRows(a: Analysis, data: SleepDataset, days: number): TrendRow[] {
  const byDate = new Map(a.nights.map((n) => [n.wakeDate, n]));
  const rows: TrendRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(a.day, -i);
    const n = byDate.get(date);
    const m = n?.main;
    const v = m ? data.vitals[m.id] : undefined;
    const b = m ? assessBreathing(breathingSummaryFor(data.vitals, m.id)) : undefined;
    rows.push({
      date,
      sleepMin: m ? n!.totalSleepMin : undefined,
      napMin: n ? n.naps.reduce((s, x) => s + x.totalSleepMin, 0) : 0,
      score: m ? a.scores[m.id]?.total : undefined,
      debtMin: debtOnDate(a.nights, a.need.needMin, date),
      onsetMin: m ? minutesOfDay(m.sleepOnset) : undefined,
      wakeMin: m ? minutesOfDay(m.finalWake) : undefined,
      deepPct: m?.stagePct?.deep,
      remPct: m?.stagePct?.rem,
      hrv: v?.hrvRmssd ?? data.daily[date]?.hrv,
      hrMin: v?.hrMin,
      spo2Dips: b && (b.confidence === 'medium' || b.confidence === 'high') ? b.odi3 : undefined,
    });
  }
  return rows;
}
