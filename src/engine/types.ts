/**
 * Core data model shared by the engine, the integrations and the UI.
 *
 * All timestamps are epoch milliseconds. "Date keys" are local calendar dates
 * formatted as YYYY-MM-DD. Durations are minutes unless the name says otherwise.
 */

/** Sleep stage of a segment. `asleep` means "asleep, stage unknown" (unstaged devices / manual logs). */
export type Stage = 'awake' | 'light' | 'deep' | 'rem' | 'asleep' | 'outOfBed';

export const SLEEP_STAGES: readonly Stage[] = ['light', 'deep', 'rem', 'asleep'];

export function isSleepStage(stage: Stage): boolean {
  return stage === 'light' || stage === 'deep' || stage === 'rem' || stage === 'asleep';
}

export interface StageSegment {
  stage: Stage;
  start: number;
  end: number;
}

export type DataSource = 'health-connect' | 'healthkit' | 'manual' | 'demo' | 'import';

export interface SleepSession {
  id: string;
  source: DataSource;
  /** App/package that wrote the record (e.g. Nothing X's package name `com.nothing.smartcenter`). */
  origin?: string;
  device?: string;
  start: number;
  end: number;
  /** Stage segments; empty means the whole session is treated as unstaged sleep. */
  stages: StageSegment[];
  /** Forces classification; otherwise main sleep vs nap is inferred. */
  kind?: 'main' | 'nap';
  notes?: string;
  updatedAt?: number;
}

export interface VitalSample {
  time: number;
  value: number;
}

/** Compact per-session physiology summary computed at sync time (raw samples are not stored). */
export interface NightVitals {
  sessionId: string;
  hrMin?: number;
  hrAvg?: number;
  /** Minutes from sleep onset at which the (smoothed) heart rate bottomed out. */
  hrNadirOffsetMin?: number;
  /** Heart rate curve in 10-minute bins: [minutes since session start, bpm]. */
  hrCurve?: [number, number][];
  hrvRmssd?: number;
  spo2Avg?: number;
  spo2Min?: number;
  /** Oxygen desaturation events (>= 3% drop vs. rolling baseline) per hour, if sampling is dense enough. */
  spo2DipsPerHour?: number;
  spo2Samples?: number;
  respRate?: number;
}

/** Per-calendar-day aggregates (steps, resting HR, ...). */
export interface DailyStats {
  date: string;
  steps?: number;
  restingHr?: number;
  daytimeHrAvg?: number;
  hrv?: number;
}

/** A workout recorded by the watch (Health Connect ExerciseSession). */
export interface Workout {
  id: string;
  start: number;
  end: number;
  /** Health Connect ExerciseType code. */
  type: number;
  title?: string;
  origin?: string;
}

/** A momentary alertness rating (Karolinska Sleepiness Scale, 1–9) from a ping or quick check-in. */
export interface AlertnessCheckIn {
  id: string;
  time: number;
  kss: number;
  source: 'ping' | 'manual';
}

export interface CaffeineDose {
  id: string;
  time: number;
  mg: number;
  label: string;
}

/**
 * One journal entry per calendar day D.
 * - Morning fields describe the main sleep that ended on D.
 * - Daytime fields describe day D.
 * - Evening `tags` describe behaviours on D that may affect the night ending on D+1.
 */
export interface DayLog {
  date: string;
  /** Subjective quality of last night's sleep, 1 (awful) – 5 (great). */
  sleepRating?: number;
  /** Woke up without an alarm (strong signal for sleep-need estimation). */
  wokeNaturally?: boolean;
  /** Daytime energy, 1 (exhausted) – 5 (energised). */
  energy?: number;
  /** Karolinska Sleepiness Scale, 1 (extremely alert) – 9 (fighting sleep). */
  sleepiness?: number;
  /** Time the sleepiness rating was given. */
  sleepinessAt?: number;
  mood?: number;
  tags: string[];
  note?: string;
}

export type Sex = 'female' | 'male' | 'other';

export interface ScreeningResult {
  score: number;
  date: string;
  answers: number[];
}

export interface Profile {
  name?: string;
  birthYear: number;
  sex?: Sex;
  /** If set, overrides the personalised sleep-need estimate. */
  sleepNeedOverrideMin?: number;
  /** Wake time on workdays, minutes after midnight. */
  workWakeMin: number;
  /** Preferred wake time on free days, minutes after midnight (optional). */
  freeWakeMin?: number;
  /** Days of the week with fixed obligations (0 = Sunday … 6 = Saturday). */
  workdays: number[];
  caffeineHalfLifeH: number;
  /** Max caffeine (mg) still in the body at bedtime before we warn. */
  caffeineBedtimeLimitMg: number;
  windDownMin: number;
  /** CBT-I style mode: discourages naps and favours a fixed schedule. */
  insomniaMode: boolean;
  screenings: Record<string, ScreeningResult | undefined>;
  onboarded: boolean;
  /** Calendar: per-morning wake plans (YYYY-MM-DD of the morning) that override the weekly pattern. */
  wakePlan?: Record<string, DayWakePlan>;
}

/** One morning in the calendar: a fixed wake-up time, or a free day with no alarm. */
export interface DayWakePlan {
  wakeMin?: number;
  free?: boolean;
}

export const DEFAULT_PROFILE: Profile = {
  birthYear: 1998,
  workWakeMin: 7 * 60,
  workdays: [1, 2, 3, 4, 5],
  caffeineHalfLifeH: 5,
  caffeineBedtimeLimitMg: 50,
  windDownMin: 60,
  insomniaMode: false,
  screenings: {},
  onboarded: false,
};

/** Everything the analysis needs, as stored on device. */
export interface SleepDataset {
  sessions: SleepSession[];
  vitals: Record<string, NightVitals>;
  daily: Record<string, DailyStats>;
  dayLogs: Record<string, DayLog>;
  caffeine: CaffeineDose[];
  profile: Profile;
  /** Momentary sleepiness ratings used to personalise the energy forecast. */
  checkins?: AlertnessCheckIn[];
  workouts?: Workout[];
}
