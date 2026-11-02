/**
 * Wake-up detection with the sleep session's taps (engine/wakeDetect.ts rules 14–15): "I'm in bed"
 * starts time in bed and keeps sleep onset after it; "I'm up" is a strong sign of getting up, with
 * the same went-back-to-sleep guard as every interaction.
 */
import { computeSessionMetrics } from '../sessions';
import { atMinutes, MINUTE } from '../time';
import type { NightFix, NightVitals, SleepDataset, SleepSession, Stage, StageSegment, WakeLog } from '../types';
import { correctedMetrics, EMPTY_WAKE_LOG, logInBed, logOutOfBed, unlogInBed, unlogOutOfBed, WAKE_LOG_DAYS } from '../wakeDetect';
import { profile } from './helpers';

const EVE = '2026-10-20'; // Tuesday evening → Wednesday morning (a workday)
const WAKE_DAY = '2026-10-21';
/** Clock time on the evening (h ≥ 12) or the next morning (h < 12). */
const at = (h: number, m = 0) => (h >= 12 ? atMinutes(EVE, h * 60 + m) : atMinutes(WAKE_DAY, h * 60 + m));

type Seg = [Stage, [number, number], [number, number]];
function session(segs: Seg[], over: Partial<SleepSession> = {}): SleepSession {
  const stages: StageSegment[] = segs.map(([stage, a, b]) => ({ stage, start: at(...a), end: at(...b) }));
  return { id: 'hc:night', source: 'health-connect', start: stages[0].start, end: stages[stages.length - 1].end, stages, ...over };
}

/** Recording from 23:30 (asleep 23:40, deep from 00:10) to 07:00; the last REM ends 06:30. */
const NIGHT: Seg[] = [
  ['awake', [23, 30], [23, 40]],
  ['light', [23, 40], [0, 10]],
  ['deep', [0, 10], [0, 50]],
  ['light', [0, 50], [1, 30]],
  ['rem', [1, 30], [1, 50]],
  ['light', [1, 50], [2, 40]],
  ['deep', [2, 40], [3, 0]],
  ['light', [3, 0], [4, 0]],
  ['rem', [4, 0], [4, 30]],
  ['light', [4, 30], [6, 0]],
  ['rem', [6, 0], [6, 30]],
  ['light', [6, 30], [7, 0]],
];

/** The same night, but the watch keeps "sleeping" (light) until 09:00 after the last REM. */
const RAN_ON: Seg[] = [...NIGHT.slice(0, -1), ['light', [6, 30], [9, 0]]];

interface Extra {
  inBed?: number[];
  outOfBed?: number[];
  use?: [number, number][];
  fixes?: Record<string, NightFix>;
  detect?: boolean;
  steps?: [number, number][];
}

function run(sessions: SleepSession[], x: Extra = {}) {
  const s0 = sessions[sessions.length - 1];
  const v: NightVitals = { sessionId: s0.id };
  if (x.steps) v.stepCurve = x.steps.map(([t, n]): [number, number] => [Math.round((t - s0.start) / MINUTE), n]);
  const wakeLog: WakeLog = { ...EMPTY_WAKE_LOG, inBed: x.inBed ?? [], outOfBed: x.outOfBed ?? [], use: x.use ?? [], fixes: x.fixes ?? {}, detect: x.detect ?? true };
  const data: SleepDataset = { sessions, vitals: { [s0.id]: v }, daily: {}, dayLogs: {}, caffeine: [], profile: profile(), checkins: [], wakeLog };
  const r = correctedMetrics(data, sessions);
  const m = r.metrics.find((y) => y.id === s0.id)!;
  return { m, t: r.timelines[m.id] };
}

describe('"I\'m in bed" starts time in bed', () => {
  it('before the recording: the night starts at the tap, awake in bed until the watch saw sleep', () => {
    const recorded = computeSessionMetrics(session(NIGHT))!;
    const { m, t } = run([session(NIGHT)], { inBed: [at(23, 5)] });
    expect(t.inBed).toEqual({ time: at(23, 5), source: 'inbed', confidence: 'high' });
    expect(m.start).toBe(at(23, 5));
    expect(m.sleepOnset).toBe(at(23, 40)); // the watch's onset is after the tap: kept
    expect(m.latencyMin).toBe(35);
    expect(m.timeInBedMin).toBe(recorded.timeInBedMin + 25);
    expect(m.totalSleepMin).toBe(recorded.totalSleepMin);
    expect(m.efficiency).toBeLessThan(recorded.efficiency);
    expect(t.recorded.start).toBe(at(23, 30));
  });

  it('you were awake at the tap: sleep onset is never before it (+ a few minutes)', () => {
    // The watch said asleep at 23:40, but you tapped "I'm in bed" at 23:50.
    const { m, t } = run([session(NIGHT)], { inBed: [at(23, 50)] });
    expect(m.start).toBe(at(23, 50));
    expect(m.sleepOnset).toBe(at(23, 55));
    expect(t.asleep).toEqual({ time: at(23, 55), source: 'inbed', confidence: 'high' });
    expect(t.onsetShiftMin).toBe(15);
    expect(t.onsetEvidence[0]).toBe('you tapped In bed');
    // What the watch recorded before the tap isn't time in bed (or sleep).
    expect(m.segments[0]).toEqual({ stage: 'awake', start: at(23, 50), end: at(23, 55) });
    expect(m.latencyMin).toBe(5);
  });

  it('a tap right at the recorded onset still leaves a few minutes to fall asleep', () => {
    const { m } = run([session(NIGHT)], { inBed: [at(23, 40)] });
    expect(m.sleepOnset).toBe(at(23, 45));
  });

  it('uses the latest tap, and ignores taps that cannot be this night\'s start', () => {
    expect(run([session(NIGHT)], { inBed: [at(22, 0), at(23, 10)] }).m.start).toBe(at(23, 10));
    // More than 3 h before the recording.
    expect(run([session(NIGHT)], { inBed: [at(20, 0)] }).t.inBed.source).toBe('watch');
    // After deep sleep had started: you were asleep, the tap is off.
    const late = run([session(NIGHT)], { inBed: [at(0, 30)] });
    expect(late.m.start).toBe(at(23, 30));
    expect(late.m.sleepOnset).toBe(at(23, 40));
    // Detection switched off: taps are evidence like the rest.
    expect(run([session(NIGHT)], { inBed: [at(23, 5)], detect: false }).m.start).toBe(at(23, 30));
  });

  it('a fell-asleep time you set before the tap wins', () => {
    const { m, t } = run([session(NIGHT)], { inBed: [at(23, 50)], fixes: { 'hc:night': { asleep: at(23, 35), at: 0 } } });
    expect(m.sleepOnset).toBe(at(23, 35));
    expect(t.inBed.source).toBe('watch');
  });

  it('other awake evidence after the tap still counts (onset at the later of the two)', () => {
    const { m, t } = run([session(NIGHT)], { inBed: [at(23, 20)], use: [[at(23, 45), at(23, 58)]] });
    expect(m.start).toBe(at(23, 20));
    expect(m.sleepOnset).toBe(at(23, 58));
    expect(t.asleep.source).toBe('app');
  });
});

