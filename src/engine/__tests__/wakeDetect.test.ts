import { analyze } from '../analysis';
import { generateDemoData } from '../demo';
import { computeSessionMetrics } from '../sessions';
import { addDays, atMinutes, DAY, MINUTE } from '../time';
import type { NightFix, NightVitals, SleepDataset, SleepSession, Stage, StageSegment, WakeLog } from '../types';
import { correctedMetrics, EMPTY_WAKE_LOG, inUseWindow, logAppUse, logUp, WAKE_LOG_DAYS, withFix } from '../wakeDetect';
import { night, profile } from './helpers';

const EVE = '2026-10-20'; // Tuesday evening → Wednesday morning (a workday)
const WAKE_DAY = '2026-10-21';

/** Clock time on the evening (h ≥ 12) or the next morning (h < 12). */
const at = (h: number, m = 0) => (h >= 12 ? atMinutes(EVE, h * 60 + m) : atMinutes(WAKE_DAY, h * 60 + m));

type Seg = [Stage, [number, number], [number, number]];
function session(segs: Seg[], over: Partial<SleepSession> = {}): SleepSession {
  const stages: StageSegment[] = segs.map(([stage, a, b]) => ({ stage, start: at(...a), end: at(...b) }));
  return { id: 'hc:night', source: 'health-connect', start: stages[0].start, end: stages[stages.length - 1].end, stages, ...over };
}

/** A staged night: in bed 22:50, asleep 23:00, last REM ends 06:40, awake 07:20–07:40, then the watch keeps "sleeping" until 09:12. */
const RAN_ON: Seg[] = [
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
  ['light', [4, 5], [4, 50]],
  ['rem', [4, 50], [5, 20]],
  ['light', [5, 20], [6, 10]],
  ['rem', [6, 10], [6, 40]],
  ['light', [6, 40], [7, 20]],
  ['awake', [7, 20], [7, 40]],
  ['light', [7, 40], [9, 12]],
];

interface Extra {
  use?: [number, number][];
  ups?: number[];
  fixes?: Record<string, NightFix>;
  detect?: boolean;
  /** [clock time, steps] → stored as a step curve relative to the session start. */
  steps?: [number, number][];
  hr?: [number, number][];
  checkins?: number[];
  caffeine?: number[];
}

function dataset(sessions: SleepSession[], x: Extra = {}): SleepDataset {
  const s0 = sessions[sessions.length - 1];
  const rel = (pts: [number, number][]) => pts.map(([t, v]): [number, number] => [Math.round((t - s0.start) / MINUTE), v]);
  const v: NightVitals = { sessionId: s0.id };
  if (x.steps) v.stepCurve = rel(x.steps);
  if (x.hr) v.hrCurve = rel(x.hr);
  const wakeLog: WakeLog = { ...EMPTY_WAKE_LOG, use: x.use ?? [], ups: x.ups ?? [], fixes: x.fixes ?? {}, detect: x.detect ?? true };
  return {
    sessions,
    vitals: { [s0.id]: v },
    daily: {},
    dayLogs: {},
    caffeine: (x.caffeine ?? []).map((t, i) => ({ id: `c${i}`, time: t, mg: 95, label: 'Coffee' })),
    profile: profile(),
    checkins: (x.checkins ?? []).map((t, i) => ({ id: `k${i}`, time: t, kss: 4, source: 'manual' as const })),
    wakeLog,
  };
}

function run(sessions: SleepSession[], x: Extra = {}) {
  const r = correctedMetrics(dataset(sessions, x), sessions);
  const m = r.metrics.find((y) => y.id === sessions[sessions.length - 1].id)!;
  return { m, t: r.timelines[m.id], all: r };
}

/** Steps in 10-min bins starting at a clock time. */
const walk = (h: number, mi: number, ...bins: number[]): [number, number][] => bins.map((v, i) => [at(h, mi) + i * 10 * MINUTE, v]);

