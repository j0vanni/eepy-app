import {
  assessBreathing,
  BREATHING_DISCLAIMER,
  breathingSummaryFor,
  breathingTrend,
  combineBreathing,
  pickSpo2Source,
  pruneSpo2Curves,
  summarizeSpo2,
} from '../breathing';
import { generateDemoData } from '../demo';
import { analyze } from '../analysis';
import { physiologyInsights } from '../insights';
import { analyzeSessions, buildNights } from '../sessions';
import { addDays, atMinutes, MINUTE } from '../time';
import type { BreathingSummary, NightVitals, SleepSession, StageSegment, VitalSample } from '../types';
import { summarizeNightVitals } from '../vitals';
import { night } from './helpers';

const ONSET = atMinutes('2026-10-14', 23 * 60);
const WAKE = ONSET + 7 * 60 * MINUTE;
const WINDOW = { start: ONSET - 10 * MINUTE, sleepOnset: ONSET, finalWake: WAKE };

/** Readings every `stepMin` across the night; `f` gives the value at minute `i` after onset. */
function readings(stepMin: number, f: (min: number) => number = () => 96, from = ONSET, to = WAKE): VitalSample[] {
  const out: VitalSample[] = [];
  for (let t = from; t < to; t += stepMin * MINUTE) out.push({ time: t, value: f((t - ONSET) / MINUTE) });
  return out;
}

/** A dip of `depth` points lasting `lenMin` minutes every `everyMin` minutes, starting at minute 30. */
const dipping = (everyMin: number, depth: number, lenMin = 2) => (min: number) =>
  min >= 30 && (min - 30) % everyMin < lenMin ? 96 - depth : 96;

