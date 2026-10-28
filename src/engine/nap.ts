import { bedtimeDelayMin, EnergyForecast, Interval, simulateAlertness } from './alertness';
import { mean } from './stats';
import { clamp, formatDuration, formatTime, HOUR, MINUTE } from './time';

export type NapType = 'power' | 'coffee' | 'recovery' | 'prophylactic';
export type UpcomingDemand = 'night-shift' | 'long-drive' | 'late-night';

export interface NapOption {
  type: NapType;
  label: string;
  /** Intended minutes asleep. */
  sleepMin: number;
  /** Alarm length from lying down (includes time to fall asleep). */
  alarmAfterMin: number;
  start: number;
  description: string;
  bedtimeDelayMin: number;
  /** Mean energy gain (0–100 scale) over the 3h after the nap, vs. not napping. */
  energyGain: number;
  suitable: boolean;
  why?: string;
}

export interface NapRecommendation {
  verdict: 'nap-now' | 'nap-later' | 'optional' | 'skip';
  headline: string;
  needScore: number;
  best?: NapOption;
  options: NapOption[];
  window?: Interval;
  /** Latest time a short nap should end without hurting tonight's sleep. */
  latestEnd: number;
  reasons: string[];
  cautions: string[];
}

export interface NapInput {
  now: number;
  wakeTime: number;
  bedtime: number;
  nextWake: number;
  sleeps: Interval[];
  midSleepMin: number;
  needMin: number;
  debtMin: number;
  lastNightSleepMin?: number;
  napsTodayMin: number;
  latencyMin: number;
  cycleMin: number;
  caffeineCutoff?: number;
  insomniaMode: boolean;
  /** Most recent Karolinska sleepiness rating within the last 3 hours. */
  sleepiness?: number;
  upcoming?: UpcomingDemand;
  forecast: EnergyForecast;
}

function avgEnergy(sleeps: Interval[], from: number, to: number, input: NapInput): number {
  const pts = simulateAlertness(sleeps, from, to, { midSleepMin: input.midSleepMin, debtMin: input.debtMin, stepMin: 10 });
  return mean(pts.filter((p) => !p.asleep).map((p) => p.energy));
}

