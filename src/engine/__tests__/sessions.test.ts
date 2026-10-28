import { analyzeSessions, buildNights, computeSessionMetrics, dedupeSessions, mergeFragmented, normalizeSegments } from '../sessions';
import { atMinutes, MINUTE } from '../time';
import { SleepSession } from '../types';
import { night } from './helpers';

const base = atMinutes('2026-10-20', 23 * 60);
const m = (x: number) => base + x * MINUTE;

describe('normalizeSegments', () => {
  it('treats an unstaged session as one asleep block', () => {
    const s: SleepSession = { id: 'a', source: 'manual', start: m(0), end: m(480), stages: [] };
    expect(normalizeSegments(s)).toEqual([{ stage: 'asleep', start: m(0), end: m(480) }]);
  });

  it('fills short gaps with the previous stage and long gaps with wake, and merges runs', () => {
    const s: SleepSession = {
      id: 'a',
      source: 'manual',
      start: m(0),
      end: m(200),
      stages: [
        { stage: 'light', start: m(10), end: m(50) },
        { stage: 'light', start: m(55), end: m(90) }, // 5 min gap → light
        { stage: 'deep', start: m(120), end: m(180) }, // 30 min gap → awake
      ],
    };
    expect(normalizeSegments(s).map((x) => [x.stage, (x.start - base) / MINUTE, (x.end - base) / MINUTE])).toEqual([
      ['awake', 0, 10],
      ['light', 10, 90],
      ['awake', 90, 120],
      ['deep', 120, 180],
      ['awake', 180, 200],
    ]);
  });

  it('resolves overlapping stages in favour of the earlier one', () => {
    const s: SleepSession = {
      id: 'a',
      source: 'manual',
      start: m(0),
      end: m(60),
      stages: [
        { stage: 'light', start: m(0), end: m(40) },
        { stage: 'rem', start: m(30), end: m(60) },
      ],
    };
    const segs = normalizeSegments(s);
    expect(segs[1]).toEqual({ stage: 'rem', start: m(40), end: m(60) });
  });
});

describe('computeSessionMetrics', () => {
  it('computes latency, WASO, awakenings, efficiency and stage shares', () => {
    const s: SleepSession = {
      id: 'a',
      source: 'manual',
      start: m(0),
      end: m(100),
      stages: [
        { stage: 'awake', start: m(0), end: m(15) },
        { stage: 'light', start: m(15), end: m(45) },
        { stage: 'deep', start: m(45), end: m(65) },
        { stage: 'awake', start: m(65), end: m(70) },
        { stage: 'rem', start: m(70), end: m(95) },
        { stage: 'awake', start: m(95), end: m(100) },
      ],
    };
    const r = computeSessionMetrics(s)!;
    expect(r.latencyMin).toBe(15);
    expect(r.totalSleepMin).toBe(75);
    expect(r.wasoMin).toBe(5);
    expect(r.awakenings).toBe(1);
    expect(r.efficiency).toBeCloseTo(0.75);
    expect(r.stagePct!.deep).toBeCloseTo(20 / 75);
    expect(r.finalWake).toBe(m(95));
  });

  it('detects ~90 minute cycles from REM periods', () => {
    const r = computeSessionMetrics(night('2026-10-20', 23 * 60, 8))!;
    const complete = r.cycles.filter((c) => c.complete);
    expect(complete.length).toBeGreaterThanOrEqual(4);
    expect(r.avgCycleMin).toBeGreaterThan(80);
    expect(r.avgCycleMin).toBeLessThan(110);
    // Deep sleep is front-loaded.
    expect(complete[0].deepMin).toBeGreaterThan(complete[complete.length - 1].deepMin);
  });
});

describe('session pipeline', () => {
  it('keeps the preferred origin when two sources recorded the same night', () => {
    const phone = night('2026-10-20', 23 * 60, 7.5, { id: 'phone', origin: 'com.phone', staged: false });
    const watch = night('2026-10-20', 23 * 60 + 10, 7.2, { id: 'watch', origin: 'com.watch' });
    expect(dedupeSessions([phone, watch], ['com.watch']).map((s) => s.id)).toEqual(['watch']);
    // Without a preference, staged data wins over unstaged.
    expect(dedupeSessions([phone, watch]).map((s) => s.id)).toEqual(['watch']);
  });

  it('merges a night split by a short awakening', () => {
    const a = night('2026-10-20', 23 * 60, 3, { id: 'a' });
    const b = { ...night('2026-10-21', 2 * 60 + 30, 4.5, { id: 'b', latencyMin: 0 }) };
    const merged = mergeFragmented([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('a+b');
  });

  it('classifies naps and attributes sleep to the wake date', () => {
    const main = night('2026-10-20', 23 * 60, 7);
    const nap = night('2026-10-21', 14 * 60 + 30, 0.4, { id: 'nap' });
    const metrics = analyzeSessions([main, nap]);
    expect(metrics.find((x) => x.id === 'nap')!.isNap).toBe(true);
    const nights = buildNights(metrics);
    expect(nights).toHaveLength(1);
    expect(nights[0].wakeDate).toBe('2026-10-21');
    expect(nights[0].main!.id).toBe(main.id);
    expect(nights[0].naps).toHaveLength(1);
    expect(nights[0].totalSleepMin).toBeCloseTo(7 * 60 + 24, 0);
  });

  it('treats a short sleep through the core night as the main sleep', () => {
    const short = night('2026-10-21', 2 * 60, 2.2);
    expect(analyzeSessions([short])[0].isNap).toBe(false);
  });
});
