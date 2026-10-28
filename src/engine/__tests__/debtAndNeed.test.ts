import { analyzeSessions, buildNights } from '../sessions';
import { computeSleepDebt, debtCategory, nightWeight } from '../sleepDebt';
import { ageBaseline, energyEvidence, estimateSleepNeed } from '../sleepNeed';
import { addDays, weekdayOfKey } from '../time';
import { DayLog } from '../types';
import { night, profile } from './helpers';

const END = '2026-10-28';

function nightsOf(hoursFor: (wakeDate: string, i: number) => number | null, n = 28) {
  const sessions = [];
  for (let i = n; i >= 1; i--) {
    const wakeDate = addDays(END, -i + 1);
    const h = hoursFor(wakeDate, i);
    if (h === null) continue;
    sessions.push(night(addDays(wakeDate, -1), 23 * 60, h, { latencyMin: 0, staged: false }));
  }
  return buildNights(analyzeSessions(sessions));
}

describe('sleep debt', () => {
  it('weights recent nights more', () => {
    expect(nightWeight(0)).toBe(1);
    expect(nightWeight(13)).toBeCloseTo(0.35);
  });

  it('accumulates a constant nightly deficit across the 14-night window', () => {
    const nights = nightsOf(() => 7);
    const r = computeSleepDebt(nights, 8 * 60, END);
    let expected = 0;
    for (let i = 0; i < 14; i++) expected += nightWeight(i) * 60;
    expect(r.debtMin).toBeCloseTo(expected, 0);
    expect(r.coverage).toBe(1);
    expect(r.category).toBe('high');
    expect(r.payoff!.nights).toBeGreaterThan(0);
  });

  it('ignores missing nights instead of counting them as zero sleep', () => {
    const nights = nightsOf((_, i) => (i % 2 === 0 ? null : 8));
    const r = computeSleepDebt(nights, 8 * 60, END);
    expect(r.debtMin).toBe(0);
    expect(r.coverage).toBeCloseTo(0.5);
  });

  it('caps how much a long night can repay', () => {
    const nights = nightsOf((d) => (d === END ? 14 : 7));
    const capped = computeSleepDebt(nights, 8 * 60, END).debtMin;
    const allShort = computeSleepDebt(nightsOf(() => 7), 8 * 60, END).debtMin;
    // A 14h night repays at most 2h beyond need (+1h deficit avoided) on the most recent night.
    expect(allShort - capped).toBeCloseTo(180, 0);
  });

  it('maps hours to categories', () => {
    expect(debtCategory(10)).toBe('none');
    expect(debtCategory(90)).toBe('low');
    expect(debtCategory(4 * 60)).toBe('moderate');
    expect(debtCategory(7 * 60)).toBe('high');
    expect(debtCategory(12 * 60)).toBe('severe');
  });
});

describe('sleep need', () => {
  it('uses the age-group guideline when there is no personal evidence', () => {
    const r = estimateSleepNeed({ nights: [], dayLogs: {}, profile: profile({ birthYear: 1996 }), asOfDate: END });
    expect(r.method).toBe('age');
    expect(r.needMin).toBe(ageBaseline(30).meanMin);
    expect(r.confidence).toBe('low');
  });

  it('learns a longer need from nights without an alarm', () => {
    // Workdays 7h, free days 9h20 (natural wake).
    const p = profile({ birthYear: 1996 });
    const nights = nightsOf((d) => (p.workdays.includes(weekdayOfKey(d)) ? 7 : 9 + 1 / 3), 42);
    const dayLogs: Record<string, DayLog> = {};
    for (const n of nights) dayLogs[n.wakeDate] = { date: n.wakeDate, tags: [], wokeNaturally: !p.workdays.includes(weekdayOfKey(n.wakeDate)) };
    const r = estimateSleepNeed({ nights, dayLogs, profile: p, asOfDate: END });
    expect(r.method).toBe('personalized');
    expect(r.naturalNightsUsed).toBeGreaterThanOrEqual(10);
    expect(r.needMin).toBeGreaterThan(8 * 60);
    expect(r.needMin).toBeLessThan(9 * 60 + 20);
  });

  it('respects a manual override', () => {
    const r = estimateSleepNeed({ nights: [], dayLogs: {}, profile: profile({ sleepNeedOverrideMin: 510 }), asOfDate: END });
    expect(r.method).toBe('override');
    expect(r.needMin).toBe(510);
  });

  it('finds the knee in an energy dose–response curve', () => {
    const hours = [5.5, 6, 6.25, 6.5, 6.75, 7, 7.25, 7.5, 7.75, 8, 8.25, 8.5, 8.75, 9, 9.25, 6.2, 7.1, 8.1, 8.9, 5.8];
    const nights = nightsOf((_, i) => hours[i % hours.length], 40);
    const logs: Record<string, DayLog> = {};
    for (const n of nights) {
      const tst = n.main!.totalSleepMin;
      logs[n.wakeDate] = { date: n.wakeDate, tags: [], energy: 1 + (4 * Math.min(tst, 465) - 4 * 330) / (465 - 330) };
    }
    const ev = energyEvidence(nights, logs)!;
    expect(ev).toBeDefined();
    expect(Math.abs(ev.estimateMin - 465)).toBeLessThanOrEqual(15);
  });
});