export function recommendNap(input: NapInput): NapRecommendation {
  const { now, wakeTime, bedtime, forecast } = input;
  const reasons: string[] = [];
  const cautions: string[] = [];

  // ---- How much does this person need a nap? ----
  let score = 0;
  const debtH = input.debtMin / 60;
  if (debtH >= 1) {
    score += Math.min(40, debtH * 6);
    reasons.push(`You're carrying ${formatDuration(input.debtMin)} of sleep debt.`);
  }
  if (input.lastNightSleepMin !== undefined) {
    const deficit = input.needMin - input.lastNightSleepMin;
    if (deficit > 20) {
      score += Math.min(25, (deficit / 60) * 12);
      reasons.push(`Last night you slept ${formatDuration(deficit)} less than you need.`);
    }
  }
  const nowEnergy = forecast.now?.energy;
  if (nowEnergy !== undefined && now < bedtime) {
    if (nowEnergy < 35) {
      score += 20;
      reasons.push(`Your predicted energy right now is low (${Math.round(nowEnergy)}/100).`);
    } else if (nowEnergy < 50) {
      score += 10;
    }
  }
  if (forecast.dip && forecast.dip.t > now && forecast.dip.energy < 45) {
    score += 10;
    reasons.push(`Energy is forecast to dip to ${Math.round(forecast.dip.energy)} around ${formatTime(forecast.dip.t)}.`);
  }
  if (input.sleepiness !== undefined && input.sleepiness >= 6) {
    // How you feel is the most direct signal there is.
    score += ({ 6: 15, 7: 30, 8: 38, 9: 45 } as Record<number, number>)[Math.min(9, Math.round(input.sleepiness))];
    reasons.push(`You rated yourself ${input.sleepiness >= 7 ? 'sleepy' : 'somewhat sleepy'} (KSS ${input.sleepiness}).`);
  }
  if (now - wakeTime > 16 * HOUR) score += 10;
  if (input.upcoming) {
    score += 25;
    const what = { 'night-shift': 'a night shift', 'long-drive': 'a long drive', 'late-night': 'a late night' }[input.upcoming];
    reasons.push(`You have ${what} coming up — a nap beforehand is protective.`);
  }
  if (input.napsTodayMin >= 20) {
    score -= 25;
    reasons.push(`You already napped ${formatDuration(input.napsTodayMin)} today.`);
  }
  const needScore = Math.round(clamp(score, 0, 100));

  // ---- When? ----
  const napLatency = clamp(Math.round(input.latencyMin / 2), 5, 10);
  const earliest = wakeTime + 4 * HOUR;
  const latestEnd = input.upcoming === 'night-shift' ? bedtime : bedtime - 5 * HOUR;
  const recoveryLatestEnd = bedtime - 7 * HOUR;
  let window: Interval | undefined;
  const base = forecast.dip ? { start: forecast.dip.start, end: forecast.dip.end } : { start: wakeTime + 6.5 * HOUR, end: wakeTime + 8.5 * HOUR };
  const wStart = Math.max(base.start, earliest);
  const wEnd = Math.min(base.end, latestEnd - (15 + napLatency) * MINUTE);
  if (wEnd > wStart) window = { start: wStart, end: wEnd };
  const inWindow = !!window && now >= window.start && now <= window.end;
  const napStart = window && now < window.start ? window.start : now;

  // ---- What kind? ----
  // A rested reference schedule: sleep need met every night, waking at today's time.
  const reference: Interval[] = [];
  for (let d = 0; d <= 4; d++) {
    const w = wakeTime - d * 24 * HOUR;
    reference.push({ start: w - input.needMin * MINUTE, end: w });
  }
  const baseline = (end: number) => avgEnergy(input.sleeps, end + 30 * MINUTE, end + 3 * HOUR, input);
  const makeOption = (type: NapType, sleepMin: number, label: string, description: string): NapOption => {
    const sleepStart = napStart + napLatency * MINUTE;
    const nap: Interval = { start: sleepStart, end: sleepStart + sleepMin * MINUTE };
    const alarmAfterMin = sleepMin + napLatency;
    const withNap = avgEnergy([...input.sleeps, nap], nap.end + 30 * MINUTE, nap.end + 3 * HOUR, input);
    const caffeineBoost = type === 'coffee' ? 6 : 0;
    return {
      type,
      label,
      sleepMin,
      alarmAfterMin,
      start: napStart,
      description,
      bedtimeDelayMin: Math.round(bedtimeDelayMin(input.sleeps, nap, bedtime, reference)),
      energyGain: Math.round(withNap - baseline(nap.end) + caffeineBoost),
      suitable: true,
    };
  };

  const power = makeOption(
    'power',
    15,
    'Power nap',
    'Lie down and set an alarm; aim for 10–20 minutes of light sleep. You wake before deep sleep, so there is little grogginess.',
  );
  const coffee = makeOption(
    'coffee',
    15,
    'Coffee nap',
    'Drink a coffee (≈100 mg caffeine) right before lying down. Caffeine kicks in as the alarm goes off, stacking both boosts.',
  );
  const recovery = makeOption(
    'recovery',
    input.cycleMin,
    'Full-cycle recovery nap',
    `One complete ${input.cycleMin}-minute sleep cycle, including deep and REM sleep. Pays back debt and you wake from light sleep.`,
  );
  const options: NapOption[] = [power, coffee, recovery];
  if (input.upcoming) {
    options.push(
      makeOption(
        'prophylactic',
        input.upcoming === 'night-shift' ? input.cycleMin * 2 : input.cycleMin,
        'Pre-emptive nap',
        'A longer nap before a long night protects alertness for many hours. Allow 20–30 minutes to shake off grogginess.',
      ),
    );
  }

  for (const o of options) {
    const end = o.start + o.alarmAfterMin * MINUTE;
    const limit = o.type === 'recovery' ? recoveryLatestEnd : o.type === 'prophylactic' ? bedtime : latestEnd;
    if (end > limit) {
      o.suitable = false;
      o.why = `Would end after ${formatTime(limit)}, too close to bedtime.`;
    } else if (o.type !== 'prophylactic' && o.bedtimeDelayMin > (o.type === 'recovery' ? 75 : 40)) {
      o.suitable = false;
      o.why = `Likely to push your sleepiness back ~${o.bedtimeDelayMin} min tonight.`;
    } else if (o.start < earliest && !input.upcoming) {
      o.suitable = false;
      o.why = `Too soon after waking — wait until ${formatTime(earliest)}.`;
    }
  }
  if (input.caffeineCutoff === undefined || napStart > input.caffeineCutoff) {
    coffee.suitable = false;
    coffee.why = 'Past your caffeine cut-off for tonight.';
  }
  if (input.insomniaMode) {
    coffee.suitable = false;
    coffee.why = coffee.why ?? 'Not recommended while working on insomnia.';
  }
  const bigDeficit = input.debtMin >= 180 || (input.lastNightSleepMin !== undefined && input.needMin - input.lastNightSleepMin >= 90);
  if (recovery.suitable && !bigDeficit) {
    recovery.suitable = false;
    recovery.why = 'Only worth it when you are carrying 3h+ of debt or had a very short night.';
  }

  const suitable = options.filter((o) => o.suitable);
  const prophylactic = options.find((o) => o.type === 'prophylactic');
  let best: NapOption | undefined;
  if (prophylactic?.suitable) best = prophylactic;
  else if (recovery.suitable && needScore >= 70) best = recovery;
  else best = suitable.find((o) => o.type === 'power') ?? suitable[0];

  // ---- Verdict ----
  let verdict: NapRecommendation['verdict'];
  if (input.insomniaMode && !input.upcoming && (input.sleepiness ?? 0) < 8) {
    verdict = 'skip';
    cautions.push('Insomnia mode: skipping naps builds sleep pressure so you fall asleep faster tonight.');
  } else if (!best) {
    verdict = 'skip';
  } else if (needScore >= 55 || input.upcoming) {
    verdict = inWindow || now >= (window?.end ?? 0) ? 'nap-now' : window ? 'nap-later' : 'nap-now';
  } else if (needScore >= 35) {
    verdict = 'optional';
  } else {
    verdict = 'skip';
  }
  if (input.napsTodayMin >= 20 && verdict !== 'skip' && !input.upcoming) verdict = 'optional';

  let headline: string;
  switch (verdict) {
    case 'nap-now':
      headline = `Yes — take a ${best!.label.toLowerCase()} now (${best!.alarmAfterMin}-min alarm).`;
      break;
    case 'nap-later':
      headline = `Yes — plan a ${best!.label.toLowerCase()} around ${formatTime(window!.start)}.`;
      break;
    case 'optional':
      headline = best ? `Optional — a ${best.alarmAfterMin}-min power nap would help, but you can skip it.` : 'Optional.';
      break;
    default:
      if (input.insomniaMode) headline = "Skip the nap today and protect tonight's sleep.";
      else if (now > latestEnd && now < bedtime && needScore >= 35) headline = 'Too late to nap today — an earlier bedtime is the better fix.';
      else if (needScore >= 35) headline = 'Hold off — no nap fits well right now.';
      else if (input.debtMin >= 60) headline = 'No nap needed right now.';
      else headline = 'No nap needed — you are well rested.';
  }

  cautions.push('Avoid naps of 30–60 minutes: waking from deep sleep leaves you groggier than before.');
  if (verdict !== 'skip') cautions.push(`Finish napping by ${formatTime(latestEnd)} so it does not delay tonight's sleep.`);
  if (input.upcoming === 'long-drive') cautions.push('If you get drowsy while driving, pull over: a 15-minute nap plus coffee is the evidence-based fix.');

  return { verdict, headline, needScore, best, options, window, latestEnd, reasons, cautions };
}
