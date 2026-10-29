import { circadian, CircadianParams, DEFAULT_CIRCADIAN, Interval, simulateAlertness } from '../alertness';
import { calibrationInputFromDataset, createKssPredictor, describeRhythm, fitCircadian, LEARNING } from '../calibration';
import { DEMO_RHYTHM, generateDemoData } from '../demo';
import { hashString, planPingTimes, pingsPerDay, slotsForDay } from '../pingPlan';
import { gaussian, rng } from '../stats';
import { addDays, atMinutes, HOUR, MINUTE, minutesOfDay } from '../time';
import type { AlertnessCheckIn } from '../types';

const LAST = '2026-10-21';
const MID = 210; // habitual mid-sleep 03:30

/** A regular-ish schedule: asleep ~23:30 → ~07:30 for `days` nights ending on LAST. */
function sleeps(days: number, seed = 1): Interval[] {
  const rand = rng(seed);
  const out: Interval[] = [];
  for (let i = days; i >= 0; i--) {
    const wakeDate = addDays(LAST, -i);
    const onset = atMinutes(addDays(wakeDate, -1), 23.5 * 60 + gaussian(rand, 0, 20));
    const wake = atMinutes(wakeDate, 7.5 * 60 + gaussian(rand, 0, 20));
    out.push({ start: onset, end: wake });
  }
  return out;
}

/** Ratings generated from a known "true" person: the model with `truth` params plus rating noise. */
function synthCheckins(truth: CircadianParams, s: Interval[], opts: { days: number; perDay: number; noise: number; seed: number }): AlertnessCheckIn[] {
  const rand = rng(opts.seed);
  const predictor = createKssPredictor(s, MID, () => 0);
  const windows = [
    [8.75, 11.75],
    [12.75, 16.25],
    [17.5, 22.25],
  ];
  const out: AlertnessCheckIn[] = [];
  for (let i = opts.days - 1; i >= 0; i--) {
    const date = addDays(LAST, -i);
    for (const [lo, hi] of windows.slice(0, opts.perDay)) {
      const t = atMinutes(date, (lo + rand() * (hi - lo)) * 60);
      const kss = predictor.kssAt(t, truth);
      if (kss === undefined) continue;
      const rated = Math.round(Math.min(9, Math.max(1, kss + gaussian(rand, 0, opts.noise))));
      out.push({ id: `c-${date}-${lo}`, time: t, kss: rated, source: 'ping' });
    }
  }
  return out;
}

const NOW = atMinutes(LAST, 23 * 60);
const input = (checkins: AlertnessCheckIn[], s: Interval[], extra = {}) => ({ checkins, sleeps: s, midSleepMin: MID, debtMin: 0, now: NOW, ...extra });

describe('circadian params in the alertness model', () => {
  const t = atMinutes(LAST, 14 * 60);

  it('leaves the population model unchanged by default', () => {
    expect(circadian(t, MID)).toBe(circadian(t, MID, { phaseShiftMin: 0, ampScale: 1, dipScale: 1 }));
    expect(circadian(t, MID, { ...DEFAULT_CIRCADIAN, kssOffset: 0 })).toBe(circadian(t, MID));
  });

  it('applies a personal KSS offset as a constant shift in sleepiness', () => {
    const s = sleeps(4);
    const at = (p?: CircadianParams) => simulateAlertness(s, t, t, { midSleepMin: MID, circadian: p })[0].kss;
    expect(at({ ...DEFAULT_CIRCADIAN, kssOffset: 1 }) - at()).toBeCloseTo(1, 6);
  });

  it('predicts check-ins exactly like the simulator (rotated circadian terms)', () => {
    const s = sleeps(5);
    const p: CircadianParams = { phaseShiftMin: 75, ampScale: 1.3, dipScale: 1.7, kssOffset: -0.4 };
    const predictor = createKssPredictor(s, MID, () => 120);
    for (const h of [9, 13.5, 17, 21.25]) {
      const at = atMinutes(LAST, h * 60);
      const sim = simulateAlertness(s, at, at, { midSleepMin: MID, debtMin: 120, circadian: p })[0];
      expect(predictor.kssAt(at, p)).toBeCloseTo(sim.kss, 9);
    }
  });
});

