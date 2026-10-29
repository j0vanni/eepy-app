import { generateInsights, NightRow, workoutInsights } from '../insights';
import { analyzeSessions, buildNights } from '../sessions';
import { addDays, atMinutes, HOUR, MINUTE } from '../time';
import type { NightVitals, Workout } from '../types';
import { classifyWorkoutTiming, EXERCISE_TYPE_LABELS, isLightWorkout, workoutCoverageStart, workoutLabel, workoutsBeforeSleep } from '../workouts';
import { night, profile } from './helpers';

const FIRST = '2026-09-01';
const ONSET = 23 * 60;

/** One night per evening from FIRST (asleep at 23:00 for 7.5 h), with per-night latency and HRV. */
function buildRows(days: number, per: (i: number) => { latencyMin?: number; hrv?: number; staged?: boolean }): NightRow[] {
  const sessions = [];
  const vitals: Record<string, NightVitals> = {};
  for (let i = 0; i < days; i++) {
    const { latencyMin = 12, hrv, staged } = per(i);
    const s = night(addDays(FIRST, i), ONSET, 7.5, { latencyMin, staged, id: `n${i}` });
    sessions.push(s);
    if (hrv !== undefined) vitals[s.id] = { sessionId: s.id, hrvRmssd: hrv };
  }
  return buildNights(analyzeSessions(sessions))
    .filter((n) => n.main)
    .map((n) => ({ night: n, vitals: vitals[n.main!.id] }));
}

function workout(i: number, startMin: number, durMin: number, type = 56, id = `w${i}-${startMin}`): Workout {
  const start = atMinutes(addDays(FIRST, i), startMin);
  return { id, start, end: start + durMin * MINUTE, type };
}

describe('workout labels and timing', () => {
  it('labels Health Connect exercise types', () => {
    expect(EXERCISE_TYPE_LABELS[56]).toBe('Running');
    expect(workoutLabel({ type: 79 })).toBe('Walking');
    expect(workoutLabel({ type: 70, title: '  Leg day ' })).toBe('Leg day');
    expect(workoutLabel({ type: 999 })).toBe('Workout');
    expect(isLightWorkout({ type: 83 })).toBe(true);
    expect(isLightWorkout({ type: 36 })).toBe(false);
  });

  it('classifies how long before sleep a workout ended', () => {
    const onset = atMinutes(FIRST, ONSET);
    expect(classifyWorkoutTiming(onset - 5 * HOUR, onset)).toBe('early');
    expect(classifyWorkoutTiming(onset - 4 * HOUR, onset)).toBe('evening');
    expect(classifyWorkoutTiming(onset - 2 * HOUR, onset)).toBe('evening');
    expect(classifyWorkoutTiming(onset - 119 * MINUTE, onset)).toBe('late');
    expect(classifyWorkoutTiming(onset, onset)).toBe('late');
  });

  it('assigns workouts to the night that follows them', () => {
    const nights = [0, 1, 2].map((i) => ({ wakeDate: addDays(FIRST, i + 1), sleepOnset: atMinutes(addDays(FIRST, i), ONSET) }));
    const map = workoutsBeforeSleep(nights, [
      workout(0, 7 * 60, 45), // morning run → early
      workout(0, 21 * 60 + 30, 40), // 21:30–22:10 → late (the last real workout decides)
      workout(1, 19 * 60, 60, 79), // walk only → light, no timing
      workout(1, 20 * 60, 5), // too short to count
      workout(2, 18 * 60, 60, 70), // ends 19:00 → 4 h before → evening
    ]);
    const n0 = map.get(addDays(FIRST, 1))!;
    expect(n0.workouts).toHaveLength(2);
    expect(n0.timing).toBe('late');
    expect(n0.gapH).toBeCloseTo(50 / 60);
    const n1 = map.get(addDays(FIRST, 2))!;
    expect(n1.workouts).toHaveLength(1);
    expect(n1.active).toBe(false);
    expect(n1.timing).toBeUndefined();
    expect(map.get(addDays(FIRST, 3))!.timing).toBe('evening');
  });

  it('only trusts "no workout" from a few days before the first recorded one', () => {
    expect(workoutCoverageStart([])).toBeUndefined();
    const w = workout(10, 8 * 60, 30);
    expect(workoutCoverageStart([w, workout(20, 8 * 60, 30)])).toBe(w.start - 3 * 24 * HOUR);
  });
});