describe('"I\'m up" is a strong sign of getting up', () => {
  it('cuts a night the watch kept recording, with high confidence', () => {
    const { m, t } = run([session(RAN_ON)], { outOfBed: [at(7, 10)] });
    expect(m.end).toBe(at(7, 10));
    expect(t.outOfBed).toEqual({ time: at(7, 10), source: 'up', confidence: 'high' });
    expect(t.upEvidence).toContain("you tapped I'm up");
    expect(t.trimmedMin).toBe(110);
  });

  it('is ignored when you went back to sleep after it (deep/REM followed)', () => {
    const { m, t } = run([session(RAN_ON)], { outOfBed: [at(5, 40)] });
    expect(m.end).toBe(at(9, 0));
    expect(t.trimmedMin).toBe(0);
    // A later "I'm up" is the real one.
    expect(run([session(RAN_ON)], { outOfBed: [at(5, 40), at(7, 30)] }).m.end).toBe(at(7, 30));
  });

  it('needs no second sign on a night without stages (you said so)', () => {
    const unstaged = session([['awake', [23, 30], [23, 40]], ['asleep', [23, 40], [9, 0]]]);
    expect(run([unstaged], { outOfBed: [at(7, 10)] }).m.end).toBe(at(7, 10));
    // eepy use alone would need corroboration there.
    expect(run([unstaged], { use: [[at(7, 10), at(7, 11)]] }).m.end).toBe(at(9, 0));
  });

  it('a little after the recording ended, with no walking in between: awake in bed until the tap', () => {
    const recorded = computeSessionMetrics(session(NIGHT))!;
    const { m, t } = run([session(NIGHT)], { outOfBed: [at(7, 25)] });
    expect(m.end).toBe(at(7, 25));
    expect(m.finalWake).toBe(recorded.finalWake);
    expect(m.totalSleepMin).toBe(recorded.totalSleepMin);
    expect(m.timeInBedMin).toBe(recorded.timeInBedMin + 25);
    expect(t.outOfBed).toEqual({ time: at(7, 25), source: 'up', confidence: 'high' });
    expect(t.trimmedMin).toBe(0);
    // Walking about first: you got up earlier and tapped later — the recording stands.
    expect(run([session(NIGHT)], { outOfBed: [at(7, 25)], steps: [[at(7, 0), 80]] }).m.end).toBe(at(7, 0));
    // Long after: not this night's getting up.
    expect(run([session(NIGHT)], { outOfBed: [at(8, 0)] }).m.end).toBe(at(7, 0));
  });

  it('both taps together: in bed → up is the night', () => {
    const { m, t } = run([session(RAN_ON)], { inBed: [at(23, 12)], outOfBed: [at(7, 5)] });
    expect([m.start, m.end]).toEqual([at(23, 12), at(7, 5)]);
    expect([t.inBed.source, t.outOfBed.source]).toEqual(['inbed', 'up']);
  });
});

describe('the tap log', () => {
  it('keeps taps once, for 60 days, and forgets an undone one', () => {
    const t = at(23, 42);
    let log = logInBed(EMPTY_WAKE_LOG, t);
    expect(log.inBed).toEqual([t]);
    expect(logInBed(log, t)).toBe(log);
    log = logInBed(log, t + (WAKE_LOG_DAYS + 1) * 24 * 60 * MINUTE);
    expect(log.inBed).toEqual([t + (WAKE_LOG_DAYS + 1) * 24 * 60 * MINUTE]);
    expect(unlogInBed(log, 123)).toBe(log);
    expect(unlogInBed(log, log.inBed![0]).inBed).toEqual([]);
    const up = logOutOfBed({ ...EMPTY_WAKE_LOG, outOfBed: undefined }, t);
    expect(up.outOfBed).toEqual([t]);
    expect(unlogOutOfBed(up, t).outOfBed).toEqual([]);
    expect(unlogOutOfBed(up, undefined)).toBe(up);
  });
});
