import { analyze } from '../analysis';
import {
  adjustCbtiWindow,
  CBTI_GENTLE_MIN_WINDOW_MIN,
  CBTI_LESSONS,
  CBTI_MIN_WINDOW_MIN,
  CbtiProgram,
  cbtiBaseline,
  cbtiSafety,
  cbtiStatus,
  cbtiTimeline,
  cbtiWeekNumber,
  cbtiWeekRange,
  currentCbtiWindow,
  lessonForWeek,
  nextAdjustment,
  nightEfficiency,
  startCbtiProgram,
  stimulusControlRules,
} from '../cbti';
import { planTonight } from '../schedule';
import { analyzeSessions, buildNights, Night } from '../sessions';
import { addDays, atMinutes, formatTime, HOUR, MINUTE } from '../time';
import type { SleepSession } from '../types';
import { night, profile } from './helpers';

const START = '2026-10-05'; // a Monday evening
const WAKE = 6 * 60 + 30;
/** Sleep onset 00:30, after midnight. */
const LATE = 24 * 60 + 30;

/**
 * Nights for a list of evenings: asleep `hours`, with `latencyMin` awake in bed first, so
 * efficiency = hours·60 / (hours·60 + latency).
 */
function sessions(evenings: string[], hours: number, latencyMin: number, onsetMin = 23 * 60 + 30): SleepSession[] {
  return evenings.map((e) => night(e, onsetMin, hours, { latencyMin, kind: 'main' }));
}

function toNights(s: SleepSession[]): Night[] {
  return buildNights(analyzeSessions(s));
}

const evenings = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

/** Latency giving a target efficiency for a 6h night. */
const latencyFor = (eff: number, hours = 6) => Math.round((hours * 60) / eff - hours * 60);

function program(over: Partial<CbtiProgram> = {}): CbtiProgram {
  return { active: true, startedAt: START, wakeMin: WAKE, windowMin: 360, weeks: [], ...over };
}

describe('CBT-I baseline', () => {
  it('starts the window at the average sleep of the recorded nights, rounded to 15 min', () => {
    const n = toNights(sessions(evenings('2026-09-21', 14), 6, 30));
    const b = cbtiBaseline(n, START);
    expect(b.nights).toBe(14);
    expect(b.enough).toBe(true);
    expect(b.avgSleepMin).toBeCloseTo(360, 0);
    expect(b.avgInBedMin).toBeCloseTo(390, 0);
    expect(b.efficiency).toBeCloseTo(360 / 390, 3);
    expect(b.windowMin).toBe(360);
  });

  it('rounds to the nearest 15 minutes', () => {
    const n = toNights(sessions(evenings('2026-09-21', 10), 5 + 10 / 60, 20));
    expect(cbtiBaseline(n, START).windowMin).toBe(315);
  });

  it('never starts below 5h (or the gentler 6h floor)', () => {
    const n = toNights(sessions(evenings('2026-09-21', 10), 4.25, 60));
    expect(cbtiBaseline(n, START).windowMin).toBe(CBTI_MIN_WINDOW_MIN);
    expect(cbtiBaseline(n, START, CBTI_GENTLE_MIN_WINDOW_MIN).windowMin).toBe(360);
  });

  it('uses only the 14 most recent nights from the last four weeks', () => {
    const old = sessions(evenings('2026-09-01', 6), 9, 10); // long nights, outside the last 14
    const recent = sessions(evenings('2026-09-21', 14), 6, 30);
    const b = cbtiBaseline(toNights([...old, ...recent]), START);
    expect(b.nights).toBe(14);
    expect(b.windowMin).toBe(360);
    const stale = cbtiBaseline(toNights(sessions(evenings('2026-08-01', 10), 6, 30)), START);
    expect(stale.nights).toBe(0);
    expect(stale.enough).toBe(false);
  });

  it('needs at least 7 recorded nights', () => {
    expect(cbtiBaseline(toNights(sessions(evenings('2026-09-28', 6), 6, 30)), START).enough).toBe(false);
    expect(cbtiBaseline(toNights(sessions(evenings('2026-09-28', 7), 6, 30)), START).enough).toBe(true);
  });

  it('ignores naps', () => {
    const main = sessions(evenings('2026-09-21', 10), 6, 30);
    const naps: SleepSession[] = evenings('2026-09-22', 10).map((d) => ({
      id: `nap-${d}`,
      source: 'manual',
      start: atMinutes(d, 14 * 60),
      end: atMinutes(d, 15 * 60),
      stages: [],
      kind: 'nap',
    }));
    expect(cbtiBaseline(toNights([...main, ...naps]), START).avgSleepMin).toBeCloseTo(360, 0);
  });

  it('creates a programme anchored to the chosen wake time', () => {
    const n = toNights(sessions(evenings('2026-09-21', 14), 6.25, 30));
    const p = startCbtiProgram({ nights: n, today: START, wakeMin: WAKE });
    expect(p).toMatchObject({ active: true, startedAt: START, wakeMin: WAKE, windowMin: 375, weeks: [], minWindowMin: 300 });
    expect(p.baseline?.nights).toBe(14);
    const w = currentCbtiWindow(p, n, START)!;
    expect(w.bedMin).toBe(15); // 00:15
    expect(w.wakeMin).toBe(WAKE);
    expect(w.reason).toMatch(/^Week 1 of your insomnia programme: in bed 00:15–06:30 \(6h 15m\)\./);
  });
});