describe('fitCircadian', () => {
  const s = sleeps(30);
  const truth: CircadianParams = { phaseShiftMin: 60, ampScale: 1, dipScale: 2, kssOffset: 0.4 };

  it('recovers a later rhythm with a strong dip and beats the population model', () => {
    const checkins = synthCheckins(truth, s, { days: 28, perDay: 3, noise: 0.7, seed: 7 });
    const r = fitCircadian(input(checkins, s))!;
    expect(r).toBeDefined();
    expect(r.n).toBe(checkins.length);
    expect(r.applied).toBe(true);
    expect(Math.abs(r.params.phaseShiftMin - 60)).toBeLessThanOrEqual(25);
    expect(Math.abs(r.params.dipScale - 2)).toBeLessThanOrEqual(0.45);
    expect(Math.abs(r.params.ampScale - 1)).toBeLessThanOrEqual(0.25);
    expect(Math.abs((r.params.kssOffset ?? 0) - 0.4)).toBeLessThanOrEqual(0.35);
    expect(r.maeAfter!).toBeLessThan(r.maeBefore! - 0.2);
    expect(r.accuracy!).toBeGreaterThan(r.accuracyBefore!);
    expect(r.confidence).toBe('high');
    expect(r.coverage).toEqual({ morning: 28, afternoon: 28, evening: 28 });
    // Logged for the report: recovered vs. truth.
    console.log('fit (truth phase 60, amp 1, dip 2, offset 0.4):', r.params, 'MAE', r.maeBefore, '→', r.maeAfter, 'accuracy', r.accuracyBefore, '→', r.accuracy);
  });

  it('recovers an earlier, steadier rhythm too', () => {
    const early: CircadianParams = { phaseShiftMin: -60, ampScale: 0.7, dipScale: 0.5, kssOffset: 0 };
    const checkins = synthCheckins(early, s, { days: 28, perDay: 3, noise: 0.7, seed: 11 });
    const r = fitCircadian(input(checkins, s))!;
    expect(r.params.phaseShiftMin).toBeLessThan(-30);
    expect(r.params.ampScale).toBeLessThan(0.9);
    expect(r.params.dipScale).toBeLessThan(0.9);
    expect(r.maeAfter!).toBeLessThan(r.maeBefore!);
    console.log('fit (truth phase -60, amp 0.7, dip 0.5, offset 0):', r.params, 'MAE', r.maeBefore, '→', r.maeAfter);
  });

  it('stays near the population defaults with only a handful of noisy check-ins', () => {
    const checkins = synthCheckins(DEFAULT_CIRCADIAN, s, { days: 2, perDay: 3, noise: 1.2, seed: 3 });
    expect(checkins).toHaveLength(6);
    const r = fitCircadian(input(checkins, s))!;
    expect(r.n).toBe(6);
    expect(r.confidence).toBe('low');
    expect(Math.abs(r.fitted!.phaseShiftMin)).toBeLessThanOrEqual(35);
    expect(Math.abs(r.fitted!.ampScale - 1)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(r.fitted!.dipScale - 1)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(r.fitted!.kssOffset ?? 0)).toBeLessThanOrEqual(0.75);
  });

  it('shrinks a strong signal from few check-ins toward the defaults', () => {
    const few = synthCheckins(truth, s, { days: 2, perDay: 3, noise: 0.7, seed: 5 });
    const many = synthCheckins(truth, s, { days: 28, perDay: 3, noise: 0.7, seed: 5 });
    const a = fitCircadian(input(few, s))!.fitted!;
    const b = fitCircadian(input(many, s))!.fitted!;
    expect(Math.abs(a.dipScale - 1)).toBeLessThan(Math.abs(b.dipScale - 1));
  });

  it('needs at least 6 usable check-ins', () => {
    const checkins = synthCheckins(truth, s, { days: 2, perDay: 3, noise: 0.7, seed: 9 }).slice(0, LEARNING.minCheckins - 1);
    expect(fitCircadian(input(checkins, s))).toBeUndefined();
  });

  it('skips check-ins without recorded sleep or during sleep, and honours a reset', () => {
    const checkins = synthCheckins(truth, s, { days: 10, perDay: 3, noise: 0.7, seed: 13 });
    const unsupported: AlertnessCheckIn[] = [
      // Night of LAST-40 isn't recorded at all.
      { id: 'x1', time: atMinutes(addDays(LAST, -40), 10 * 60), kss: 5, source: 'manual' },
      // 03:00 — asleep.
      { id: 'x2', time: atMinutes(addDays(LAST, -3), 3 * 60), kss: 8, source: 'manual' },
    ];
    const r = fitCircadian(input([...checkins, ...unsupported], s, { now: NOW + HOUR }))!;
    expect(r.n).toBe(checkins.length);
    expect(r.skipped).toBe(2);
    const since = checkins[checkins.length - 5].time;
    expect(fitCircadian(input(checkins, s, { since }))).toBeUndefined();
  });

  it('is fast enough to run on the phone after every check-in', () => {
    const checkins = synthCheckins(truth, s, { days: 28, perDay: 3, noise: 0.7, seed: 21 });
    const t0 = Date.now();
    fitCircadian(input(checkins, s));
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('demo check-ins', () => {
  const now = new Date(2026, 9, 28, 14, 30).getTime();
  const data = generateDemoData(now);

  it('adds 2–3 check-ins a day over the last three weeks', () => {
    const c = data.checkins!;
    expect(c.length).toBeGreaterThanOrEqual(40);
    expect(c.length).toBeLessThanOrEqual(66);
    expect(c.every((x) => x.time <= now && x.time > now - 22 * 24 * HOUR && x.kss >= 1 && x.kss <= 9)).toBe(true);
    expect(c.some((x) => x.source === 'ping') && c.some((x) => x.source === 'manual')).toBe(true);
  });

  it('lets the fit find the demo person’s shifted rhythm', () => {
    const r = fitCircadian(calibrationInputFromDataset(data, now))!;
    expect(r.applied).toBe(true);
    expect(r.maeAfter!).toBeLessThan(r.maeBefore!);
    expect(Math.sign(r.params.phaseShiftMin)).toBe(Math.sign(DEMO_RHYTHM.phaseShiftMin));
    expect(r.params.dipScale).toBeGreaterThan(1.2);
    console.log('demo fit (truth', DEMO_RHYTHM, '):', r.params, 'n', r.n, 'MAE', r.maeBefore, '→', r.maeAfter, 'accuracy', r.accuracyBefore, '→', r.accuracy);
  });
});

describe('describeRhythm', () => {
  it('puts a strong, late dip into words', () => {
    const f = describeRhythm({ phaseShiftMin: 40, ampScale: 1, dipScale: 1.6 });
    expect(f.find((x) => x.id === 'dip')!.text).toBe('Your afternoon dip is stronger than average and about 40 min later than typical for your sleep times.');
    expect(f.find((x) => x.id === 'phase')!.text).toMatch(/runs later than your sleep times/);
    expect(describeRhythm({ phaseShiftMin: -130, ampScale: 1, dipScale: 1 })[0].text).toMatch(/about 2h earlier/);
  });

  it('mentions amplitude and scale use, and falls back to "average"', () => {
    const f = describeRhythm({ phaseShiftMin: -5, ampScale: 0.7, dipScale: 1, kssOffset: 0.9 });
    expect(f.map((x) => x.id)).toEqual(['amplitude', 'offset']);
    expect(describeRhythm(DEFAULT_CIRCADIAN).map((x) => x.id)).toEqual(['average']);
  });
});

describe('ping planning', () => {
  const date = '2026-10-22';
  const wake = atMinutes(date, 7 * 60);
  const windDown = atMinutes(date, 22 * 60);

  it('spreads 3 pings over morning, afternoon and evening inside waking hours', () => {
    const p = planPingTimes({ date, wake, windDown, count: 3 });
    expect(p.map((x) => x.slot)).toEqual(['morning', 'afternoon', 'evening']);
    expect(p[0].at).toBeGreaterThanOrEqual(wake + HOUR);
    expect(p[2].at).toBeLessThanOrEqual(windDown - 30 * MINUTE);
    for (let i = 1; i < p.length; i++) expect(p[i].at - p[i - 1].at).toBeGreaterThanOrEqual(80 * MINUTE);
    const afternoon = minutesOfDay(p[1].at) / 60;
    expect(afternoon).toBeGreaterThan(12);
    expect(afternoon).toBeLessThan(17.5);
  });

  it('is stable for a date and different across dates', () => {
    const a = planPingTimes({ date, wake, windDown, count: 3 });
    expect(planPingTimes({ date, wake, windDown, count: 3 })).toEqual(a);
    expect(planPingTimes({ date, wake, windDown, count: 2 }).every((x) => a.some((y) => y.id === x.id && y.at === x.at))).toBe(true);
    const next = addDays(date, 1);
    const b = planPingTimes({ date: next, wake: wake + 24 * HOUR, windDown: windDown + 24 * HOUR, count: 3 });
    expect(b.map((x) => minutesOfDay(x.at))).not.toEqual(a.map((x) => minutesOfDay(x.at)));
    expect(hashString(date)).not.toBe(hashString(next));
  });

  it('rotates which parts of the day get the 2 daily pings', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) for (const s of slotsForDay(addDays(date, i), 2)) seen.add(s);
    expect([...seen].sort()).toEqual(['afternoon', 'evening', 'morning']);
  });

  it('skips a ping right after a check-in', () => {
    const [m] = planPingTimes({ date, wake, windDown, count: 3 });
    const p = planPingTimes({ date, wake, windDown, count: 3, checkinTimes: [m.at - 60 * MINUTE] });
    expect(p.map((x) => x.slot)).toEqual(['afternoon', 'evening']);
  });

  it('tapers to one a day once well calibrated', () => {
    expect(pingsPerDay(3)).toBe(3);
    expect(pingsPerDay(2, { n: 39, days: 20 })).toBe(2);
    expect(pingsPerDay(3, { n: 45, days: 13 })).toBe(3);
    expect(pingsPerDay(3, { n: 45, days: 15 })).toBe(1);
  });
});
