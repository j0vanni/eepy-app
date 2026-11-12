import { analyze } from '../analysis';
import { forecastEnergy, simulateAlertness } from '../alertness';
import { bodyClockShifts, heartRateTrough, lightDrivenClock, lightGuess, solve } from '../bodyClock';
import { calibrationInputFromDataset, fitCircadian } from '../calibration';
import { DEMO_WEIGHTS, generateDemoData } from '../demo';
import { planWaits, REACTION, reactionAgreement, readReaction, summarizeReaction } from '../reaction';
import { buildNights, computeSessionMetrics } from '../sessions';
import { addDays, atMinutes, dateKey, DAY, HOUR, MINUTE } from '../time';
import type { DailyStats, NightVitals, ReactionTest, SleepSession } from '../types';
import {
  boostFrom,
  buildSignalSource,
  dayHeartRate,
  DEFAULT_WEIGHTS,
  energyContext,
  explainEnergy,
  nightSignals,
  NO_WEIGHTS,
  SIGNAL_KEYS,
  withCaffeine,
} from '../watchSignals';
import { night } from './helpers';

const NOW = new Date(2026, 10, 11, 15, 30).getTime();

function regularNights(days: number, onsetMin = 23 * 60 + 30, hours = 7.5, ref = NOW): SleepSession[] {
  const out: SleepSession[] = [];
  for (let i = days; i >= 1; i--) out.push(night(addDays(dateKey(ref), -i), onsetMin, hours));
  return out;
}

const sleepsOf = (sessions: SleepSession[]) =>
  sessions.flatMap((s) => s.stages.filter((x) => x.stage !== 'awake').map((x) => ({ start: x.start, end: x.end })));

describe('night recovery signals', () => {
  const sessions = regularNights(20);
  const nights = buildNights(sessions.map((s) => computeSessionMetrics(s)!));
  const vitals: Record<string, NightVitals> = {};
  sessions.forEach((s, i) => {
    const last = i === sessions.length - 1;
    // Steady 50 ms / 52 bpm / 14 breaths, then a rough last night.
    vitals[s.id] = { sessionId: s.id, hrvRmssd: last ? 35 : 50 + (i % 3) - 1, hrMin: last ? 60 : 52 + (i % 2), respRate: last ? 16 : 14 + (i % 2) * 0.2 };
  });

  it('scores a night against the 30 nights before it, good direction positive', () => {
    const sig = nightSignals(nights, vitals, {});
    const last = sig.get(nights[nights.length - 1].wakeDate)!;
    expect(last.hrv!.z).toBeLessThan(-2);
    expect(last.hrv!.value).toBe(35);
    expect(last.hrv!.baseline).toBeGreaterThan(48);
    expect(last.rhr!.z).toBeLessThan(-2); // heart rate up = bad = negative
    expect(last.resp!.z).toBeLessThan(-2);
    // Every night is the same length: deep sleep and time awake are at their usual.
    expect(Math.abs(last.deep!.z)).toBeLessThan(0.5);
    // Too little history at the start.
    expect(sig.get(nights[3].wakeDate)).toBeUndefined();
    expect(sig.get(nights[8].wakeDate)!.hrv).toBeDefined();
  });

  it('caps a signal and never divides by a near-zero spread', () => {
    const flat: Record<string, NightVitals> = {};
    sessions.forEach((s, i) => (flat[s.id] = { sessionId: s.id, hrMin: i === sessions.length - 1 ? 53 : 52 }));
    const z = nightSignals(nights, flat, {}).get(nights[nights.length - 1].wakeDate)!.rhr!.z;
    expect(z).toBeCloseTo(-1 / 1.5, 1); // 1 bpm against the 1.5 bpm floor
    sessions.forEach((s, i) => (flat[s.id] = { sessionId: s.id, hrMin: i === sessions.length - 1 ? 90 : 52 }));
    expect(nightSignals(nights, flat, {}).get(nights[nights.length - 1].wakeDate)!.rhr!.z).toBe(-3);
  });
});