describe('summarizeSpo2', () => {
  it('steady readings: no dips, full coverage, high confidence, normal', () => {
    const { summary, curve } = summarizeSpo2(readings(2), WINDOW);
    expect(summary).toMatchObject({ n: 210, sleepMin: 420, dips3: 0, dips4: 0, lowest: 96, avg: 96, below90: 0, glitches: 0 });
    expect(summary!.coveredMin).toBeGreaterThanOrEqual(416);
    const night = assessBreathing(summary)!;
    expect(night).toMatchObject({ confidence: 'high', level: 'normal', odi3: 0, odi4: 0, title: 'Looks normal' });
    // Lowest reading per 5 minutes, offsets from session start.
    expect(curve![0]).toEqual([10, 96]);
    expect(curve!.length).toBe(84);
  });

  it('counts dips of ≥ 3 points below the local baseline, and ≥ 4 separately', () => {
    // A 4-point dip every 20 min from minute 30 → 20 dips in 7 h of covered sleep.
    const four = summarizeSpo2(readings(2, dipping(20, 4)), WINDOW).summary!;
    expect(four.dips3).toBe(20);
    expect(four.dips4).toBe(20);
    expect(four.dipAt![0]).toBe(40); // 30 min after onset = 40 min after session start
    const night = assessBreathing(four)!;
    expect(night.odi3).toBeCloseTo(20 / 7, 0);
    expect(night.level).toBe('normal');

    const three = summarizeSpo2(readings(2, dipping(20, 3)), WINDOW).summary!;
    expect(three.dips3).toBe(20);
    expect(three.dips4).toBe(0);

    const two = summarizeSpo2(readings(2, dipping(20, 2)), WINDOW).summary!;
    expect(two.dips3).toBe(0);
  });

  it('a long dip counts once; recovering and dipping again counts twice', () => {
    // 10 minutes at 92: one event.
    const long = summarizeSpo2(readings(2, (m) => (m >= 60 && m < 70 ? 92 : 96)), WINDOW).summary!;
    expect(long.dips3).toBe(1);
    // Partial recovery to 94 (still more than 1 below baseline) keeps the same event going.
    const partial = summarizeSpo2(readings(2, (m) => (m >= 60 && m < 64 ? 92 : m >= 64 && m < 68 ? 94 : m >= 68 && m < 72 ? 92 : 96)), WINDOW).summary!;
    expect(partial.dips3).toBe(1);
    // Full recovery in between: two events.
    const twice = summarizeSpo2(readings(2, (m) => (m >= 60 && m < 64 ? 92 : m >= 70 && m < 74 ? 92 : 96)), WINDOW).summary!;
    expect(twice.dips3).toBe(2);
  });

  it('follows a slow drift instead of calling it a dip', () => {
    // 97% → 92% over seven hours: the baseline moves with it.
    const s = summarizeSpo2(readings(2, (m) => 97 - Math.floor(m / 84)), WINDOW).summary!;
    expect(s.dips3).toBe(0);
    expect(s.lowest).toBe(93);
  });

  it('drops a single-reading glitch but keeps a real two-reading dip', () => {
    const glitch = summarizeSpo2(readings(2, (m) => (m === 100 ? 82 : 96)), WINDOW).summary!;
    expect(glitch.glitches).toBe(1);
    expect(glitch.dips3).toBe(0);
    expect(glitch.lowest).toBe(96);

    const real = summarizeSpo2(readings(2, (m) => (m === 100 || m === 102 ? 85 : 96)), WINDOW).summary!;
    expect(real.glitches).toBe(0);
    expect(real.dips3).toBe(1);
    expect(real.lowest).toBe(85);
    expect(real.below90).toBe(2);
  });

  it('skips readings taken while awake and treats the awakening as a break', () => {
    const awake: StageSegment = { stage: 'awake', start: ONSET + 120 * MINUTE, end: ONSET + 150 * MINUTE };
    const segments: StageSegment[] = [
      { stage: 'light', start: ONSET, end: awake.start },
      awake,
      { stage: 'light', start: awake.end, end: WAKE },
    ];
    // Movement while awake reads low — none of it should count.
    const s = summarizeSpo2(readings(2, (m) => (m >= 120 && m < 150 ? 86 : 96)), { ...WINDOW, segments }).summary!;
    expect(s.dips3).toBe(0);
    expect(s.lowest).toBe(96);
    expect(s.n).toBe(195);
    expect(s.sleepMin).toBe(390);
    expect(s.coveredMin).toBeLessThanOrEqual(390);
  });

  it('only counts covered time: a 3-hour gap lowers coverage and confidence', () => {
    const gappy = readings(2, dipping(20, 4)).filter((x) => x.time < ONSET + 120 * MINUTE || x.time >= ONSET + 300 * MINUTE);
    const s = summarizeSpo2(gappy, WINDOW).summary!;
    expect(s.coveredMin).toBeLessThan(250);
    const n = assessBreathing(s)!;
    expect(n.coverage).toBeLessThan(0.6);
    expect(n.confidence).toBe('medium');
    // Dense but mostly missing: low confidence, and the copy blames the gaps, not the sampling rate.
    const loose = assessBreathing(summarizeSpo2(gappy.filter((x) => x.time < ONSET + 150 * MINUTE), WINDOW).summary)!;
    expect(loose.confidence).toBe('low');
    expect(loose.detail).toMatch(/^Readings covered only \d+% of your sleep/);
    // Dips per *covered* hour, not per hour of sleep.
    expect(n.odi3).toBeCloseTo(s.dips3 / (s.coveredMin / 60), 1);
  });

  it('sparse readings (one every 15 min): no dip count, says it is too sparse', () => {
    const s = summarizeSpo2(readings(15, (m) => (m % 60 === 0 ? 91 : 96)), WINDOW).summary!;
    expect(s.n).toBe(28);
    expect(s.coveredMin).toBe(0);
    const n = assessBreathing(s)!;
    expect(n.confidence).toBe('low');
    expect(n.level).toBe('unknown');
    expect(n.odi3).toBeUndefined();
    expect(n.title).toBe('Too few readings to judge');
    expect(n.detail).toMatch(/about 4 an hour/);
    expect(n.detail).toMatch(/one reading every 5 minutes/);
  });

  it('a handful of readings: "not enough readings", no guessing', () => {
    const few = [0, 120, 300].map((m) => ({ time: ONSET + m * MINUTE, value: 95 }));
    const n = assessBreathing(summarizeSpo2(few, WINDOW).summary)!;
    expect(n.confidence).toBe('none');
    expect(n.title).toBe('Not enough readings');
    expect(n.detail).toMatch(/Only 3 SpO₂ readings/);
    expect(n.odi3).toBeUndefined();
  });

  it('nothing usable → no summary', () => {
    expect(summarizeSpo2([], WINDOW)).toEqual({});
    expect(summarizeSpo2([{ time: ONSET + HOUR(1), value: 0 }, { time: ONSET + HOUR(2), value: 140 }], WINDOW)).toEqual({});
    // Outside the sleep window.
    expect(summarizeSpo2([{ time: ONSET - HOUR(2), value: 96 }], WINDOW)).toEqual({});
    expect(assessBreathing(undefined)).toBeUndefined();
  });

  it('uses one app per night (the night’s own if it wrote any) and ignores duplicate writes', () => {
    const watch = readings(2).map((x) => ({ ...x, origin: 'com.nothing.smartcenter' }));
    const phone = readings(3, () => 92).map((x) => ({ ...x, origin: 'com.other.app' }));
    expect(pickSpo2Source([...watch, ...phone], 'com.nothing.smartcenter')).toHaveLength(watch.length);
    expect(pickSpo2Source([...watch, ...phone], 'unknown.origin')).toHaveLength(watch.length); // most readings
    const s = summarizeSpo2([...watch, ...phone, ...watch.slice(0, 10)], { ...WINDOW, session: { origin: 'com.nothing.smartcenter' } }).summary!;
    expect(s.n).toBe(210);
    expect(s.lowest).toBe(96);
  });
});

