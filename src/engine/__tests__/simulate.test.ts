import { analyze } from '../analysis';
import { generateDemoData } from '../demo';
import { baselineScenario, Scenario, simulateTomorrow } from '../simulate';
import { addDays, atMinutes, HOUR, MINUTE } from '../time';

describe('what-if simulator', () => {
  const now = new Date(2026, 9, 28, 10, 0).getTime(); // Wednesday morning
  const data = generateDemoData(now);
  const a = analyze(data, now);
  const base = baselineScenario(a);
  const run = (patch: Partial<Scenario>) => simulateTomorrow(a, data, { ...base, ...patch });
  const today = (h: number) => atMinutes(a.day, h * 60);

  it('reproduces tonight’s plan when nothing changes', () => {
    const r = run({});
    expect(r.baseline.scenario.bedtime).toBe(a.tonight.bedtime);
    expect(r.baseline.scenario.wake).toBe(a.tonight.wake);
    expect(r.delta).toMatchObject({ sleepMin: 0, debtMin: 0, avgEnergy: 0, focusHours: 0, score: 0, caffeineMg: 0, napDelayMin: 0 });
    // (time in bed − time to fall asleep) × personal efficiency
    const expected = ((a.tonight.wake - a.tonight.bedtime) / MINUTE - a.latencyMin) * a.efficiency;
    expect(r.baseline.sleep.sleepMin).toBeCloseTo(expected, 0);
    expect(r.baseline.night.wakeDate).toBe(a.tonight.wakeDate);
    expect(r.baseline.score.total).toBeGreaterThan(50);
    expect(r.baseline.tomorrow.focusHours).toBeGreaterThan(0);
  });

  it('a later bedtime means more debt, less sleep, lower energy and a worse score', () => {
    const r = run({ bedtime: base.bedtime + 2 * HOUR });
    expect(r.delta.sleepMin).toBeCloseTo(-120 * a.efficiency, 0);
    expect(r.delta.debtMin).toBeGreaterThan(60);
    expect(r.delta.avgEnergy).toBeLessThan(-2);
    expect(r.delta.focusHours).toBeLessThan(0);
    expect(r.delta.score).toBeLessThan(-5);
  });

  it('an earlier bedtime means less debt and more energy tomorrow', () => {
    const r = run({ bedtime: base.bedtime - 30 * MINUTE });
    expect(r.delta.sleepMin).toBeGreaterThan(20);
    expect(r.delta.debtMin).toBeLessThan(-15);
    expect(r.delta.avgEnergy).toBeGreaterThan(0);
    expect(r.delta.score).toBeGreaterThanOrEqual(0);
  });

  it('lights-out deep in the wake-maintenance zone mostly buys time lying awake', () => {
    const r = run({ bedtime: base.bedtime - 3 * HOUR });
    expect(r.scenario.sleep.latencyParts.earlyBedMin).toBeGreaterThan(30);
    expect(r.delta.sleepMin).toBeLessThan(180 * a.efficiency - 30);
    expect(r.delta.sleepMin).toBeGreaterThan(0);
  });

  it('a nap at 14:00 pushes tonight’s sleepiness back, more for longer naps', () => {
    const power = run({ nap: { start: today(14), minutes: 20 } });
    const long = run({ nap: { start: today(14), minutes: 45 } });
    const full = run({ nap: { start: today(14), minutes: 90 } });
    expect(long.scenario.napDelayMin).toBeGreaterThan(0);
    expect(full.scenario.napDelayMin).toBeGreaterThan(long.scenario.napDelayMin);
    expect(power.scenario.napDelayMin).toBeLessThanOrEqual(long.scenario.napDelayMin);
    expect(long.delta.latencyMin).toBeCloseTo(long.scenario.napDelayMin, 5);
    expect(long.delta.sleepMin).toBeLessThan(0);
    // Nap sleep counts toward today's total, so it still trims the debt.
    expect(power.scenario.napSleepMin).toBeCloseTo(20 - Math.min(10, Math.max(5, Math.round(a.latencyMin / 2))), 5);
    expect(power.delta.debtMin).toBeLessThan(0);
  });

  it('late coffee leaves more caffeine at bedtime and costs sleep', () => {
    const at16 = run({ caffeine: [{ time: today(16), mg: 95 }] });
    const at19 = run({ caffeine: [{ time: today(19), mg: 95 }] });
    const morning = run({ caffeine: [{ time: today(8), mg: 95 }] });
    expect(at16.delta.caffeineMg).toBeGreaterThan(20);
    expect(at19.scenario.caffeineMg).toBeGreaterThan(at16.scenario.caffeineMg);
    expect(morning.delta.caffeineMg).toBeLessThan(at16.delta.caffeineMg / 2);
    expect(at19.delta.latencyMin).toBeGreaterThan(0);
    expect(at19.delta.sleepMin).toBeLessThan(0);
    expect(at19.delta.score).toBeLessThanOrEqual(at16.delta.score);
  });

  it('says whether the alarm lands on a sleep-cycle boundary', () => {
    const { onset } = run({}).baseline.sleep;
    const onCycle = run({ wake: onset + 5 * a.cycleMin * MINUTE });
    expect(onCycle.scenario.sleep.onBoundary).toBe(true);
    expect(onCycle.scenario.sleep.cycles).toBeCloseTo(5, 5);
    const mid = run({ wake: onset + 5.5 * a.cycleMin * MINUTE });
    expect(mid.scenario.sleep.onBoundary).toBe(false);
    const { earlier, later } = mid.scenario.sleep.boundaryWakes;
    expect(earlier).toBe(onset + 5 * a.cycleMin * MINUTE);
    expect(later).toBe(onset + 6 * a.cycleMin * MINUTE);
  });

  it('forecasts tomorrow from wake-up to the evening', () => {
    const r = run({ wake: base.wake + HOUR });
    const pts = r.scenario.tomorrow.points;
    expect(pts[0].t).toBeGreaterThanOrEqual(base.wake + HOUR);
    expect(pts[0].t).toBeLessThan(base.wake + HOUR + 5 * MINUTE);
    expect(pts[pts.length - 1].t).toBeLessThanOrEqual(r.range.to);
    expect(pts.every((p) => !p.asleep)).toBe(true);
    expect(r.range.from).toBe(base.wake);
    expect(r.range.to).toBe(a.tonight.bedtime + 24 * HOUR);
    // Sleeping in pays off tomorrow.
    expect(r.delta.avgEnergy).toBeGreaterThan(0);
    const dip = r.baseline.tomorrow.dip!;
    expect(dip.t).toBeGreaterThan(atMinutes(addDays(a.day, 1), 12 * 60));
    expect(dip.t).toBeLessThan(atMinutes(addDays(a.day, 1), 17 * 60));
  });

  it('never puts bedtime in the past', () => {
    const late = new Date(2026, 9, 28, 23, 50).getTime();
    const d = generateDemoData(late);
    const b = analyze(d, late);
    expect(b.tonight.bedtime).toBeLessThan(late);
    const scenario = baselineScenario(b);
    expect(scenario.bedtime).toBeGreaterThanOrEqual(late);
    const r = simulateTomorrow(b, d, { ...scenario, bedtime: late - HOUR });
    expect(r.scenario.scenario.bedtime).toBeGreaterThanOrEqual(late);
  });

  it('leaves the analysis untouched', () => {
    const nights = a.nights.length;
    const sleeps = a.sleeps.length;
    run({ bedtime: base.bedtime + HOUR, nap: { start: today(14), minutes: 30 }, caffeine: [{ time: today(15), mg: 63 }] });
    expect(a.nights.length).toBe(nights);
    expect(a.sleeps.length).toBe(sleeps);
  });

  it('is fast enough to run on every slider move', () => {
    const t0 = Date.now();
    for (let i = 0; i < 40; i++) {
      run({
        bedtime: base.bedtime + ((i % 13) - 6) * 15 * MINUTE,
        wake: base.wake + ((i % 5) - 2) * 15 * MINUTE,
        nap: i % 2 ? { start: today(13 + (i % 4)), minutes: 10 + i } : undefined,
        caffeine: i % 3 ? [{ time: today(12 + (i % 8)), mg: 95 }] : undefined,
      });
    }
    expect((Date.now() - t0) / 40).toBeLessThan(50);
  });
});
