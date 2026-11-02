import { buildNightStory } from '../nightStory';
import { personalEfficiency } from '../sessions';
import { scoreSleep } from '../sleepScore';
import { atMinutes, MINUTE } from '../time';
import type { NightVitals, Profile, SleepDataset, SleepSession, Stage, StageSegment, TwoStepMorning, WakeLog } from '../types';
import { routineWindowFor, switchTwoStep } from '../twoStep';
import { correctedMetrics, EMPTY_WAKE_LOG } from '../wakeDetect';
import { profile } from './helpers';

const EVE = '2026-10-20'; // Tuesday evening → Wednesday morning (a workday)
const WAKE_DAY = '2026-10-21';
const at = (h: number, m = 0) => (h >= 12 ? atMinutes(EVE, h * 60 + m) : atMinutes(WAKE_DAY, h * 60 + m));

const TWO: TwoStepMorning = { enabled: true, firstWakeMin: 5 * 60, routineMin: 20 };
const ON = profile({ workWakeMin: 6 * 60 + 5, twoStepMorning: TWO });
const OFF = profile({ workWakeMin: 6 * 60 + 5 });

type Seg = [Stage, [number, number], [number, number]];
function session(segs: Seg[], id = 'hc:night'): SleepSession {
  const stages: StageSegment[] = segs.map(([stage, a, b]) => ({ stage, start: at(...a), end: at(...b) }));
  return { id, source: 'health-connect', start: stages[0].start, end: stages[stages.length - 1].end, stages };
}

/** Asleep 23:00, last deep/REM ends 04:05, light until the 04:47 routine alarm. */
const NIGHT: Seg[] = [
  ['awake', [22, 50], [23, 0]],
  ['light', [23, 0], [23, 20]],
  ['deep', [23, 20], [0, 0]],
  ['light', [0, 0], [0, 20]],
  ['rem', [0, 20], [0, 35]],
  ['light', [0, 35], [1, 5]],
  ['deep', [1, 5], [1, 35]],
  ['light', [1, 35], [1, 55]],
  ['rem', [1, 55], [2, 15]],
  ['light', [2, 15], [3, 0]],
  ['deep', [3, 0], [3, 15]],
  ['light', [3, 15], [3, 40]],
  ['rem', [3, 40], [4, 5]],
  ['light', [4, 5], [4, 47]],
];
/** The routine 04:47–05:12, then a short light stretch back asleep until the final alarm. */
const BACK_TO_SLEEP: Seg[] = [...NIGHT, ['awake', [4, 47], [5, 12]], ['light', [5, 12], [6, 5]], ['awake', [6, 5], [6, 20]]];
/** The routine, then up for the day (the watch kept recording until 06:20). */
const STAYED_UP: Seg[] = [...NIGHT, ['awake', [4, 47], [6, 20]]];

/** "I'm up" on the routine alarm, eepy on screen, steps at the sink; "I'm up" on the final alarm. */
const ROUTINE_EVIDENCE = {
  ups: [at(4, 48), at(6, 6)],
  use: [[at(4, 49), at(4, 51)]] as [number, number][],
  steps: [[at(4, 50), 60], [at(5, 0), 40], [at(6, 10), 80]] as [number, number][],
};

function dataset(sessions: SleepSession[], p: Profile, x: { ups?: number[]; use?: [number, number][]; steps?: [number, number][] } = {}): SleepDataset {
  const s0 = sessions[0];
  const v: NightVitals = { sessionId: s0.id };
  if (x.steps) v.stepCurve = x.steps.map(([t, n]): [number, number] => [Math.round((t - s0.start) / MINUTE), n]);
  const wakeLog: WakeLog = { ...EMPTY_WAKE_LOG, use: x.use ?? [], ups: x.ups ?? [] };
  return { sessions, vitals: { [s0.id]: v }, daily: {}, dayLogs: {}, caffeine: [], profile: p, checkins: [], wakeLog };
}

function run(sessions: SleepSession[], p: Profile, x = ROUTINE_EVIDENCE) {
  const r = correctedMetrics(dataset(sessions, p, x), sessions);
  const m = r.metrics.find((y) => !y.isNap)!;
  return { m, t: r.timelines[m.id], all: r.metrics };
}