function HOUR(h: number) {
  return h * 60 * MINUTE;
}

const summary = (over: Partial<BreathingSummary>): BreathingSummary => ({
  n: 210,
  sleepMin: 420,
  coveredMin: 420,
  dips3: 0,
  dips4: 0,
  lowest: 93,
  avg: 96,
  below90: 0,
  glitches: 0,
  ...over,
});

describe('assessBreathing thresholds', () => {
  it('classifies by dips per hour with conservative cut-offs', () => {
    expect(assessBreathing(summary({ dips3: 34, dips4: 10 }))!.level).toBe('normal'); // 4.9/h
    expect(assessBreathing(summary({ dips3: 35, dips4: 10 }))!.level).toBe('some'); // 5/h
    expect(assessBreathing(summary({ dips3: 104, dips4: 30 }))!.level).toBe('some'); // 14.9/h
    const frequent = assessBreathing(summary({ dips3: 105, dips4: 30 }))!; // 15/h
    expect(frequent.level).toBe('frequent');
    expect(frequent.title).toBe('Frequent dips');
    expect(frequent.detail).toMatch(/worth mentioning to a doctor/);
    expect(frequent.detail).toMatch(/sensor noise/);
    // Deeper dips need fewer: ≥ 10/h of 4% is frequent.
    expect(assessBreathing(summary({ dips3: 70, dips4: 70 }))!.level).toBe('frequent');
  });

  it('long stretches below 90% count too', () => {
    // 6% of readings below 90 → ~25 min: some.
    expect(assessBreathing(summary({ below90: 13 }))!.level).toBe('some');
    // 12% → ~50 min: frequent.
    const n = assessBreathing(summary({ below90: 25 }))!;
    expect(n.level).toBe('frequent');
    expect(n.below90Min).toBe(50);
  });

  it('confidence follows readings per hour and coverage', () => {
    expect(assessBreathing(summary({ n: 210, coveredMin: 400 }))!.confidence).toBe('high'); // 30/h, 95%
    expect(assessBreathing(summary({ n: 100, coveredMin: 400 }))!.confidence).toBe('medium'); // 14/h
    expect(assessBreathing(summary({ n: 80, coveredMin: 400 }))!.confidence).toBe('low'); // 11/h
    expect(assessBreathing(summary({ n: 210, coveredMin: 200 }))!.confidence).toBe('low'); // < 50% covered
    expect(assessBreathing(summary({ n: 5, coveredMin: 0 }))!.confidence).toBe('none');
    // Low confidence never gets a verdict, even with many dips seen.
    expect(assessBreathing(summary({ n: 80, coveredMin: 400, dips3: 200 }))!.level).toBe('unknown');
  });
});