describe('final wake: the watch kept recording after you got up', () => {
  it('cuts the night where you opened eepy and walked around', () => {
    const { m, t } = run([session(RAN_ON)], { use: [[at(7, 40), at(7, 45)]], steps: walk(7, 40, 130, 100) });
    expect(m.end).toBe(at(7, 40));
    expect(m.finalWake).toBe(at(7, 20)); // woke up: the watch saw you awake from 07:20
    expect(t.recorded.end).toBe(at(9, 12));
    expect(t.trimmedMin).toBe(92);
    expect(t.outOfBed).toEqual({ time: at(7, 40), source: 'app', confidence: 'high' });
    expect(t.woke).toMatchObject({ time: at(7, 20), source: 'watch', confidence: 'high' });
    expect(t.upEvidence).toEqual(['opened eepy', '230 steps']);
    // Time in bed ends when you got up; the 92 min of "light sleep" after it are gone.
    const recorded = computeSessionMetrics(session(RAN_ON))!;
    expect(recorded.totalSleepMin - m.totalSleepMin).toBe(92);
    expect(m.timeInBedMin).toBe(530);
    // The recording called the tail "sleep", which flattered efficiency: 500 of 530 min, not 592 of 622.
    expect(m.efficiency).toBeCloseTo(500 / 530, 5);
    expect(recorded.efficiency).toBeCloseTo(592 / 622, 5);
  });

  it('ignores checking the phone when you went back to sleep (REM after it)', () => {
    // 06:00: opened eepy, then 30 min of REM — still asleep. Only the 07:40 open counts.
    const both = run([session(RAN_ON)], { use: [[at(6, 0), at(6, 3)], [at(7, 40), at(7, 41)]] });
    expect(both.m.end).toBe(at(7, 40));
    const early = run([session(RAN_ON)], { use: [[at(6, 0), at(6, 3)]] });
    expect(early.m.end).toBe(at(9, 12));
    expect(early.t.trimmedMin).toBe(0);
    // …but the minutes on the phone were a wake-up during the night (as was 07:20–07:40, still inside the recording).
    expect(early.t.episodes).toEqual([
      expect.objectContaining({ start: at(6, 0), end: at(6, 3), usedEepy: true, up: true }),
      expect.objectContaining({ start: at(7, 20), end: at(7, 40), minutes: 20, up: false }),
    ]);
  });

  it('a check-in or "I\'m up" on the alarm counts like opening eepy', () => {
    expect(run([session(RAN_ON)], { checkins: [at(7, 45)] }).m.end).toBe(at(7, 45));
    expect(run([session(RAN_ON)], { ups: [at(7, 41)] }).t.outOfBed.source).toBe('alarm');
  });

  it('a burst of steps alone means you were up; a bathroom trip does not', () => {
    const burst = run([session(RAN_ON)], { steps: walk(8, 0, 60, 70) });
    expect(burst.m.end).toBe(at(8, 0));
    expect(burst.t.outOfBed).toMatchObject({ source: 'steps', confidence: 'medium' });
    const trip = run([session(RAN_ON)], { steps: [...walk(8, 0, 40), ...walk(8, 40, 30)] });
    expect(trip.m.end).toBe(at(9, 12));
  });

  it('a heart-rate rise alone never cuts the night, but confirms other evidence', () => {
    const hr: [number, number][] = [];
    for (let t = at(23, 0); t < at(9, 12); t += 10 * MINUTE) hr.push([t, t >= at(7, 30) ? 72 : 55]);
    expect(run([session(RAN_ON)], { hr }).m.end).toBe(at(9, 12));
    const withCheckin = run([session(RAN_ON)], { hr, checkins: [at(7, 50)] });
    expect(withCheckin.m.end).toBe(at(7, 50));
    expect(withCheckin.t.outOfBed.confidence).toBe('high');
    expect(withCheckin.t.upEvidence).toContain('heart rate up');
  });

  it('caffeine is supporting evidence only (drinks are often logged afterwards)', () => {
    expect(run([session(RAN_ON)], { caffeine: [at(7, 45)] }).m.end).toBe(at(9, 12));
  });

  it('leaves a night without any sign of being up exactly as recorded', () => {
    const s = session(RAN_ON);
    const { m, t } = run([s]);
    expect(m).toEqual(computeSessionMetrics(s));
    expect(t).toMatchObject({ trimmedMin: 0, onsetShiftMin: 0, outOfBed: { time: at(9, 12), source: 'recorded' } });
  });

  it('only cuts when it matters (≥ 10 min)', () => {
    const tail = (h: number, mi: number) => session([...RAN_ON.slice(0, -2), ['light', [7, 20], [h, mi]]]);
    expect(run([tail(7, 48)], { use: [[at(7, 40), at(7, 40)]] }).m.end).toBe(at(7, 48));
    expect(run([tail(7, 52)], { use: [[at(7, 40), at(7, 40)]] }).m.end).toBe(at(7, 40));
  });

  it('never cuts before the end of the last deep/REM sleep', () => {
    // A 3-min REM blip after the signal: not "back to sleep", but the night can't end before it.
    const segs: Seg[] = [...RAN_ON.slice(0, 16), ['light', [6, 10], [6, 20]], ['rem', [6, 20], [6, 23]], ['light', [6, 23], [9, 0]]];
    const { m } = run([session(segs)], { use: [[at(6, 15), at(6, 16)]] });
    expect(m.end).toBe(at(6, 23));
  });

  it('signs of being up early in the night are awakenings, not the morning', () => {
    const segs: Seg[] = [['awake', [22, 50], [23, 0]], ['light', [23, 0], [7, 0]]];
    const { m } = run([session(segs)], { use: [[at(1, 0), at(1, 1)]] });
    expect(m.end).toBe(at(7, 0));
  });

  it('never touches naps or manual logs', () => {
    const nap = session([['light', [14, 0], [15, 30]]], { id: 'hc:nap', kind: 'nap' });
    const napRun = run([nap], { use: [[at(14, 40), at(14, 45)]], steps: walk(14, 40, 200) });
    expect(napRun.m.end).toBe(at(15, 30));
    expect(napRun.t).toBeUndefined();
    const manual = run([session(RAN_ON, { source: 'manual' })], { use: [[at(7, 40), at(7, 45)]] });
    expect(manual.m.end).toBe(at(9, 12));
    expect(manual.t).toBeUndefined();
  });

  it('on nights without stages an interaction needs a second sign', () => {
    const unstaged = session([['awake', [22, 50], [23, 0]], ['asleep', [23, 0], [9, 12]]]);
    expect(run([unstaged], { use: [[at(7, 40), at(7, 41)]] }).m.end).toBe(at(9, 12));
    expect(run([unstaged], { use: [[at(7, 40), at(7, 41)]], steps: walk(7, 50, 30) }).m.end).toBe(at(7, 40));
    expect(run([unstaged], { steps: walk(7, 50, 70, 60) }).m.end).toBe(at(7, 50));
  });

  it('can be switched off', () => {
    expect(run([session(RAN_ON)], { use: [[at(7, 40), at(7, 45)]], detect: false }).m.end).toBe(at(9, 12));
  });
});

