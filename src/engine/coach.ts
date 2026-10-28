import type { EnergyForecast } from './alertness';
import type { CaffeineCutoff } from './caffeine';
import type { ChronotypeResult } from './chronotype';
import type { NapRecommendation } from './nap';
import type { RegularityResult } from './regularity';
import type { TonightPlan } from './schedule';
import type { Night } from './sessions';
import type { SleepDebtResult } from './sleepDebt';
import { mean, median } from './stats';
import { formatClock, formatDuration, formatTime, MINUTE } from './time';
import type { Profile } from './types';

export type PlanKind = 'wake' | 'light' | 'focus' | 'dip' | 'nap' | 'caffeine' | 'meal' | 'exercise' | 'winddown' | 'bed' | 'alarm';

export interface PlanItem {
  id: string;
  kind: PlanKind;
  time: number;
  end?: number;
  title: string;
  detail: string;
}

export interface Tip {
  id: string;
  title: string;
  detail: string;
  /** Higher shows first. */
  priority: number;
  icon: string;
}

export function buildDailyPlan(input: {
  wakeTime: number;
  energy: EnergyForecast;
  nap: NapRecommendation;
  caffeine: CaffeineCutoff;
  tonight: TonightPlan;
  alarm: { alarm: number; onBoundary: boolean };
}): PlanItem[] {
  const { wakeTime, energy, nap, caffeine, tonight } = input;
  const items: PlanItem[] = [
    { id: 'wake', kind: 'wake', time: wakeTime, title: 'Wake up', detail: 'Same time every day is the single best anchor for your body clock.' },
    {
      id: 'light',
      kind: 'light',
      time: wakeTime + 10 * MINUTE,
      end: wakeTime + 70 * MINUTE,
      title: 'Get bright light',
      detail: '10–30 minutes outdoors (even overcast) within an hour of waking advances your clock and boosts alertness.',
    },
  ];
  energy.focusWindows.forEach((w, i) =>
    items.push({
      id: `focus-${i}`,
      kind: 'focus',
      time: w.start,
      end: w.end,
      title: 'Peak focus window',
      detail: 'Your predicted energy is near its daily high — schedule demanding work here.',
    }),
  );
  if (energy.dip) {
    items.push({
      id: 'dip',
      kind: 'dip',
      time: energy.dip.start,
      end: energy.dip.end,
      title: 'Afternoon dip',
      detail: 'A natural circadian low. Good for routine tasks, a walk outside, or a short nap.',
    });
  }
  if ((nap.verdict === 'nap-now' || nap.verdict === 'nap-later' || nap.verdict === 'optional') && nap.best) {
    items.push({
      id: 'nap',
      kind: 'nap',
      time: nap.best.start,
      end: nap.best.start + nap.best.alarmAfterMin * MINUTE,
      title: `${nap.best.label} (${nap.best.alarmAfterMin} min)`,
      detail: nap.headline,
    });
  }
  if (caffeine.cutoff) {
    items.push({
      id: 'caffeine',
      kind: 'caffeine',
      time: caffeine.cutoff,
      title: 'Caffeine cut-off',
      detail: `A ${caffeine.doseMg} mg coffee after this leaves too much caffeine in your system at bedtime.`,
    });
  } else if (caffeine.overLimit) {
    items.push({
      id: 'caffeine',
      kind: 'caffeine',
      time: wakeTime,
      title: 'No more caffeine today',
      detail: `You already have ~${Math.round(caffeine.atBedtimeMg)} mg projected at bedtime.`,
    });
  }
  items.push(
    { id: 'exercise', kind: 'exercise', time: tonight.lastExercise, title: 'Finish hard exercise', detail: 'Vigorous workouts within ~2h of bed can delay sleep for some people.' },
    { id: 'meal', kind: 'meal', time: tonight.lastMeal, title: 'Last big meal', detail: 'Eating 3+ hours before bed lets your heart rate fall earlier in the night.' },
    {
      id: 'winddown',
      kind: 'winddown',
      time: tonight.windDownStart,
      end: tonight.bedtime,
      title: 'Start winding down',
      detail: 'Dim the lights, put screens away, keep the room cool (≈18–20 °C). Your melatonin is rising.',
    },
    { id: 'bed', kind: 'bed', time: tonight.bedtime, title: 'Lights out', detail: tonight.rationale.join(' ') },
    {
      id: 'alarm',
      kind: 'alarm',
      time: input.alarm.alarm,
      title: `Alarm${input.alarm.onBoundary ? ' (end of a sleep cycle)' : ''}`,
      detail: input.alarm.onBoundary
        ? `Timed to a predicted cycle boundary, before your ${formatTime(tonight.wake)} target, so you wake from light sleep.`
        : 'No cycle boundary fell inside your wake window, so the alarm stays at your target time.',
    },
  );
  return items.sort((a, b) => a.time - b.time);
}

