import type { PlannedNight } from '../adherence';
import { addDays, atMinutes, MINUTE, weekdayOfKey } from '../time';
import { DEFAULT_PROFILE, Profile, SleepDataset, SleepSession, Stage, StageSegment } from '../types';

/** A night from `onset` (minutes after midnight on the evening date) lasting `hours`, with ~90 min cycles. */
export function night(
  evening: string,
  onsetMin: number,
  hours: number,
  opts: { latencyMin?: number; staged?: boolean; id?: string; kind?: 'main' | 'nap'; origin?: string } = {},
): SleepSession {
  const onset = atMinutes(evening, onsetMin);
  const wake = onset + hours * 60 * MINUTE;
  const start = onset - (opts.latencyMin ?? 10) * MINUTE;
  const stages: StageSegment[] = [{ stage: 'awake', start, end: onset }];
  if (opts.staged === false) {
    stages.push({ stage: 'asleep', start: onset, end: wake });
  } else {
    let t = onset;
    const plan: [Stage, number][] = [];
    for (let k = 0; k < 8; k++) plan.push(['light', 35], ['deep', Math.max(0, 30 - 8 * k)], ['light', 15], ['rem', 10 + 5 * k]);
    for (const [stage, mins] of plan) {
      if (t >= wake || mins <= 0) continue;
      const end = Math.min(wake, t + mins * MINUTE);
      stages.push({ stage, start: t, end });
      t = end;
    }
  }
  return { id: opts.id ?? `n-${evening}`, source: 'manual', origin: opts.origin, start, end: wake, stages, kind: opts.kind };
}

export const profile = (over: Partial<Profile> = {}): Profile => ({ ...DEFAULT_PROFILE, birthYear: 1996, onboarded: true, ...over });

/** Monday: tonight → Tuesday morning, a workday. */
export const USER_MON = '2026-11-02';

/**
 * Someone like eepy's user: up for good at 6:00 with a 5:00 routine alarm (20 min) and back to
 * sleep, a 6h 40m need, short workday nights (asleep ~2 AM) and long weekend lie-ins — about 3–4 h
 * of sleep debt — asleep around 1:51 AM the last three nights, and (for adherence) the last six
 * nights' plans ~35 min before they actually got into bed.
 */
export function userLikeData(over: Partial<Profile> = {}): { data: SleepDataset; planLog: Record<string, PlannedNight> } {
  const sessions: SleepSession[] = [];
  const planLog: Record<string, PlannedNight> = {};
  for (let i = 28; i >= 1; i--) {
    const evening = addDays(USER_MON, -i);
    const wakeDate = addDays(evening, 1);
    const wd = weekdayOfKey(wakeDate);
    const weekend = wd === 0 || wd === 6;
    const jitter = ((i * 37) % 21) - 10;
    const onset = i <= 3 ? 25 * 60 + 51 + jitter / 2 : weekend ? 26 * 60 + 30 + jitter : 26 * 60 + jitter;
    // From the watch (Health Connect), so wake-up detection and "I'm in bed" taps apply.
    sessions.push({ ...night(evening, onset, weekend ? 8.5 : 5.25, { latencyMin: 15 }), source: 'health-connect' });
    if (i <= 6) {
      const target = atMinutes(evening, onset - 15 - 35);
      planLog[wakeDate] = { wakeDate, planned: target, target, wake: atMinutes(wakeDate, 6 * 60), held: true };
    }
  }
  const data: SleepDataset = {
    sessions,
    vitals: {},
    daily: {},
    dayLogs: {},
    caffeine: [],
    checkins: [],
    workouts: [],
    wakeLog: { detect: false, use: [], ups: [], inBed: [], outOfBed: [], fixes: {} },
    profile: profile({ workWakeMin: 6 * 60, sleepNeedOverrideMin: 400, twoStepMorning: { enabled: true, firstWakeMin: 5 * 60, routineMin: 20 }, ...over }),
  };
  return { data, planLog };
}