describe('wake-up detection on a two-step morning', () => {
  it('without the setting, the routine alarm is taken as the wake-up (light sleep only after it)', () => {
    const { m, t } = run([session(BACK_TO_SLEEP)], OFF);
    expect(m.finalWake).toBe(at(4, 47));
    expect(t.outOfBed.time).toBe(at(4, 48));
    expect(t.routine).toBeUndefined();
  });

  it('follows a date switched on or off in the calendar', () => {
    // Weekly setting never set up, but on for this one morning.
    const once = run([session(BACK_TO_SLEEP)], { ...OFF, wakePlan: { [WAKE_DAY]: { twoStep: true } } });
    expect(once.m.finalWake).toBe(at(6, 5));
    // A usual two-step morning switched off for the date: the early wake-up was the real one.
    const skipped = run([session(BACK_TO_SLEEP)], { ...ON, wakePlan: { [WAKE_DAY]: { twoStep: false } } });
    expect(skipped.m.finalWake).toBe(at(4, 47));
    expect(skipped.t.routine).toBeUndefined();
  });

  it('with it, the routine is not the final wake-up — the night ends at the final alarm', () => {
    const { m, t } = run([session(BACK_TO_SLEEP)], ON);
    expect(m.finalWake).toBe(at(6, 5));
    expect(t.woke.time).toBe(at(6, 5));
    // "I'm up" on the final alarm still ends the time in bed.
    expect(t.outOfBed.time).toBe(at(6, 6));
    expect(t.routine).toEqual({
      start: at(4, 47),
      end: at(5, 12),
      minutes: 25,
      plannedMin: 25,
      stayedUp: false,
      backAsleep: at(5, 12),
      evidence: ['stopped the alarm', 'opened eepy', '100 steps'],
    });
  });

  it('total sleep is both stretches; the routine is labelled, not a wake-up in the night', () => {
    const { m, t } = run([session(BACK_TO_SLEEP)], ON);
    expect(m.totalSleepMin).toBe(347 + 53);
    expect(t.episodes).toEqual([expect.objectContaining({ start: at(4, 47), end: at(5, 12), routine: true })]);
    expect(m.wasoMin).toBe(0);
    expect(m.awakenings).toBe(0);
    expect(m.routine).toEqual({ start: at(4, 47), end: at(5, 12), minutes: 25 });
    // Out of bed for the routine isn't time in bed: 22:50 → 06:06 minus the routine.
    expect(m.timeInBedMin).toBe(436 - 25);
    expect(m.efficiency).toBeCloseTo(400 / 411, 5);
  });

  it("doesn't count against restfulness or efficiency the way an unplanned wake-up does", () => {
    const planned = run([session(BACK_TO_SLEEP)], ON).m;
    // The same night read as one unplanned wake-up (no evidence, no setting, nothing cut).
    const unplanned = correctedMetrics(dataset([session(BACK_TO_SLEEP)], OFF), [session(BACK_TO_SLEEP)]).metrics[0];
    expect(unplanned.finalWake).toBe(at(6, 5));
    expect(unplanned.wasoMin).toBe(25);
    const ctx = { needMin: 420, age: 30 };
    const part = (s: ReturnType<typeof scoreSleep>, k: string) => s.components.find((c) => c.key === k)!.score;
    const a = scoreSleep(planned, ctx);
    const b = scoreSleep(unplanned, ctx);
    expect(part(a, 'disruptions')).toBe(1);
    expect(part(b, 'disruptions')).toBeLessThan(1);
    expect(part(a, 'efficiency')).toBeGreaterThan(part(b, 'efficiency'));
    // The planner's efficiency isn't lowered by the routine either (the plan adds it separately).
    const nights = (main: typeof planned) => Array.from({ length: 6 }, () => ({ wakeDate: WAKE_DAY, main, naps: [], totalSleepMin: main.totalSleepMin }));
    // 400 min asleep over 23:00–06:05 minus the 25-min routine (capped at 97%), not over all 425 min.
    expect(personalEfficiency(nights(planned))).toBe(0.97);
    expect(personalEfficiency(nights({ ...planned, routine: undefined }))).toBeCloseTo(400 / 425, 3);
  });

  it('a longer stay in the routine counts as waking beyond the plan (routine + 10 + 15 min)', () => {
    const long: Seg[] = [...NIGHT, ['awake', [4, 47], [5, 47]], ['light', [5, 47], [6, 5]], ['awake', [6, 5], [6, 20]]];
    const { m, t } = run([session(long)], ON);
    expect(t.routine).toMatchObject({ minutes: 60, plannedMin: 45, stayedUp: false });
    expect(m.wasoMin).toBe(15);
    expect(m.finalWake).toBe(at(6, 5));
  });

  it("no sleep after the routine: it was the real wake-up, and eepy says so", () => {
    const { m, t } = run([session(STAYED_UP)], ON, { ...ROUTINE_EVIDENCE, steps: [...ROUTINE_EVIDENCE.steps, [at(5, 30), 200]] });
    expect(m.finalWake).toBe(at(4, 47));
    expect(t.woke.time).toBe(at(4, 47));
    expect(t.outOfBed.time).toBe(at(4, 48));
    expect(t.routine).toMatchObject({ start: at(4, 47), stayedUp: true });
    expect(t.routine?.backAsleep).toBeUndefined();
    expect(m.routine).toBeUndefined();
  });

  it('finds the routine from the watch alone (no eepy use, no steps)', () => {
    const { m, t } = run([session(BACK_TO_SLEEP)], ON, { ups: [], use: [], steps: [] });
    expect(m.finalWake).toBe(at(6, 5));
    expect(t.routine).toMatchObject({ start: at(4, 47), end: at(5, 12), stayedUp: false, evidence: [] });
    expect(m.wasoMin).toBe(0);
  });

  it('joins two recordings either side of a long routine into one night', () => {
    const a = session([...NIGHT, ['awake', [4, 47], [4, 50]]], 'hc:a');
    const b = session([['awake', [5, 38], [5, 42]], ['light', [5, 42], [6, 5]], ['awake', [6, 5], [6, 15]]], 'hc:b');
    // 48 min between them: more than the usual 45 min that joins a night split by a wake-up.
    expect(b.start - a.end).toBe(48 * MINUTE);
    const off = correctedMetrics(dataset([a, b], OFF, { ups: [], use: [], steps: [] }), [a, b]).metrics;
    expect(off.filter((m) => !m.isNap).map((m) => m.finalWake)).toEqual([at(4, 47)]);
    const on = run([a, b], ON, { ups: [], use: [], steps: [] });
    expect(on.all).toHaveLength(1);
    expect(on.m.id).toBe('hc:a+hc:b');
    expect(on.m.finalWake).toBe(at(6, 5));
    expect(on.t.routine).toMatchObject({ start: at(4, 47), stayedUp: false });
  });

  it('leaves nights before the setting was switched on alone', () => {
    const p = profile({ workWakeMin: 6 * 60 + 5, twoStepMorning: { ...TWO, since: '2026-10-22' } });
    const { m, t } = run([session(BACK_TO_SLEEP)], p);
    expect(m.finalWake).toBe(at(4, 47));
    expect(t.routine).toBeUndefined();
  });

  it('switching it off keeps reading the mornings it was on as two-step mornings', () => {
    const on = switchTwoStep({ ...TWO, enabled: false }, true, atMinutes('2026-10-19', 21 * 60));
    expect(on).toMatchObject({ enabled: true, since: '2026-10-20' });
    // Off on Thursday evening: Tue–Thu mornings stay two-step mornings, later ones don't.
    const off = switchTwoStep(on, false, atMinutes('2026-10-22', 20 * 60));
    expect(off).toMatchObject({ enabled: false, past: [['2026-10-20', '2026-10-23']] });
    const p = profile({ workWakeMin: 6 * 60 + 5, twoStepMorning: off });
    const { m, t } = run([session(BACK_TO_SLEEP)], p);
    expect(m.finalWake).toBe(at(6, 5));
    expect(t.routine?.stayedUp).toBe(false);
    expect(routineWindowFor(p, '2026-10-23', { wakeMin: 365, isWorkday: true })).toBeUndefined();
    // Switched on before noon: this morning counts.
    expect(switchTwoStep(off, true, atMinutes('2026-10-26', 5 * 60 + 10)).since).toBe('2026-10-26');
  });

  it("your own wake-up time still wins", () => {
    const sessions = [session(BACK_TO_SLEEP)];
    const d = dataset(sessions, ON, ROUTINE_EVIDENCE);
    d.wakeLog!.fixes = { 'hc:night': { wake: at(4, 47), at: at(9) } };
    const r = correctedMetrics(d, sessions);
    expect(r.metrics[0].finalWake).toBe(at(4, 47));
    expect(r.timelines['hc:night'].routine).toBeUndefined();
  });

  it("the night story doesn't call the routine a wake-up", () => {
    const { m } = run([session(BACK_TO_SLEEP)], ON);
    const story = buildNightStory({ night: m, nights: [{ wakeDate: WAKE_DAY, main: m, naps: [], totalSleepMin: m.totalSleepMin }], vitals: {}, dayLogs: {}, caffeine: [], profile: ON, insights: [], scores: {} })!;
    const awake = story.sentences.filter((s) => s.topic === 'awake').map((s) => s.parts.map((p) => p.text).join(''));
    expect(awake.join(' ')).not.toMatch(/You were awake/);
    expect(awake.join(' ')).toMatch(/Up for your morning routine 04:47–05:12, then back to sleep/);
  });
});