describe('merged sessions', () => {
  it('adds up the parts of a night the analysis merged', () => {
    const a = summary({ n: 100, sleepMin: 200, coveredMin: 190, dips3: 4, dips4: 1, lowest: 91, avg: 96, below90: 0 });
    const b = summary({ n: 50, sleepMin: 100, coveredMin: 95, dips3: 2, dips4: 2, lowest: 88, avg: 93, below90: 3 });
    expect(combineBreathing([a, b])).toEqual({ n: 150, sleepMin: 300, coveredMin: 285, dips3: 6, dips4: 3, lowest: 88, avg: 95, below90: 3, glitches: 0 });
    const vitals: Record<string, NightVitals> = { x: { sessionId: 'x', breathing: a }, y: { sessionId: 'y', breathing: b } };
    expect(breathingSummaryFor(vitals, 'x+y')!.n).toBe(150);
    expect(breathingSummaryFor(vitals, 'x')).toBe(a);
    expect(breathingSummaryFor(vitals, 'z')).toBeUndefined();
  });
});

describe('breathingTrend', () => {
  const TODAY = '2026-10-20';
  function dataset(perNight: (i: number) => Partial<NightVitals> | undefined, days = 30) {
    const sessions: SleepSession[] = [];
    const vitals: Record<string, NightVitals> = {};
    for (let i = days - 1; i >= 0; i--) {
      const wake = addDays(TODAY, -i);
      const id = `n-${wake}`;
      sessions.push(night(addDays(wake, -1), 23 * 60, 7, { id }));
      const v = perNight(i);
      if (v) vitals[id] = { sessionId: id, ...v };
    }
    return { nights: buildNights(analyzeSessions(sessions)), vitals, asOfDate: TODAY };
  }

  it('needs at least 5 nights dense enough to count dips', () => {
    const t = breathingTrend(dataset((i) => (i < 4 ? { breathing: summary({}) } : { breathing: summary({ n: 20, coveredMin: 0 }) })))!;
    expect(t.level).toBe('unknown');
    expect(t.title).toBe('Not enough data yet');
    expect(t.analysable).toBe(4);
    expect(t.detail).toMatch(/4 of 30 nights/);
    expect(t.detail).toMatch(/one every 5 minutes/);
  });

  it('looks normal with few dips, using medians', () => {
    const t = breathingTrend(dataset((i) => ({ breathing: summary({ dips3: i % 3 === 0 ? 14 : 7, lowest: 91 }) })))!;
    expect(t.level).toBe('normal');
    expect(t.medianOdi3).toBe(1);
    expect(t.medianLowest).toBe(91);
    expect(t.analysable).toBe(30);
    expect(t.detail).toMatch(/under 5 an hour is typical/);
  });

  it('"some dips" when the median is ≥ 5/h or ≥ 30% of nights were frequent', () => {
    expect(breathingTrend(dataset(() => ({ breathing: summary({ dips3: 42 }) })))!.level).toBe('some');
    // 10 of 30 nights frequent, median still low.
    const t = breathingTrend(dataset((i) => ({ breathing: summary({ dips3: i % 3 === 0 ? 120 : 7 }) })))!;
    expect(t.nightsFrequent).toBe(10);
    expect(t.level).toBe('some');
    expect(t.detail).toMatch(/STOP-Bang/);
  });

  it('"frequent dips — worth mentioning to a doctor" only for a persistent pattern', () => {
    const t = breathingTrend(dataset(() => ({ breathing: summary({ dips3: 126, dips4: 40 }) })))!;
    expect(t.level).toBe('frequent');
    expect(t.title).toBe('Frequent dips — worth mentioning to a doctor');
    expect(t.detail).toMatch(/can't diagnose/);
    // A single bad night among normal ones doesn't.
    expect(breathingTrend(dataset((i) => ({ breathing: summary({ dips3: i === 0 ? 200 : 7 }) })))!.level).toBe('normal');
  });

  it('says so when the watch sends no SpO₂, and spots nights synced before the breathing check', () => {
    const none = breathingTrend(dataset(() => undefined))!;
    expect(none.nights).toHaveLength(0);
    expect(none.level).toBe('unknown');
    expect(none.detail).toMatch(/No blood-oxygen readings/);
    const legacy = breathingTrend(dataset((i) => (i < 10 ? { breathing: summary({}) } : { spo2Avg: 96, spo2Samples: 40 })))!;
    expect(legacy.legacyNights).toBe(20);
    expect(legacy.detail).toMatch(/full re-sync/);
  });

  it('only looks at the last 30 days', () => {
    const t = breathingTrend({ ...dataset(() => ({ breathing: summary({ dips3: 140 }) }), 40), days: 30 })!;
    expect(t.nightsInWindow).toBe(30);
    expect(breathingTrend({ nights: [], vitals: {}, asOfDate: TODAY })).toBeUndefined();
  });
});

describe('storage', () => {
  it('keeps the chart curve only for the most recent nights, without mutating', () => {
    const sessions = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, end: i * 1000 }));
    const vitals: Record<string, NightVitals> = Object.fromEntries(
      sessions.map((s) => [s.id, { sessionId: s.id, breathing: summary({}), spo2Curve: [[0, 96]] as [number, number][] }]),
    );
    const pruned = pruneSpo2Curves(vitals, sessions, 2);
    expect(Object.keys(pruned).filter((id) => pruned[id].spo2Curve)).toEqual(['s3', 's4']);
    expect(pruned.s0.breathing).toBeDefined();
    expect(vitals.s0.spo2Curve).toBeDefined();
    expect(pruneSpo2Curves(vitals, sessions, 10)).toBe(vitals);
  });

  it('summarizeNightVitals stores the summary, the curve and a dips rate only when dense', () => {
    const s = { id: 'x', start: WINDOW.start, end: WAKE, sleepOnset: ONSET, finalWake: WAKE };
    const dense = summarizeNightVitals(s, { spo2: readings(2, dipping(20, 4)) });
    expect(dense.breathing!.dips3).toBe(20);
    expect(dense.spo2DipsPerHour).toBeCloseTo(2.9, 1);
    expect(dense.spo2Min).toBe(92);
    expect(dense.spo2Samples).toBe(210);
    expect(dense.spo2Curve!.length).toBeGreaterThan(80);
    const sparse = summarizeNightVitals(s, { spo2: readings(30) });
    expect(sparse.spo2DipsPerHour).toBeUndefined();
    expect(sparse.spo2Avg).toBe(96);
    expect(summarizeNightVitals(s, {}).breathing).toBeUndefined();
  });
});

