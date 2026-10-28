import type { Night } from './sessions';
import { mean } from './stats';
import { circularMeanMinutes, circularSdMinutes, minutesOfDay, normalizeMinutes, weekdayOfKey } from './time';
import type { DayLog, Profile } from './types';

export type ChronotypeCategory = 'early' | 'moderately-early' | 'intermediate' | 'moderately-late' | 'late';

export const CHRONOTYPE_LABELS: Record<ChronotypeCategory, { label: string; description: string }> = {
  early: {
    label: 'Early bird',
    description: 'Your body clock runs early: you are sharpest in the morning and get sleepy early in the evening.',
  },
  'moderately-early': {
    label: 'Moderately early',
    description: 'You lean toward mornings, with an energy peak before mid-day and a fairly early wind-down.',
  },
  intermediate: {
    label: 'Intermediate',
    description: 'Your body clock is in the middle of the population — flexible in both directions.',
  },
  'moderately-late': {
    label: 'Moderately late',
    description: 'You lean toward evenings: mornings feel slow and your best focus arrives later in the day.',
  },
  late: {
    label: 'Night owl',
    description: 'Your body clock runs late. Early alarms cut into your biological night, so consistency and morning light matter most.',
  },
};

export interface HabitualTiming {
  onsetMin: number;
  wakeMin: number;
  midSleepMin: number;
  onsetSdMin?: number;
  wakeSdMin?: number;
  midSleepSdMin?: number;
  /** Mean sleep period (onset → final wake) in minutes. */
  periodMin: number;
  n: number;
}

export interface ChronotypeResult {
  category?: ChronotypeCategory;
  source: 'data' | 'quiz' | 'none';
  /** Mid-sleep on free days, corrected for oversleep (MCTQ MSFsc), minutes after midnight. */
  msfScMin?: number;
  msfMin?: number;
  mswMin?: number;
  socialJetlagMin?: number;
  nWork: number;
  nFree: number;
  habitual?: HabitualTiming;
  habitualWork?: HabitualTiming;
  habitualFree?: HabitualTiming;
  /** Estimated dim-light melatonin onset (≈2h before habitual sleep onset). */
  dlmoMin?: number;
  /** Estimated core-body-temperature minimum (≈2h before habitual wake). */
  cbtMinMin?: number;
  /** Evening "forbidden zone" where falling asleep is hardest. */
  wakeMaintenanceZone?: { startMin: number; endMin: number };
  quizScore?: number;
  quizCategory?: ChronotypeCategory;
}

/** Signed hours after midnight for a mid-sleep clock time, mapping evening times to negatives. */
function midSleepHours(min: number): number {
  const h = normalizeMinutes(min) / 60;
  return h >= 18 ? h - 24 : h;
}

export function categoryFromMsfSc(msfScMin: number): ChronotypeCategory {
  const h = midSleepHours(msfScMin);
  if (h < 2.5) return 'early';
  if (h < 3.5) return 'moderately-early';
  if (h < 5) return 'intermediate';
  if (h < 6) return 'moderately-late';
  return 'late';
}

/** Reduced Morningness–Eveningness Questionnaire (rMEQ, 4–25) bands. */
export function categoryFromRmeq(score: number): ChronotypeCategory {
  if (score >= 22) return 'early';
  if (score >= 18) return 'moderately-early';
  if (score >= 12) return 'intermediate';
  if (score >= 8) return 'moderately-late';
  return 'late';
}

export function habitualTiming(nights: Night[]): HabitualTiming | undefined {
  const mains = nights.map((n) => n.main).filter((m): m is NonNullable<typeof m> => !!m);
  if (mains.length === 0) return undefined;
  const onsets = mains.map((m) => minutesOfDay(m.sleepOnset));
  const wakes = mains.map((m) => minutesOfDay(m.finalWake));
  const mids = mains.map((m) => minutesOfDay(m.midSleep));
  return {
    onsetMin: circularMeanMinutes(onsets)!,
    wakeMin: circularMeanMinutes(wakes)!,
    midSleepMin: circularMeanMinutes(mids)!,
    onsetSdMin: circularSdMinutes(onsets),
    wakeSdMin: circularSdMinutes(wakes),
    midSleepSdMin: circularSdMinutes(mids),
    periodMin: mean(mains.map((m) => (m.finalWake - m.sleepOnset) / 60_000)),
    n: mains.length,
  };
}

function isFreeNight(n: Night, profile: Profile, dayLogs: Record<string, DayLog>): boolean {
  const natural = dayLogs[n.wakeDate]?.wokeNaturally;
  if (natural !== undefined) return natural;
  return !profile.workdays.includes(weekdayOfKey(n.wakeDate));
}

export function analyzeChronotype(input: {
  nights: Night[];
  profile: Profile;
  dayLogs: Record<string, DayLog>;
}): ChronotypeResult {
  const { nights, profile, dayLogs } = input;
  const recent = nights.filter((n) => n.main).slice(-42);
  const work = recent.filter((n) => !isFreeNight(n, profile, dayLogs));
  const free = recent.filter((n) => isFreeNight(n, profile, dayLogs));
  const habitual = habitualTiming(recent.slice(-28));
  const habitualWork = habitualTiming(work);
  const habitualFree = habitualTiming(free);

  const quizScore = profile.screenings.rmeq?.score;
  const quizCategory = quizScore !== undefined ? categoryFromRmeq(quizScore) : undefined;

  const result: ChronotypeResult = {
    source: 'none',
    nWork: work.length,
    nFree: free.length,
    habitual,
    habitualWork,
    habitualFree,
    quizScore,
    quizCategory,
  };

  if (habitualWork && habitualFree && work.length >= 3 && free.length >= 2) {
    const msf = habitualFree.midSleepMin;
    const msw = habitualWork.midSleepMin;
    const sdW = habitualWork.periodMin;
    const sdF = habitualFree.periodMin;
    const workdays = Math.max(0, Math.min(7, profile.workdays.length));
    const sdWeek = (workdays * sdW + (7 - workdays) * sdF) / 7;
    const msfSc = sdF > sdW ? normalizeMinutes(msf - (sdF - sdWeek) / 2) : msf;
    result.msfMin = msf;
    result.mswMin = msw;
    result.msfScMin = msfSc;
    result.socialJetlagMin = Math.abs(midSleepHours(msf) - midSleepHours(msw)) * 60;
    result.category = categoryFromMsfSc(msfSc);
    result.source = 'data';
  } else if (habitual && habitual.n >= 7) {
    result.msfScMin = habitual.midSleepMin;
    result.category = categoryFromMsfSc(habitual.midSleepMin);
    result.source = 'data';
  } else if (quizCategory) {
    result.category = quizCategory;
    result.source = 'quiz';
  }

  if (habitual) {
    result.dlmoMin = normalizeMinutes(habitual.onsetMin - 120);
    result.cbtMinMin = normalizeMinutes(habitual.wakeMin - 120);
    result.wakeMaintenanceZone = {
      startMin: normalizeMinutes(habitual.onsetMin - 180),
      endMin: normalizeMinutes(habitual.onsetMin - 60),
    };
  }
  return result;
}