describe('your correction always wins', () => {
  const detected = { use: [[at(7, 40), at(7, 45)]] as [number, number][], steps: walk(7, 40, 130, 100) };

  it('uses the wake-up time you give', () => {
    const { m, t } = run([session(RAN_ON)], { ...detected, fixes: { 'hc:night': { wake: at(8, 30), at: 0 } } });
    expect(m.finalWake).toBe(at(8, 30));
    expect(m.end).toBe(at(8, 30));
    expect(t.woke).toEqual({ time: at(8, 30), source: 'you', confidence: 'high' });
    expect(t.fixed).toBe(true);
  });

  it('applies even with detection off, and an earlier wake-up keeps the sign you got up', () => {
    const { m, t } = run([session(RAN_ON)], { ...detected, detect: false, fixes: { 'hc:night': { wake: at(7, 0), at: 0 } } });
    expect(m.finalWake).toBe(at(7, 0));
    // Detection is off, so nothing else is looked at: in bed until the wake-up you gave.
    expect(m.end).toBe(at(7, 0));
    const on = run([session(RAN_ON)], { ...detected, fixes: { 'hc:night': { wake: at(7, 0), at: 0 } } });
    expect(on.m.finalWake).toBe(at(7, 0));
    expect(on.m.end).toBe(at(7, 40));
    expect(on.t.outOfBed.source).toBe('app');
  });

  it('can move sleep onset either way and set when you got up', () => {
    const later = run([session(RAN_ON)], { fixes: { 'hc:night': { asleep: at(23, 30), up: at(8, 0), at: 0 } } });
    expect(later.m.sleepOnset).toBe(at(23, 30));
    expect(later.m.latencyMin).toBe(40);
    expect(later.m.end).toBe(at(8, 0));
    expect(later.t.asleep.source).toBe('you');
    const earlier = run([session(RAN_ON)], { fixes: { 'hc:night': { asleep: at(22, 55), at: 0 } } });
    expect(earlier.m.sleepOnset).toBe(at(22, 55));
  });

  it('"Looks right" keeps the detection and stops asking', () => {
    const { m, t } = run([session(RAN_ON)], { use: [[at(7, 40), at(7, 41)]], fixes: { 'hc:night': { ok: true, at: 0 } } });
    expect(m.end).toBe(at(7, 40));
    expect(t.confirmed).toBe(true);
    expect(t.outOfBed.confidence).toBe('high');
  });
});