export function buildTips(input: {
  nights: Night[];
  debt: SleepDebtResult;
  regularity: RegularityResult;
  chronotype: ChronotypeResult;
  caffeine: CaffeineCutoff;
  profile: Profile;
  tonight: TonightPlan;
  age: number;
}): Tip[] {
  const { debt, regularity, chronotype, profile, tonight } = input;
  const recent = input.nights.filter((n) => n.main).slice(-14).map((n) => n.main!);
  const tips: Tip[] = [];

  if (debt.category === 'high' || debt.category === 'severe' || debt.category === 'moderate') {
    tips.push({
      id: 'debt',
      icon: 'bed-clock',
      priority: debt.category === 'moderate' ? 70 : 95,
      title: `Pay back ${formatDuration(debt.debtMin)} of sleep debt`,
      detail: debt.payoff
        ? `Sleeping ~${debt.payoff.extraMinPerNight} min more than your need for ${debt.payoff.nights} night${debt.payoff.nights > 1 ? 's' : ''} clears it. Going to bed earlier works better than sleeping in, which shifts your body clock.`
        : 'Add 30–60 minutes of sleep per night until it clears.',
    });
  }
  if ((regularity.sri !== undefined && regularity.sri < 70) || (regularity.consistencyScore !== undefined && regularity.consistencyScore < 60)) {
    tips.push({
      id: 'regularity',
      icon: 'calendar-clock',
      priority: 85,
      title: 'Make your schedule more regular',
      detail: 'Irregular sleep timing is linked to worse mood, metabolism and grades/work performance — independent of duration. Start by fixing your wake time 7 days a week.',
    });
  }
  if ((chronotype.socialJetlagMin ?? 0) >= 60) {
    tips.push({
      id: 'sjl',
      icon: 'airplane-clock',
      priority: 75,
      title: 'Shrink weekend lie-ins',
      detail: `Your weekend sleep shifts ${formatDuration(chronotype.socialJetlagMin!)} later. Keep free-day wake-ups within an hour of workdays and nap early afternoon if needed.`,
    });
  }
  const lat = recent.map((m) => m.latencyMin).filter((x) => x >= 1);
  if (lat.length >= 5 && median(lat) > 30) {
    tips.push({
      id: 'latency',
      icon: 'timer-sand',
      priority: 80,
      title: 'Falling asleep takes a while',
      detail: `Median ${Math.round(median(lat))} min. Don't go to bed until sleepy; if awake >20 min, get up and do something calm in dim light, then return. Avoid caffeine after your cut-off.`,
    });
  }
  const eff = recent.map((m) => m.efficiency);
  if (eff.length >= 5 && mean(eff) < 0.85) {
    tips.push({
      id: 'efficiency',
      icon: 'bed-empty',
      priority: 72,
      title: 'Spend less time awake in bed',
      detail: 'Use the bed only for sleep (and sex) so your brain links it with sleeping. Insomnia mode in Settings applies these CBT-I rules to your plan.',
    });
  }
  if (input.caffeine.overLimit) {
    tips.push({
      id: 'caffeine',
      icon: 'coffee-off',
      priority: 78,
      title: 'Caffeine will still be active at bedtime',
      detail: `About ${Math.round(input.caffeine.atBedtimeMg)} mg projected in the first hours of sleep. Caffeine reduces deep sleep even when you fall asleep fine.`,
    });
  }
  const deep = recent.map((m) => m.stagePct?.deep).filter((x): x is number => x !== undefined);
  if (deep.length >= 5 && mean(deep) < (input.age < 30 ? 0.12 : 0.09)) {
    tips.push({
      id: 'deep',
      icon: 'waves',
      priority: 55,
      title: 'Boost deep sleep',
      detail: 'Regular daytime exercise (finish 2h+ before bed), a cool room, a consistent schedule and skipping evening alcohol all increase deep sleep. Note: wrist-based staging is approximate.',
    });
  }
  const rem = recent.map((m) => m.stagePct?.rem).filter((x): x is number => x !== undefined);
  if (rem.length >= 5 && mean(rem) < 0.16) {
    tips.push({
      id: 'rem',
      icon: 'brain',
      priority: 55,
      title: 'Protect REM sleep',
      detail: 'REM is concentrated in the final hours — cutting the morning short or drinking alcohol in the evening removes it first.',
    });
  }
  if (chronotype.category === 'late' || chronotype.category === 'moderately-late') {
    tips.push({
      id: 'owl',
      icon: 'owl',
      priority: 50,
      title: 'Night-owl strategy',
      detail: `Get outdoor light soon after ${formatClock(profile.workWakeMin)} and dim screens after ${formatTime(tonight.windDownStart)}. Morning light pulls a late clock earlier; evening light pushes it later.`,
    });
  }
  const isi = profile.screenings.isi?.score;
  if (isi !== undefined && isi >= 15) {
    tips.push({
      id: 'cbti',
      icon: 'account-heart',
      priority: 90,
      title: 'Consider CBT-I',
      detail: 'Your insomnia check suggests clinically significant insomnia. Cognitive behavioural therapy for insomnia beats sleeping pills long-term. Ask a doctor or try a certified CBT-I programme.',
    });
  }
  const ess = profile.screenings.ess?.score;
  const sb = profile.screenings.stopbang?.score;
  if ((ess !== undefined && ess >= 13) || (sb !== undefined && sb >= 5)) {
    tips.push({
      id: 'doctor',
      icon: 'stethoscope',
      priority: 100,
      title: 'Talk to a doctor about your sleep',
      detail: 'Your screening answers suggest excessive sleepiness or a raised risk of sleep apnoea. Both are treatable — a sleep study gives a definitive answer.',
    });
  }
  tips.push(
    {
      id: 'environment',
      icon: 'thermometer',
      priority: 20,
      title: 'Cool, dark, quiet',
      detail: 'Aim for ~18–20 °C (65–68 °F), blackout curtains or a mask, and earplugs or white noise if needed.',
    },
    {
      id: 'wind-down',
      icon: 'weather-night',
      priority: 15,
      title: 'Build a wind-down ritual',
      detail: `Start at ${formatTime(tonight.windDownStart)}: dim lights, warm shower, paper book, breathing exercises. The same cues every night speed up sleep onset.`,
    },
  );
  return tips.sort((a, b) => b.priority - a.priority);
}