describe('daytime heart rate', () => {
  function daily(todayOffset: number): Record<string, DailyStats> {
    const out: Record<string, DailyStats> = {};
    for (let i = 20; i >= 0; i--) {
      const date = addDays(dateKey(NOW), -i);
      const hr: (number | null)[] = [];
      const steps: number[] = [];
      for (let h = 0; h < 24; h++) {
        const st = h >= 8 && h < 22 ? 300 + ((h * 7 + i * 13) % 5) * 150 : 0;
        // 60 + 1 bpm per ln(steps) + a little day-to-day wobble; today runs `todayOffset` higher.
        hr.push(h >= 7 && h < 23 ? Math.round(60 + Math.log1p(st) + ((i * 3 + h) % 3) - 1 + (i === 0 ? todayOffset : 0)) : 52);
        steps.push(st);
      }
      out[date] = { date, hours: { hr, steps } };
    }
    return out;
  }
  const sleeps = sleepsOf(regularNights(21));

  it('reads today against the usual for the clock hour and movement', () => {
    const calm = dayHeartRate(daily(0), sleeps, NOW);
    expect(calm.hours).toBeGreaterThan(200);
    expect(Math.abs(calm.at(NOW)!)).toBeLessThan(1);
    const up = dayHeartRate(daily(8), sleeps, NOW);
    expect(up.at(NOW)!).toBeGreaterThan(2);
    // Asleep hours are not waking heart rate.
    expect(up.at(atMinutes(dateKey(NOW), 3 * 60))).toBeUndefined();
  });

  it('fades the last deviation into the hours that have no readings yet', () => {
    const up = dayHeartRate(daily(8), sleeps, NOW);
    const now = up.at(NOW)!;
    const later = up.at(NOW + 3 * HOUR)!;
    expect(later).toBeGreaterThan(0);
    expect(later).toBeLessThan(now * 0.5);
    expect(up.at(NOW + 12 * HOUR)).toBeUndefined();
  });
});