describe('falling asleep', () => {
  /** Recorded asleep from 23:00, but the first deep sleep only at 00:10. */
  const SLOW: Seg[] = [
    ['awake', [22, 50], [23, 0]],
    ['light', [23, 0], [0, 10]],
    ['deep', [0, 10], [0, 50]],
    ['light', [0, 50], [1, 20]],
    ['rem', [1, 20], [1, 40]],
    ['light', [1, 40], [7, 0]],
  ];

  it('moves onset to when you put eepy down, keeping the time in bed', () => {
    const recorded = computeSessionMetrics(session(SLOW))!;
    const { m, t } = run([session(SLOW)], { use: [[at(23, 5), at(23, 40)]] });
    expect(m.sleepOnset).toBe(at(23, 40));
    expect(m.start).toBe(at(22, 50));
    expect(m.latencyMin).toBe(50);
    expect(m.timeInBedMin).toBe(recorded.timeInBedMin);
    expect(m.totalSleepMin).toBe(recorded.totalSleepMin - 40);
    expect(m.efficiency).toBeLessThan(recorded.efficiency);
    expect(t.inBed).toMatchObject({ time: at(22, 50) });
    expect(t.asleep).toMatchObject({ time: at(23, 40), source: 'app', confidence: 'high' }); // + long light stretch
    expect(t.onsetShiftMin).toBe(40);
    expect(t.lastUseBeforeSleep).toBe(at(23, 40));
  });

  it('never moves onset past the first deep/REM sleep', () => {
    expect(run([session(SLOW)], { use: [[at(23, 5), at(0, 30)]] }).m.sleepOnset).toBe(at(0, 10));
  });

  it('steps after going to bed mean you were still up', () => {
    expect(run([session(SLOW)], { steps: walk(23, 30, 45) }).m.sleepOnset).toBe(at(23, 30));
  });

  it('a long light stretch or a high heart rate alone only lower confidence', () => {
    const hr: [number, number][] = [];
    for (let t = at(23, 0); t < at(7, 0); t += 10 * MINUTE) hr.push([t, t < at(23, 40) ? 70 : 55]);
    const { m, t } = run([session(SLOW)], { hr });
    expect(m.sleepOnset).toBe(at(23, 0));
    expect(t.asleep).toMatchObject({ source: 'watch', confidence: 'low' });
    expect(t.onsetEvidence).toEqual(['long light sleep before deep sleep', "heart rate hadn't dropped yet"]);
  });

  it('shows the last eepy use before sleep without moving onset', () => {
    const { m, t } = run([session(RAN_ON)], { use: [[at(22, 40), at(22, 55)]] });
    expect(m.sleepOnset).toBe(at(23, 0));
    expect(t.lastUseBeforeSleep).toBe(at(22, 55));
  });
});