describe('CBT-I weeks', () => {
  it('numbers weeks from the first evening, robust to DST', () => {
    const p = program();
    expect(cbtiWeekNumber(p, START)).toBe(1);
    expect(cbtiWeekNumber(p, addDays(START, 6))).toBe(1);
    expect(cbtiWeekNumber(p, addDays(START, 7))).toBe(2);
    expect(cbtiWeekNumber(p, addDays(START, 13))).toBe(2);
    expect(cbtiWeekNumber(p, addDays(START, 14))).toBe(3);
    expect(cbtiWeekNumber(p, addDays(START, -3))).toBe(1);
    // Spans the end of daylight saving time (1 Nov 2026 in America/Chicago).
    const dst = program({ startedAt: '2026-10-28' });
    expect(cbtiWeekNumber(dst, '2026-11-03')).toBe(1);
    expect(cbtiWeekNumber(dst, '2026-11-04')).toBe(2);
    expect(cbtiWeekRange(dst, 2)).toEqual({ startEvening: '2026-11-04', endEvening: '2026-11-10' });
  });

  it('titrates by sleep efficiency at the documented thresholds', () => {
    expect(nextAdjustment(0.9, 7, 360)).toMatchObject({ deltaMin: 15, verdict: 'expand' });
    expect(nextAdjustment(0.95, 7, 360)).toMatchObject({ deltaMin: 15, verdict: 'expand' });
    expect(nextAdjustment(0.8999, 7, 360)).toMatchObject({ deltaMin: 0, verdict: 'hold' });
    expect(nextAdjustment(0.85, 7, 360)).toMatchObject({ deltaMin: 0, verdict: 'hold' });
    expect(nextAdjustment(0.8499, 7, 360)).toMatchObject({ deltaMin: -15, verdict: 'shrink' });
    expect(nextAdjustment(0.6, 7, 360).reason).toMatch(/under 85%/);
  });

  it('never goes below the 5h floor or above 9h, and needs 4 nights to act', () => {
    expect(nextAdjustment(0.7, 7, 300)).toMatchObject({ deltaMin: 0, verdict: 'hold' });
    expect(nextAdjustment(0.7, 7, 300).reason).toMatch(/minimum/);
    expect(nextAdjustment(0.7, 7, 360, 360)).toMatchObject({ deltaMin: 0 });
    expect(nextAdjustment(0.95, 7, 540)).toMatchObject({ deltaMin: 0, verdict: 'hold' });
    expect(nextAdjustment(0.95, 3, 360)).toMatchObject({ deltaMin: 0, verdict: 'insufficient' });
    expect(nextAdjustment(undefined, 0, 360).reason).toMatch(/Only 0 nights/);
  });

  it('computes nightly efficiency as time asleep over time in bed', () => {
    const [n] = toNights(sessions([START], 6, 40));
    expect(nightEfficiency(n)).toBeCloseTo(360 / 400, 4);
    expect(nightEfficiency({ wakeDate: START, naps: [], totalSleepMin: 0 })).toBeUndefined();
  });

  it('adds 15 min after a week at 90%+ and removes 15 min after a week under 85%', () => {
    // Week 1 at ~92% efficiency, week 2 at ~80%.
    const s = [
      ...sessions(evenings(START, 7), 6, latencyFor(0.92), LATE),
      ...sessions(evenings(addDays(START, 7), 7), 6, latencyFor(0.8), LATE),
    ];
    const n = toNights(s);
    const p = program();

    const week2 = addDays(START, 7);
    const w2 = currentCbtiWindow(p, n, week2)!;
    expect(w2.bedMin).toBe(15); // 6h15 before 06:30
    expect(w2.reason).toMatch(/^Week 2 of your insomnia programme: in bed 00:15–06:30 \(6h 15m\)\./);
    expect(w2.reason).toMatch(/15 min more than last week: your sleep efficiency was 92%/);

    const week3 = addDays(START, 14);
    const w3 = currentCbtiWindow(p, n, week3)!;
    expect(w3.bedMin).toBe(30); // back to 6h
    expect(w3.reason).toMatch(/^Week 3 .*in bed 00:30–06:30 \(6h 00m\)\. 15 min less than last week: your sleep efficiency was 80%/);

    const tl = cbtiTimeline(p, n, week3);
    expect(tl.map((w) => w.week)).toEqual([1, 2, 3]);
    expect(tl.map((w) => w.windowMin)).toEqual([360, 375, 360]);
    expect(tl[0]).toMatchObject({ complete: true, nightsRecorded: 7, adjustment: { verdict: 'expand' } });
    expect(tl[1]).toMatchObject({ complete: true, nightsRecorded: 7, adjustment: { verdict: 'shrink' } });
    expect(tl[2]).toMatchObject({ complete: false, nightsRecorded: 0, adjustment: { verdict: 'insufficient' } });
  });

  it('keeps the window when efficiency is 85–90% or too few nights were recorded', () => {
    const s = [...sessions(evenings(START, 7), 6, latencyFor(0.875), LATE), ...sessions(evenings(addDays(START, 7), 3), 6, latencyFor(0.95), LATE)];
    const n = toNights(s);
    const w2 = currentCbtiWindow(program(), n, addDays(START, 7))!;
    expect(w2.bedMin).toBe(30);
    expect(w2.reason).toMatch(/Same as last week \(sleep efficiency 88%\)/);
    const w3 = currentCbtiWindow(program(), n, addDays(START, 14))!;
    expect(w3.bedMin).toBe(30);
    expect(w3.reason).toMatch(/too few nights/);
  });

  it('compounds over the programme and keeps titrating in maintenance', () => {
    const n = toNights(sessions(evenings(START, 56), 6, latencyFor(0.93), LATE));
    const s = cbtiStatus(program(), n, addDays(START, 56));
    expect(s.week).toBe(9);
    expect(s.maintenance).toBe(true);
    expect(s.windowMin).toBe(360 + 8 * 15);
    expect(s.reason).toMatch(/^Week 9 of your insomnia programme \(maintenance\)/);
    expect(s.lesson.id).toBe('maintenance');
  });

  it('holds at the 5h floor', () => {
    const n = toNights(sessions(evenings(START, 21), 4, 90, 1440 + 60));
    const s = cbtiStatus(program({ windowMin: 300 }), n, addDays(START, 21));
    expect(s.windowMin).toBe(300);
    expect(s.reason).toMatch(/minimum window/);
    const gentle = cbtiStatus(program({ windowMin: 300, minWindowMin: 360 }), n, addDays(START, 21));
    expect(gentle.windowMin).toBe(360);
  });

  it('is pure: same inputs, same output, and the programme is not mutated', () => {
    const n = toNights(sessions(evenings(START, 14), 6, latencyFor(0.92), LATE));
    const p = program({ weeks: [{ weekStart: addDays(START, 9), windowMin: 405 }] });
    const frozen = JSON.parse(JSON.stringify(p));
    const a = currentCbtiWindow(p, n, addDays(START, 14));
    const b = currentCbtiWindow(p, n, addDays(START, 14));
    expect(a).toEqual(b);
    expect(p).toEqual(frozen);
  });

  it('returns nothing for a missing or stopped programme', () => {
    expect(currentCbtiWindow(undefined, [], START)).toBeUndefined();
    expect(currentCbtiWindow(program({ active: false }), [], START)).toBeUndefined();
  });

  it('applies a manual change from its evening and titrates from it', () => {
    const n = toNights(sessions(evenings(START, 14), 6, latencyFor(0.87), LATE));
    const p = program();
    const mid = addDays(START, 3);
    const adjusted = adjustCbtiWindow(p, n, mid, 15);
    expect(adjusted.weeks).toEqual([{ weekStart: mid, windowMin: 375, efficiency: expect.any(Number) }]);
    expect(p.weeks).toEqual([]);
    expect(currentCbtiWindow(adjusted, n, mid)!.bedMin).toBe(15);
    // Earlier nights of the week keep the old window.
    const s = cbtiStatus(adjusted, n, addDays(START, 7));
    expect(s.nights.find((x) => x.evening === START)!.windowMin).toBe(360);
    expect(s.nights.find((x) => x.evening === mid)!.windowMin).toBe(375);
    // 87% → hold, so week 2 continues at the adjusted 6h15.
    expect(s.windowMin).toBe(375);
    expect(s.weeks[0].windowMin).toBe(375);
    // Adjusting twice on the same evening replaces the change.
    expect(adjustCbtiWindow(adjusted, n, mid, 15).weeks).toHaveLength(1);
    const s2 = cbtiStatus(adjustCbtiWindow(p, n, addDays(START, 8), 15), n, addDays(START, 8));
    expect(s2.reason).toMatch(/You adjusted it by \+15 min this week/);
  });

  it('counts nights kept inside the window', () => {
    // Window 00:30–06:30. Three nights in bed at 23:00 (too early), four in window.
    const early = sessions(evenings(START, 3), 6, 30, 23 * 60 + 30); // in bed 23:00, up 05:30
    const kept = sessions(evenings(addDays(START, 3), 4), 5.5, 15, 1440 + 45); // in bed 00:30, up 06:15
    const s = cbtiStatus(program(), toNights([...early, ...kept]), addDays(START, 7));
    expect(s.weeks[0].nightsRecorded).toBe(7);
    expect(s.weeks[0].nightsInWindow).toBe(4);
    expect(s.nights.filter((x) => x.week === 1).map((x) => x.inWindow)).toEqual([false, false, false, true, true, true, true]);
  });

  it('reports the review date and nights left in the week', () => {
    const s = cbtiStatus(program(), [], addDays(START, 2));
    expect(s.week).toBe(1);
    expect(s.daysLeftInWeek).toBe(5);
    expect(s.nextReviewDate).toBe(addDays(START, 7));
    expect(s.current.startEvening).toBe(START);
    expect(s.lesson.week).toBe(1);
  });

  it('feeds the planner: tonight is planned from the prescribed window', () => {
    const base = { profile: profile(), today: START, needMin: 480, debtMin: 0, efficiency: 0.9, latencyMin: 15 };
    const after = planTonight({ ...base, sleepWindow: { bedMin: 15, wakeMin: WAKE, reason: 'r' } });
    expect(formatTime(after.bedtime)).toBe('00:15');
    expect(formatTime(after.wake)).toBe('06:30');
    expect(after.inBedMin).toBe(375);
    expect(after.rationale).toEqual(['r']);
    const before = planTonight({ ...base, sleepWindow: { bedMin: 23 * 60 + 30, wakeMin: WAKE, reason: 'r' } });
    expect(before.inBedMin).toBe(420);
  });

  it('drives analyze() when a programme is active', () => {
    const now = atMinutes('2026-10-15', 12 * 60);
    const s = sessions(evenings('2026-09-21', 24), 6, latencyFor(0.92), LATE);
    const data = { sessions: s, vitals: {}, daily: {}, dayLogs: {}, caffeine: [], profile: profile() };
    const a = analyze(data, now, { cbti: program() });
    expect(a.tonight.inBedMin).toBe(375);
    expect(formatTime(a.tonight.bedtime)).toBe('00:15');
    expect(a.tonight.rationale[0]).toMatch(/^Week 2 of your insomnia programme/);
    expect(a.tonight.wake - a.tonight.bedtime).toBe(375 * MINUTE);
    expect(a.tonight.wake).toBe(atMinutes('2026-10-16', WAKE));
    expect(a.tonight.bedtime).toBeGreaterThan(now + 10 * HOUR);
  });
});