describe('body clock from the watch', () => {
  const base = { daily: {}, today: dateKey(NOW), habitualOnsetMin: 23 * 60 + 30, habitualWakeMin: 7 * 60, now: NOW };

  it('guesses more light for daytime movement than for an evening on the sofa', () => {
    expect(lightGuess(12, 2500)).toBeGreaterThan(lightGuess(12, 0) * 5);
    expect(lightGuess(22, 2500)).toBeLessThan(lightGuess(12, 0));
  });

  it('settles on one temperature minimum a night, in the second half of sleep', () => {
    const minima = lightDrivenClock({ ...base, sleeps: sleepsOf(regularNights(36)) });
    const last = minima.slice(-10);
    for (let i = 1; i < last.length; i++) expect(Math.abs(last[i] - last[i - 1] - DAY)).toBeLessThan(20 * MINUTE);
    const h = new Date(last[last.length - 1]).getHours();
    expect(h).toBeGreaterThanOrEqual(2);
    expect(h).toBeLessThanOrEqual(7);
  });

  it('sees no shift on a regular schedule and a later clock after a week of late nights', () => {
    // Away from a clock change (see the next test).
    const ref = new Date(2026, 8, 20, 15, 30).getTime();
    const at = { ...base, today: dateKey(ref), now: ref };
    const regular = bodyClockShifts({ ...at, sleeps: sleepsOf(regularNights(40, undefined, undefined, ref)) });
    expect(regular.length).toBeGreaterThan(20);
    expect(Math.max(...regular.map((d) => Math.abs(d.shiftMin)))).toBeLessThanOrEqual(10);

    const sessions = regularNights(40, undefined, undefined, ref);
    // The last 7 nights: asleep 2.5 h later, up 2.5 h later.
    const late = sessions.map((s, i) => (i >= sessions.length - 7 ? night(addDays(dateKey(ref), -(sessions.length - i)), 26 * 60, 7.5) : s));
    const shifted = bodyClockShifts({ ...at, sleeps: sleepsOf(late) });
    const today = shifted[shifted.length - 1];
    expect(today.shiftMin).toBeGreaterThan(30);
    // The clock moves slower than the schedule did.
    expect(today.shiftMin).toBeLessThan(150);
    // One late night barely moves it.
    const one = sessions.map((s, i) => (i === sessions.length - 1 ? night(addDays(dateKey(ref), -1), 26 * 60, 7.5) : s));
    const once = bodyClockShifts({ ...at, sleeps: sleepsOf(one) });
    expect(Math.abs(once[once.length - 1].shiftMin)).toBeLessThan(today.shiftMin / 2);
  });

  it('notices the clocks going back: the body clock runs early by the wall clock, then catches up', () => {
    // Clocks went back an hour on 1 November 2026 (tests run in America/Chicago); sleep kept its wall-clock times.
    const shifts = bodyClockShifts({ ...base, sleeps: sleepsOf(regularNights(40)) });
    const on = (date: string) => shifts.find((d) => d.date === date)!.shiftMin;
    expect(on('2026-10-30')).toBeGreaterThanOrEqual(-10);
    expect(on('2026-11-02')).toBeLessThan(-30);
    expect(on('2026-11-10')).toBeGreaterThan(on('2026-11-02'));
  });

  it('finds the trough of the heart-rate wave once steps are accounted for', () => {
    const daily: Record<string, DailyStats> = {};
    const troughH = 4;
    for (let i = 3; i >= 0; i--) {
      const date = addDays(dateKey(NOW), -i);
      const hr: number[] = [];
      const steps: number[] = [];
      for (let h = 0; h < 24; h++) {
        const st = h >= 8 && h < 21 ? ((h * 37 + i * 11) % 7) * 200 : 0;
        hr.push(62 - 6 * Math.cos((2 * Math.PI * (h + 0.5 - troughH)) / 24) + 1.2 * Math.log1p(st));
        steps.push(st);
      }
      daily[date] = { date, hours: { hr, steps } };
    }
    const t = heartRateTrough(daily, addDays(dateKey(NOW), -1))!;
    expect(Math.abs(t - troughH * 60)).toBeLessThan(20);
    // A flat line has no trough; too few hours neither.
    for (const d of Object.values(daily)) d.hours!.hr = d.hours!.hr.map(() => 60);
    expect(heartRateTrough(daily, addDays(dateKey(NOW), -1))).toBeUndefined();
    expect(heartRateTrough({}, dateKey(NOW))).toBeUndefined();
  });

  it('solves small linear systems and reports singular ones', () => {
    expect(solve([[2, 1], [1, 3]], [5, 10])!.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([1, 3]);
    expect(solve([[1, 2], [2, 4]], [1, 2])).toBeUndefined();
  });
});

describe('the forecast with watch signals', () => {
  const data = generateDemoData(NOW);
  const a = analyze(data, NOW);

  it('leaves the forecast exactly as it was with no weights', () => {
    const plain = analyze(data, NOW, { weights: NO_WEIGHTS });
    const legacy = forecastEnergy({
      sleeps: plain.sleeps,
      now: NOW,
      wakeTime: plain.wakeTime,
      bedtime: plain.tonight.bedtime,
      nextWake: plain.tonight.wake,
      midSleepMin: plain.habitualMidSleepMin,
      debtMin: plain.debt.debtMin,
    });
    expect(plain.energy.points.map((p) => p.energy)).toEqual(legacy.points.map((p) => p.energy));
    expect(plain.energyContext).toEqual({});
  });

  it('adds caffeine and last night to the curve under the default weights', () => {
    expect(a.energyWeights).toEqual(DEFAULT_WEIGHTS);
    const f = a.signals.features(NOW);
    expect(f).toHaveLength(SIGNAL_KEYS.length);
    const mg = a.signals.caffeineMg(NOW);
    expect(mg).toBeGreaterThan(10);
    const point = a.energy.now!;
    expect(point.B!).toBeCloseTo(boostFrom(f, DEFAULT_WEIGHTS), 6);
    // An extra coffee an hour ago lifts the next hours and nothing else.
    const extra = withCaffeine(a.signals, [...data.caffeine, { id: 'x', time: NOW - HOUR, mg: 190, label: '' }], data.profile.caffeineHalfLifeH);
    const sim = (source: typeof a.signals) =>
      simulateAlertness(a.sleeps, NOW, NOW + 2 * HOUR, { midSleepMin: a.habitualMidSleepMin, debtMin: a.debt.debtMin, context: energyContext(source, DEFAULT_WEIGHTS) });
    const before = sim(a.signals);
    const after = sim(extra);
    expect(after[0].energy - before[0].energy).toBeGreaterThan(4);
    expect(after[0].S).toBe(before[0].S);
    expect(after[0].C).toBe(before[0].C);
  });

  it('explains the number now, part by part', () => {
    const b = a.energyNow!;
    expect(b.energy).toBe(Math.round(a.energy.now!.energy));
    expect(b.parts.map((p) => p.key)).toEqual(expect.arrayContaining(['debt', 'caffeine']));
    const sum = b.parts.reduce((s, p) => s + p.points, 0);
    expect(b.base + sum).toBe(b.energy);
    const recovery = b.parts.find((p) => p.key === 'recovery');
    expect(recovery?.detail).toMatch(/usual/);
    // With nothing but sleep timing there is only the debt to explain.
    const plain = analyze(data, NOW, { weights: NO_WEIGHTS });
    expect(explainEnergy(plain.energy.now!, { source: plain.signals, weights: NO_WEIGHTS, debtMin: plain.debt.debtMin }).parts.map((p) => p.key)).toEqual(
      plain.debt.debtMin >= 30 ? ['debt', 'recovery'] : ['recovery'],
    );
  });

  it('shifts the body-clock curve by the trusted share of the watch shift', () => {
    const source = { ...a.signals, clock: [{ date: a.day, shiftMin: 60 }], clockShiftMin: () => 60 };
    const run = (trust: number) =>
      simulateAlertness(a.sleeps, NOW, NOW, { midSleepMin: a.habitualMidSleepMin, context: energyContext(source, { ...NO_WEIGHTS, clockTrust: trust }) })[0];
    const later = simulateAlertness(a.sleeps, NOW, NOW, { midSleepMin: a.habitualMidSleepMin + 30 })[0];
    expect(run(0.5).C).toBeCloseTo(later.C, 9);
    expect(run(0).C).not.toBeCloseTo(later.C, 3);
  });
});

describe('learning the weights from check-ins', () => {
  const data = generateDemoData(NOW);
  const input = calibrationInputFromDataset(data, NOW);
  const r = fitCircadian(input)!;

  it('scores four models on held-out check-ins and uses the watch when it helps', () => {
    expect(r.tiers).toBeDefined();
    const t = r.tiers!;
    // The demo person really does feel last night and caffeine: models with the watch predict better.
    expect(t.watch.mae).toBeLessThan(t.population.mae);
    expect(t['personal+watch'].mae).toBeLessThan(t.personal.mae);
    expect(r.tier).toBe('personal+watch');
    expect(r.applied).toBe(true);
    expect(r.accuracy!).toBeGreaterThan(r.accuracyBefore!);
    expect(r.weights).toEqual(r.fittedWeights);
  });

  it('moves the weights toward the demo person’s own, within bounds', () => {
    const w = r.weights!;
    expect(w.caffeine).toBeGreaterThan(1);
    expect(w.caffeine).toBeLessThanOrEqual(5);
    for (const k of ['hrv', 'rhr', 'resp', 'deep', 'waso'] as const) {
      expect(w[k]).toBeGreaterThanOrEqual(0);
      expect(w[k]).toBeLessThanOrEqual(1.5);
    }
    expect(w.clockTrust).toBeGreaterThanOrEqual(0);
    expect(w.clockTrust).toBeLessThanOrEqual(1);
    expect(DEMO_WEIGHTS.hrv).toBeGreaterThan(0);
    // What each signal moved, in energy points.
    expect(r.signalUse!.caffeine!).toBeGreaterThan(0.5);
    expect(Object.keys(r.signalUse!)).toEqual(expect.arrayContaining([...SIGNAL_KEYS, 'clock']));
  });

  it('falls back to sleep timing only when the signals carry nothing', () => {
    // Ratings generated without any watch effect, and signals that are pure noise.
    const noise = {
      ...input.signals!,
      features: (t: number) => SIGNAL_KEYS.map((_, i) => Math.sin(t / (HOUR * (3 + i))) * 2),
      clockShiftMin: (t: number) => Math.sin(t / DAY) * 90,
    };
    const plain = fitCircadian({ ...input, signals: undefined })!;
    const noisy = fitCircadian({ ...input, signals: noise })!;
    expect(noisy.tiers!.watch.mae).toBeGreaterThan(noisy.tiers!.population.mae);
    expect(noisy.tier).not.toBe('watch');
    // Whatever it picked predicts held-out check-ins no worse than the population model.
    expect(noisy.tiers![noisy.tier!].mae).toBeLessThanOrEqual(noisy.tiers!.population.mae + 0.021);
    if (noisy.tier === 'population' || noisy.tier === 'personal') expect(noisy.weights).toEqual(NO_WEIGHTS);
    expect(plain.tier).toBeUndefined();
    expect(plain.weights).toBeUndefined();
  });

  it('is fast enough to run on the phone', () => {
    const t0 = Date.now();
    fitCircadian(input);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('reaction test', () => {
  const test = (time: number, rts: number[], misses = 0, falseStarts = 0): ReactionTest => ({ id: `r${time}`, time, rts, misses, falseStarts });
  const steady = [300, 310, 295, 320, 305, 298, 312, 301, 307, 299, 315, 303];

  it('plans waits inside the range', () => {
    const w = planWaits(() => 0.5);
    expect(w).toHaveLength(REACTION.trials);
    expect(w.every((x) => x >= REACTION.minWaitMs && x <= REACTION.maxWaitMs)).toBe(true);
  });

  it('summarises a test and needs five valid taps', () => {
    const s = summarizeReaction(test(1, steady))!;
    expect(s.medianMs).toBe(304);
    expect(s.speed).toBeCloseTo(3.28, 1);
    expect(summarizeReaction(test(1, [300, 310, 50, 4000]))).toBeUndefined();
  });

  it('compares a test with your own earlier ones', () => {
    const past = [1, 2, 3, 4].map((t) => test(t, steady.map((r) => r + t)));
    expect(readReaction(test(5, steady), past.slice(0, 2))!.verdict).toBeUndefined();
    expect(readReaction(test(5, steady), past)!.verdict).toBe('usual');
    const tired = readReaction(test(5, steady.map((r, i) => (i % 3 === 0 ? r * 2 : r * 1.25)), 1), past)!;
    expect(['slow', 'very-slow']).toContain(tired.verdict);
    expect(tired.lapses).toBe(5);
    expect(readReaction(test(5, steady.map((r) => r * 0.85)), past)!.verdict).toBe('sharp');
  });

  it('reports whether reaction speed follows the forecast', () => {
    const tests = Array.from({ length: 10 }, (_, i) => test(i, steady.map((r) => r + i * 12)));
    const follows = reactionAgreement(tests, (t) => 80 - t * 4)!;
    expect(follows.r).toBeGreaterThan(0.9);
    expect(reactionAgreement(tests.slice(0, 5), () => 50)).toBeUndefined();
    expect(reactionAgreement(tests, (t) => 40 + t * 4)!.r).toBeLessThan(-0.9);
  });
});