describe('wake-ups during the night', () => {
  const NIGHT: Seg[] = [
    ['awake', [22, 50], [23, 0]],
    ['light', [23, 0], [23, 20]],
    ['deep', [23, 20], [0, 30]],
    ['light', [0, 30], [2, 30]],
    ['light', [2, 30], [3, 10]],
    ['awake', [3, 10], [3, 24]], // got up: steps
    ['light', [3, 24], [4, 0]],
    ['awake', [4, 0], [4, 2]], // 2 min in bed: too short to list
    ['light', [4, 2], [5, 0]],
    ['awake', [5, 0], [5, 3]], // two short stretches 1 min apart: one wake-up
    ['light', [5, 3], [5, 4]],
    ['awake', [5, 4], [5, 7]],
    ['rem', [5, 7], [6, 50]],
    ['awake', [6, 50], [7, 0]],
  ];

  it('lists each awakening, whether you got up, and merges tiny gaps', () => {
    const { m, t } = run([session(NIGHT)], { steps: walk(3, 10, 40), use: [[at(1, 30), at(1, 30)]] });
    expect(t.episodes).toEqual([
      { start: at(1, 30), end: at(1, 32), minutes: 2, up: true, steps: 0, usedEepy: true },
      { start: at(3, 10), end: at(3, 24), minutes: 14, up: true, steps: 40, usedEepy: false },
      { start: at(5, 0), end: at(5, 7), minutes: 7, up: false, steps: 0, usedEepy: false },
    ]);
    // eepy at 01:30 (the watch said light sleep) counts as 2 min awake.
    expect(m.wasoMin).toBe(computeSessionMetrics(session(NIGHT))!.wasoMin + 2);
  });
});

describe('asks when nothing was detected but the wake-up is unusually late', () => {
  it('flags a 09:30 wake-up after a week of 07:00 workday mornings', () => {
    const sessions: SleepSession[] = [];
    for (let d = 14; d >= 1; d--) sessions.push({ ...night(addDays(EVE, -d), 23 * 60, 8, { id: `hc:${d}` }), source: 'health-connect' });
    const late = { ...night(EVE, 23 * 60, 10.5, { id: 'hc:late' }), source: 'health-connect' as const };
    const r = correctedMetrics(dataset([...sessions, late]), [...sessions, late]);
    expect(r.timelines['hc:late'].askLate).toBe(true);
    expect(r.timelines['hc:late'].usualWakeMin).toBe(7 * 60);
    expect(r.timelines['hc:1'].askLate).toBe(false);
  });
});

