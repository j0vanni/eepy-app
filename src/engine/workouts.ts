/**
 * Workouts recorded by the watch (Health Connect ExerciseSession): labels, and how close each
 * night's last workout ended to falling asleep. Nothing X may not write exercise sessions at all,
 * so everything here degrades to "no workouts".
 */
import { HOUR, MINUTE } from './time';
import type { Workout } from './types';

/**
 * Health Connect `ExerciseSessionRecord.EXERCISE_TYPE_*` codes, as exported by
 * react-native-health-connect's `ExerciseType` constant (45 is unused there).
 */
export const EXERCISE_TYPE_LABELS: Record<number, string> = {
  0: 'Workout',
  1: 'Back extensions',
  2: 'Badminton',
  3: 'Shoulder press',
  4: 'Baseball',
  5: 'Basketball',
  6: 'Bench press',
  7: 'Sit-ups',
  8: 'Cycling',
  9: 'Indoor cycling',
  10: 'Boot camp',
  11: 'Boxing',
  12: 'Burpees',
  13: 'Calisthenics',
  14: 'Cricket',
  15: 'Crunches',
  16: 'Dancing',
  17: 'Deadlifts',
  18: 'Dumbbell curls',
  19: 'Dumbbell curls',
  20: 'Front raises',
  21: 'Lateral raises',
  22: 'Triceps extensions',
  23: 'Triceps extensions',
  24: 'Triceps extensions',
  25: 'Elliptical',
  26: 'Exercise class',
  27: 'Fencing',
  28: 'American football',
  29: 'Australian football',
  30: 'Forward twists',
  31: 'Frisbee',
  32: 'Golf',
  33: 'Guided breathing',
  34: 'Gymnastics',
  35: 'Handball',
  36: 'HIIT',
  37: 'Hiking',
  38: 'Ice hockey',
  39: 'Ice skating',
  40: 'Jumping jacks',
  41: 'Jump rope',
  42: 'Lat pull-downs',
  43: 'Lunges',
  44: 'Martial arts',
  46: 'Paddling',
  47: 'Paragliding',
  48: 'Pilates',
  49: 'Plank',
  50: 'Racquetball',
  51: 'Rock climbing',
  52: 'Roller hockey',
  53: 'Rowing',
  54: 'Rowing machine',
  55: 'Rugby',
  56: 'Running',
  57: 'Treadmill run',
  58: 'Sailing',
  59: 'Scuba diving',
  60: 'Skating',
  61: 'Skiing',
  62: 'Snowboarding',
  63: 'Snowshoeing',
  64: 'Football',
  65: 'Softball',
  66: 'Squash',
  67: 'Squats',
  68: 'Stair climbing',
  69: 'Stair machine',
  70: 'Strength training',
  71: 'Stretching',
  72: 'Surfing',
  73: 'Open-water swim',
  74: 'Pool swim',
  75: 'Table tennis',
  76: 'Tennis',
  77: 'Upper-body twists',
  78: 'Volleyball',
  79: 'Walking',
  80: 'Water polo',
  81: 'Weightlifting',
  82: 'Wheelchair',
  83: 'Yoga',
};

/**
 * Low-intensity types: an evening walk, yoga or stretching doesn't count as a "late workout"
 * (if anything, gentle movement in the evening tends to help sleep).
 */
const LIGHT_TYPES = new Set([32, 33, 48, 71, 79, 83]);

/** Sessions shorter than this are usually auto-detected noise. */
export const MIN_WORKOUT_MIN = 10;

export function workoutLabel(w: Pick<Workout, 'type' | 'title'>): string {
  const title = w.title?.replace(/\s+/g, ' ').trim();
  return title || EXERCISE_TYPE_LABELS[w.type] || 'Workout';
}

export function isLightWorkout(w: Pick<Workout, 'type'>): boolean {
  return LIGHT_TYPES.has(w.type);
}

export function workoutDurationMin(w: Pick<Workout, 'start' | 'end'>): number {
  return Math.max(0, (w.end - w.start) / MINUTE);
}

/** How long before sleep a workout ended: > 4 h is early, 2–4 h is evening, < 2 h is late. */
export type WorkoutTiming = 'early' | 'evening' | 'late';

export function classifyWorkoutTiming(workoutEnd: number, sleepOnset: number): WorkoutTiming {
  const gapH = (sleepOnset - workoutEnd) / HOUR;
  if (gapH < 2) return 'late';
  if (gapH <= 4) return 'evening';
  return 'early';
}

export interface NightWorkouts {
  wakeDate: string;
  sleepOnset: number;
  /** Workouts in the waking day before this night (at least MIN_WORKOUT_MIN long). */
  workouts: Workout[];
  /** Any of them was more than light movement. */
  active: boolean;
  /** Timing of the last non-light workout relative to sleep onset (undefined if there was none). */
  timing?: WorkoutTiming;
  /** Hours from that workout's end to sleep onset. */
  gapH?: number;
}

/** A workout belongs to the night whose sleep onset follows it within this many hours. */
const WAKING_DAY_H = 18;

/**
 * Assigns workouts to the night that followed them (the waking day before each sleep onset) and
 * classifies the last real workout's timing. Nights without workouts are included with an empty list.
 */
export function workoutsBeforeSleep(nights: { wakeDate: string; sleepOnset: number }[], workouts: Workout[]): Map<string, NightWorkouts> {
  const usable = workouts.filter((w) => w.end > w.start && workoutDurationMin(w) >= MIN_WORKOUT_MIN).sort((a, b) => a.end - b.end);
  const out = new Map<string, NightWorkouts>();
  for (const n of nights) {
    // Allow a little overlap with the recorded onset (clock skew between the watch's sessions).
    const mine = usable.filter((w) => w.end > n.sleepOnset - WAKING_DAY_H * HOUR && w.end <= n.sleepOnset + 15 * MINUTE);
    const active = mine.filter((w) => !isLightWorkout(w));
    const last = active[active.length - 1];
    const gapH = last ? Math.max(0, (n.sleepOnset - last.end) / HOUR) : undefined;
    out.set(n.wakeDate, {
      wakeDate: n.wakeDate,
      sleepOnset: n.sleepOnset,
      workouts: mine,
      active: active.length > 0,
      timing: last ? classifyWorkoutTiming(Math.min(last.end, n.sleepOnset), n.sleepOnset) : undefined,
      gapH,
    });
  }
  return out;
}

/** First moment we can trust "no workout recorded" to mean "no workout" (a few days before the first one). */
export function workoutCoverageStart(workouts: Workout[]): number | undefined {
  if (workouts.length === 0) return undefined;
  return Math.min(...workouts.map((w) => w.start)) - 3 * 24 * HOUR;
}
