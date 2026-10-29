import { detectRecoveryAlert } from '../recovery';
import { analyzeSessions, buildNights } from '../sessions';
import { gaussian, rng } from '../stats';
import { addDays } from '../time';
import type { DailyStats, NightVitals, SleepSession } from '../types';
import { night } from './helpers';

const TODAY = '2026-10-21';

/** 33 nights of stable vitals; `sick` overrides the last nights (keyed by days before TODAY). */
function dataset(sick: Record<number, Partial<NightVitals>> = {}, opts: { noVitalsHr?: boolean; days?: number } = {}) {
  const r = rng(11);
  const sessions: SleepSession[] = [];
  const vitals: Record<string, NightVitals> = {};
  const daily: Record<string, DailyStats> = {};
  const days = opts.days ?? 33;
  for (let i = days - 1; i >= 0; i--) {
    const wake = addDays(TODAY, -i);
    const id = `n-${wake}`;
    sessions.push(night(addDays(wake, -1), 23 * 60, 7.5, { id }));
    const v: NightVitals = {
      sessionId: id,
      hrMin: opts.noVitalsHr ? undefined : Math.round(gaussian(r, 52, 1.2)),
      hrvRmssd: Math.round(gaussian(r, 55, 4)),
      respRate: Math.round(gaussian(r, 14, 0.3) * 10) / 10,
      ...sick[i],
    };
    vitals[id] = v;
    daily[wake] = { date: wake, restingHr: Math.round(gaussian(r, 58, 1.2)) + (opts.noVitalsHr && sick[i]?.hrMin ? sick[i].hrMin! - 52 : 0) };
  }
  const nights = buildNights(analyzeSessions(sessions));
  return { nights, vitals, daily, asOfDate: TODAY };
}

describe('recovery early warning', () => {
  it('stays quiet when everything is normal', () => {
    expect(detectRecoveryAlert(dataset())).toBeUndefined();
  });

  it("raises a 'watch' when two signals are off on 2 of the last 3 nights", () => {
    const sick = { 0: { hrMin: 59, hrvRmssd: 38 }, 1: { hrMin: 58, hrvRmssd: 40 } };
    const alert = detectRecoveryAlert(dataset(sick))!;
    expect(alert.level).toBe('watch');
    expect(alert.nights).toEqual([addDays(TODAY, -1), TODAY]);
    const hr = alert.signals!.find((s) => s.key === 'hr')!;
    const hrv = alert.signals!.find((s) => s.key === 'hrv')!;
    expect(hr.off && hrv.off).toBe(true);
    expect(alert.signals!.find((s) => s.key === 'resp')!.off).toBe(false);
    expect(hr.delta).toBeGreaterThanOrEqual(5);
    expect(hrv.delta).toBeLessThan(-20);
    expect(alert.detail).toMatch(/^Resting HR up \d+ bpm and HRV down \d+% on 2 of the last 3 nights/);
    // Gentle, non-diagnostic copy.
    expect(alert.detail).toMatch(/Take it easy/);
    expect(alert.advice!.join(' ')).toMatch(/not a diagnosis/);
  });

  it("escalates to a 'warning' when all three are off", () => {
    const sick = { 0: { hrMin: 60, hrvRmssd: 36, respRate: 16 }, 1: { hrMin: 59, hrvRmssd: 39, respRate: 15.8 }, 2: { hrMin: 58 } };
    const alert = detectRecoveryAlert(dataset(sick))!;
    expect(alert.level).toBe('warning');
    expect(alert.detail).toMatch(/breathing 1\.\d\/min faster/);
    expect(alert.signals!.filter((s) => s.off)).toHaveLength(3);
  });

  it('ignores a single bad night or a single off signal', () => {
    expect(detectRecoveryAlert(dataset({ 0: { hrMin: 62, hrvRmssd: 30, respRate: 17 } }))).toBeUndefined();
    expect(detectRecoveryAlert(dataset({ 0: { hrMin: 60 }, 1: { hrMin: 60 } }))).toBeUndefined();
  });

  it('needs a personal baseline first', () => {
    const sick = { 0: { hrMin: 60, hrvRmssd: 36, respRate: 16 }, 1: { hrMin: 59, hrvRmssd: 39, respRate: 15.8 } };
    expect(detectRecoveryAlert(dataset(sick, { days: 8 }))).toBeUndefined();
  });

  it('falls back to the daily resting heart rate', () => {
    const sick = { 0: { hrMin: 59, hrvRmssd: 38 }, 1: { hrMin: 59, hrvRmssd: 39 } };
    const d = dataset(sick, { noVitalsHr: true });
    for (const v of Object.values(d.vitals)) delete v.hrMin;
    const alert = detectRecoveryAlert(d)!;
    expect(alert.level).toBe('watch');
    expect(alert.signals!.find((s) => s.key === 'hr')!.baseline).toBeGreaterThan(55);
  });
});