describe('analyze() uses the corrected night everywhere', () => {
  function week(extra: Extra) {
    const sessions: SleepSession[] = [];
    for (let d = 10; d >= 1; d--) sessions.push({ ...night(addDays(EVE, -d), 23 * 60, 8, { id: `hc:${d}` }), source: 'health-connect' });
    sessions.push(session(RAN_ON));
    const data = dataset(sessions, extra);
    data.profile = profile({ sleepNeedOverrideMin: 540 });
    return analyze(data, at(10, 0));
  }

  it('total sleep, wake time, score and debt follow the cut', () => {
    const plain = week({ detect: false });
    const fixed = week({ use: [[at(7, 40), at(7, 45)]], steps: walk(7, 40, 130, 100) });
    expect(plain.lastNight!.main!.totalSleepMin - fixed.lastNight!.main!.totalSleepMin).toBe(92);
    expect(fixed.wakeTime).toBe(at(7, 20));
    expect(plain.wakeTime).toBe(at(9, 12));
    expect(fixed.timelines['hc:night'].trimmedMin).toBe(92);
    expect(fixed.debt.debtMin).toBeGreaterThan(plain.debt.debtMin);
    expect(fixed.scores['hc:night'].total).not.toBe(plain.scores['hc:night'].total);
    expect(fixed.metrics.find((m) => m.id === 'hc:night')!.end).toBe(at(7, 40));
  });
});

describe('demo data', () => {
  it('has a night where the watch ran on, cut back to the night the demo was built on', () => {
    const early = generateDemoData(atMinutes(WAKE_DAY, 8 * 60)); // before the run-on tail exists
    const late = generateDemoData(atMinutes(WAKE_DAY, 10 * 60));
    const id = `demo-${WAKE_DAY}`;
    const raw = late.sessions.find((x) => x.id === id)!;
    expect(raw.end - early.sessions.find((x) => x.id === id)!.end).toBe(80 * MINUTE);
    const a = correctedMetrics(late, late.sessions);
    const b = correctedMetrics(early, early.sessions);
    const ma = a.metrics.find((x) => x.id === id)!;
    const mb = b.metrics.find((x) => x.id === id)!;
    expect([ma.end, ma.finalWake, ma.totalSleepMin, ma.sleepOnset]).toEqual([mb.end, mb.finalWake, mb.totalSleepMin, mb.sleepOnset]);
    expect(a.timelines[id]).toMatchObject({ trimmedMin: 80, upEvidence: ['opened eepy', '230 steps'], outOfBed: { source: 'app', confidence: 'high' } });
    // Other demo nights are untouched; eepy was last used just before bed.
    const other = a.timelines[`demo-${addDays(WAKE_DAY, -3)}`];
    expect(other).toMatchObject({ trimmedMin: 0, onsetShiftMin: 0 });
    expect(other.lastUseBeforeSleep).toBeDefined();
  });
});

describe('the wake log', () => {
  it('remembers eepy use in the evening, at night and in the morning only', () => {
    expect(inUseWindow(at(14, 0))).toBe(false);
    expect(logAppUse(EMPTY_WAKE_LOG, at(14, 0), at(14, 5))).toBe(EMPTY_WAKE_LOG);
    const a = logAppUse(EMPTY_WAKE_LOG, at(23, 0), at(23, 0));
    expect(a.use).toEqual([[at(23, 0), at(23, 0)]]);
    // Leaving the app extends the same visit; coming back within 5 min joins it.
    const b = logAppUse(a, at(23, 0), at(23, 12));
    const c = logAppUse(b, at(23, 15), at(23, 15));
    expect(c.use).toEqual([[at(23, 0), at(23, 15)]]);
    expect(logAppUse(c, at(23, 0), at(23, 10))).toBe(c);
    const d = logAppUse(c, at(7, 40), at(7, 40));
    expect(d.use).toHaveLength(2);
    // Old entries fall off after WAKE_LOG_DAYS.
    const later = at(7, 0) + (WAKE_LOG_DAYS + 1) * DAY;
    expect(logAppUse(d, later, later).use).toEqual([[later, later]]);
  });

  it('records "I\'m up" once and keeps corrections by night', () => {
    const a = logUp(EMPTY_WAKE_LOG, at(7, 0));
    expect(logUp(a, at(7, 0))).toBe(a);
    const f = withFix(a, 'x', { wake: at(7, 0), at: 1 });
    expect(f.fixes.x.wake).toBe(at(7, 0));
    expect(withFix(f, 'x', undefined).fixes).toEqual({});
  });
});