describe('CBT-I content', () => {
  it('has six weekly lessons in order', () => {
    expect(CBTI_LESSONS.map((l) => l.id)).toEqual(['restriction', 'stimulus', 'cognitive', 'relaxation', 'consolidation', 'maintenance']);
    CBTI_LESSONS.forEach((l, i) => {
      expect(l.week).toBe(i + 1);
      expect(l.points.length).toBeGreaterThanOrEqual(3);
      expect(l.practice.length).toBeGreaterThanOrEqual(1);
    });
    expect(lessonForWeek(0).week).toBe(1);
    expect(lessonForWeek(4).id).toBe('relaxation');
    expect(lessonForWeek(12).id).toBe('maintenance');
  });

  it('lists the stimulus-control rules with the wake time', () => {
    const rules = stimulusControlRules(WAKE);
    expect(rules.map((r) => r.id)).toEqual(['sleepy', 'bed-only', 'get-up', 'repeat', 'wake', 'no-naps']);
    expect(rules.find((r) => r.id === 'wake')!.title).toBe('Get up at 06:30 every day');
    expect(stimulusControlRules().find((r) => r.id === 'wake')!.title).toBe('Same wake time every day');
  });
});

describe('CBT-I safety', () => {
  const screened = (s: Record<string, { score: number; answers: number[] }>) => ({
    screenings: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, date: '2026-10-01' }])),
  });
  const clean = screened({ ess: { score: 6, answers: [] }, stopbang: { score: 1, answers: [1, 0, 0, 0, 0, 0, 0, 0] }, isi: { score: 17, answers: [] } });

  it('passes a screened user with no conditions', () => {
    const r = cbtiSafety(clean, {});
    expect(r.flags).toEqual([]);
    expect(r.needsClinician).toBe(false);
    expect(r.minWindowMin).toBe(CBTI_MIN_WINDOW_MIN);
  });

  it.each(['bipolar', 'epilepsy', 'apnoea', 'pregnancy'] as const)('needs a clinician for %s', (c) => {
    const r = cbtiSafety(clean, { [c]: true });
    expect(r.needsClinician).toBe(true);
    expect(r.flags).toEqual([expect.objectContaining({ id: c, severity: 'clinician' })]);
  });

  it('flags a high STOP-Bang risk as possible untreated apnoea', () => {
    const r = cbtiSafety(screened({ ess: { score: 5, answers: [] }, isi: { score: 16, answers: [] }, stopbang: { score: 5, answers: [1, 1, 1, 1, 1, 0, 0, 0] } }), {});
    expect(r.needsClinician).toBe(true);
    expect(r.flags[0]).toMatchObject({ id: 'stopbang', severity: 'clinician' });
    // The STOP rule: 2 of the first four plus male sex is high risk even at a score of 3.
    const stop = cbtiSafety(screened({ ess: { score: 5, answers: [] }, isi: { score: 16, answers: [] }, stopbang: { score: 3, answers: [1, 1, 0, 0, 0, 0, 0, 1] } }), {});
    expect(stop.flags.map((f) => f.id)).toEqual(['stopbang']);
    const mid = cbtiSafety(screened({ ess: { score: 5, answers: [] }, isi: { score: 16, answers: [] }, stopbang: { score: 3, answers: [1, 0, 0, 0, 0, 1, 0, 1] } }), {});
    expect(mid.flags).toEqual([]);
  });

  it('cautions and uses a gentler floor for sleepiness or safety-critical work', () => {
    const sleepy = cbtiSafety(screened({ ess: { score: 11, answers: [] }, stopbang: { score: 0, answers: [0, 0, 0, 0, 0, 0, 0, 0] }, isi: { score: 18, answers: [] } }), {});
    expect(sleepy.flags).toEqual([expect.objectContaining({ id: 'ess', severity: 'caution' })]);
    expect(sleepy.needsClinician).toBe(false);
    expect(sleepy.minWindowMin).toBe(CBTI_GENTLE_MIN_WINDOW_MIN);
    const ok = cbtiSafety(screened({ ess: { score: 10, answers: [] }, stopbang: { score: 0, answers: [0, 0, 0, 0, 0, 0, 0, 0] }, isi: { score: 18, answers: [] } }), {});
    expect(ok.flags).toEqual([]);
    const driver = cbtiSafety(clean, { alertness: true });
    expect(driver.flags.map((f) => f.id)).toEqual(['alertness']);
    expect(driver.minWindowMin).toBe(360);
  });

  it('suggests the missing self-checks', () => {
    const r = cbtiSafety({ screenings: {} }, {});
    expect(r.flags.map((f) => f.id)).toEqual(['ess-missing', 'stopbang-missing', 'isi-missing']);
    expect(r.flags.every((f) => f.severity === 'info')).toBe(true);
    expect(r.needsClinician).toBe(false);
    const low = cbtiSafety(screened({ ess: { score: 3, answers: [] }, stopbang: { score: 0, answers: [0, 0, 0, 0, 0, 0, 0, 0] }, isi: { score: 4, answers: [] } }), {});
    expect(low.flags.map((f) => f.id)).toEqual(['isi-low']);
  });
});