describe('workout insights', () => {
  const lateDay = (i: number) => i % 3 === 0;

  it('says nothing without workouts', () => {
    const rows = buildRows(30, () => ({}));
    expect(workoutInsights(rows, [])).toEqual([]);
    expect(workoutInsights(rows)).toEqual([]);
  });

  it('finds that late workouts slow falling asleep', () => {
    const rows = buildRows(42, (i) => ({ latencyMin: lateDay(i) ? 28 + (i % 2) * 4 : 10 + (i % 2) * 4 }));
    const workouts = Array.from({ length: 42 }, (_, i) => (lateDay(i) ? workout(i, 20 * 60 + 30, 60) : i % 3 === 1 ? workout(i, 7 * 60, 45) : undefined)).filter(
      (w): w is Workout => !!w,
    );
    const ins = workoutInsights(rows, workouts);
    const late = ins.find((x) => x.id === 'workout:late')!;
    expect(late).toBeDefined();
    expect(late.kind).toBe('negative');
    expect(late.category).toBe('activity');
    expect(late.title).toMatch(/^After late workouts, you take 1[78] min longer to fall asleep$/);
    expect(late.detail).toMatch(/less than 2 hours before you fell asleep/);
    expect(late.evidence).toMatch(/^14 vs 28 nights · strong signal/);
    // Also reaches the main insight list.
    const all = generateInsights({
      rows,
      nights: rows.map((r) => r.night),
      dayLogs: {},
      daily: {},
      caffeine: [],
      profile: profile(),
      chronotype: { habitual: undefined } as never,
      needMin: 450,
      workouts,
    });
    expect(all.some((x) => x.id === 'workout:late')).toBe(true);
  });

  it('a late walk or yoga session is not a late workout', () => {
    const rows = buildRows(42, (i) => ({ latencyMin: lateDay(i) ? 28 + (i % 2) * 4 : 10 + (i % 2) * 4 }));
    const walks = Array.from({ length: 42 }, (_, i) => i)
      .filter(lateDay)
      .map((i) => workout(i, 20 * 60 + 30, 60, i % 2 ? 79 : 83));
    expect(workoutInsights(rows, walks).find((x) => x.id === 'workout:late')).toBeUndefined();
  });

  it('reassures when late workouts make no difference', () => {
    const rows = buildRows(42, (i) => ({ latencyMin: 10 + (Math.floor(i / 3) % 2) * 4 }));
    const workouts = Array.from({ length: 42 }, (_, i) => i).filter(lateDay).map((i) => workout(i, 20 * 60 + 30, 60));
    const ins = workoutInsights(rows, workouts);
    expect(ins.map((x) => x.id)).toContain('workout:late-ok');
    expect(ins.find((x) => x.id === 'workout:late-ok')!.kind).toBe('positive');
  });

  it('does not claim "no effect" without the data to see one', () => {
    // Unstaged data: no latency, no stages, no vitals, no scores.
    const rows = buildRows(42, () => ({ latencyMin: 0, staged: false }));
    const workouts = Array.from({ length: 42 }, (_, i) => i).filter(lateDay).map((i) => workout(i, 20 * 60 + 30, 60));
    expect(workoutInsights(rows, workouts).find((x) => x.id === 'workout:late-ok')).toBeUndefined();
  });

  it('compares workout days with rest days', () => {
    const active = (i: number) => i % 2 === 0;
    const rows = buildRows(40, (i) => ({ hrv: active(i) ? 60 + (i % 4) : 50 + ((i + 1) % 4) }));
    const workouts = Array.from({ length: 40 }, (_, i) => i).filter(active).map((i) => workout(i, 8 * 60, 50, 8));
    const days = workoutInsights(rows, workouts).find((x) => x.id === 'workout:days')!;
    expect(days).toBeDefined();
    expect(days.kind).toBe('positive');
    expect(days.title).toBe('On workout days, your overnight HRV is 10 ms higher');
  });
});