describe('demo data', () => {
  const now = Date.parse('2026-10-28T09:30:00-05:00');
  const data = generateDemoData(now);
  const a = analyze(data, now);

  it('has dense, plausible SpO₂ with more dips after alcohol', () => {
    const rows = a.nights
      .filter((n) => n.main)
      .map((n) => ({ alcohol: data.dayLogs[addDays(n.wakeDate, -1)]?.tags.includes('alcohol'), b: assessBreathing(data.vitals[n.main!.id]?.breathing) }))
      .filter((r) => r.b && r.b.odi3 !== undefined);
    expect(rows.length).toBeGreaterThan(40);
    const med = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];
    const after = rows.filter((r) => r.alcohol).map((r) => r.b!.odi3!);
    const sober = rows.filter((r) => r.alcohol === false).map((r) => r.b!.odi3!);
    expect(med(after)).toBeGreaterThan(med(sober) + 2);
    expect(med(sober)).toBeLessThan(3);
  });

  it('shows a calm 30-night trend and keeps curves for ~30 nights only', () => {
    expect(a.breathing!.level).toBe('normal');
    expect(a.breathing!.analysable).toBeGreaterThanOrEqual(20);
    expect(Object.values(data.vitals).filter((v) => v.spo2Curve).length).toBeLessThanOrEqual(30);
    expect(a.insights.find((i) => i.id === 'physio:spo2-dips')).toBeUndefined();
  });

  it('turns only a "frequent" trend into an insight; tag insights carry their measured effect', () => {
    const frequent = { ...a.breathing!, level: 'frequent' as const, detail: 'Your watch saw a lot.' };
    const [insight] = physiologyInsights([], frequent);
    expect(insight).toMatchObject({ id: 'physio:spo2-dips', kind: 'negative' });
    expect(insight.detail).toMatch(/STOP-Bang/);
    expect(physiologyInsights([], { ...frequent, level: 'some' })).toEqual([]);
    const tagged = a.insights.filter((i) => i.id.startsWith('tag:'));
    expect(tagged.length).toBeGreaterThan(0);
    for (const i of tagged) expect(i.effect).toMatchObject({ metric: expect.any(String), amount: expect.any(String), better: expect.any(Boolean) });
  });

  it('carries the disclaimer', () => {
    expect(BREATHING_DISCLAIMER).toMatch(/not a diagnostic test/);
  });
});
