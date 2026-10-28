import { forecastEnergy, Interval } from '../alertness';
import { analyze, trendRows } from '../analysis';
import { generateDemoData } from '../demo';
import { NapInput, recommendNap } from '../nap';
import { atMinutes, HOUR, MINUTE } from '../time';

const DAY = '2026-10-21';

function napInput(over: Partial<NapInput> & { lastNightH?: number; nowH: number }): NapInput {
  const sleeps: Interval[] = [];
  for (let d = -6; d <= 0; d++) {
    const wake = atMinutes(DAY, 7 * 60) + d * 24 * HOUR;
    sleeps.push({ start: wake - (d === 0 ? over.lastNightH ?? 8 : 8) * HOUR, end: wake });
  }
  const now = atMinutes(DAY, over.nowH * 60);
  const wakeTime = atMinutes(DAY, 7 * 60);
  const bedtime = atMinutes(DAY, 23 * 60);
  const nextWake = atMinutes('2026-10-22', 7 * 60);
  const debtMin = over.debtMin ?? 0;
  const forecast = forecastEnergy({ sleeps, now, wakeTime, bedtime, nextWake, midSleepMin: 180, debtMin });
  return {
    now,
    wakeTime,
    bedtime,
    nextWake,
    sleeps,
    midSleepMin: 180,
    needMin: 480,
    debtMin,
    lastNightSleepMin: (over.lastNightH ?? 8) * 60,
    napsTodayMin: 0,
    latencyMin: 12,
    cycleMin: 90,
    caffeineCutoff: atMinutes(DAY, 15 * 60),
    insomniaMode: false,
    forecast,
    ...over,
  };
}

describe('nap recommender', () => {
  it('says no nap is needed when well rested', () => {
    const r = recommendNap(napInput({ nowH: 13.5 }));
    expect(r.verdict).toBe('skip');
    expect(r.needScore).toBeLessThan(35);
    expect(r.headline).toMatch(/well rested/);
  });

  it('recommends a full-cycle recovery nap after a very short night with big debt', () => {
    const r = recommendNap(napInput({ nowH: 13.5, lastNightH: 5, debtMin: 300, sleepiness: 7 }));
    expect(r.verdict).toBe('nap-now');
    expect(r.best?.type).toBe('recovery');
    expect(r.best!.alarmAfterMin).toBeGreaterThanOrEqual(95);
  });

  it('recommends a power nap in the afternoon after a moderately short night', () => {
    const r = recommendNap(napInput({ nowH: 13.5, lastNightH: 6.75, debtMin: 150, sleepiness: 7 }));
    expect(r.verdict).toBe('nap-now');
    expect(r.best?.type).toBe('power');
    expect(r.best!.alarmAfterMin).toBeGreaterThanOrEqual(20);
    expect(r.best!.alarmAfterMin).toBeLessThanOrEqual(25);
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('plans the nap for later when asked in the morning', () => {
    const r = recommendNap(napInput({ nowH: 9, lastNightH: 5, debtMin: 300 }));
    expect(r.verdict).toBe('nap-later');
    expect(r.window!.start).toBeGreaterThan(atMinutes(DAY, 9 * 60));
  });

  it('offers a full-cycle nap only with big debt and enough time before bed', () => {
    const early = recommendNap(napInput({ nowH: 12, lastNightH: 4.5, debtMin: 420, sleepiness: 8 }));
    expect(early.options.find((o) => o.type === 'recovery')!.suitable).toBe(true);
    const late = recommendNap(napInput({ nowH: 16.5, lastNightH: 4.5, debtMin: 420 }));
    expect(late.options.find((o) => o.type === 'recovery')!.suitable).toBe(false);
  });

  it('says it is too late in the evening', () => {
    const r = recommendNap(napInput({ nowH: 20, lastNightH: 5, debtMin: 300 }));
    expect(r.verdict).toBe('skip');
    expect(r.headline).toMatch(/Too late/);
  });

  it('skips naps in insomnia mode', () => {
    const r = recommendNap(napInput({ nowH: 13.5, lastNightH: 5, debtMin: 300, insomniaMode: true }));
    expect(r.verdict).toBe('skip');
    expect(r.cautions[0]).toMatch(/Insomnia/);
  });

  it('recommends a pre-emptive nap before a night shift', () => {
    const r = recommendNap(napInput({ nowH: 16, upcoming: 'night-shift' }));
    expect(r.best?.type).toBe('prophylactic');
    expect(r.verdict).toBe('nap-now');
  });

  it('disallows a coffee nap after the caffeine cut-off', () => {
    const r = recommendNap(napInput({ nowH: 16, lastNightH: 5, debtMin: 300 }));
    expect(r.options.find((o) => o.type === 'coffee')!.suitable).toBe(false);
  });
});

describe('analyze() on demo data', () => {
  const now = new Date(2026, 9, 28, 14, 30).getTime();
  const data = generateDemoData(now);
  const a = analyze(data, now);

  it('produces a personalised need near the simulated truth', () => {
    expect(a.need.method).toBe('personalized');
    expect(Math.abs(a.need.needMin - 485)).toBeLessThanOrEqual(30);
  });

  it('computes debt, chronotype, regularity and a tonight plan', () => {
    expect(a.debt.debtMin).toBeGreaterThan(0);
    expect(a.chronotype.category).toBeDefined();
    expect(a.regularity.sri).toBeGreaterThan(40);
    expect(a.tonight.bedtime).toBeGreaterThan(now);
    expect(a.tonight.wake).toBeGreaterThan(a.tonight.bedtime);
    expect(a.alarm.alarm).toBeLessThanOrEqual(a.tonight.wake);
  });

  it('forecasts energy with a dip and focus windows', () => {
    expect(a.energy.now).toBeDefined();
    expect(a.energy.points.length).toBeGreaterThan(100);
    expect(a.energy.focusWindows.length).toBeGreaterThan(0);
  });

  it('recovers the effects baked into the demo data', () => {
    const ids = a.insights.map((i) => i.id);
    expect(ids).toContain('tag:alcohol');
    expect(ids).toContain('tag:late-caffeine');
    const alcohol = a.insights.find((i) => i.id === 'tag:alcohol')!;
    expect(alcohol.kind).toBe('negative');
  });

  it('builds a time-ordered plan and prioritised tips', () => {
    const times = a.plan.map((p) => p.time);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(a.plan.map((p) => p.kind)).toEqual(expect.arrayContaining(['wake', 'winddown', 'bed', 'alarm']));
    expect(a.tips.length).toBeGreaterThan(0);
  });

  it('computes readiness from sleep, debt, HRV and resting HR', () => {
    expect(a.readiness).toBeDefined();
    expect(a.readiness!.contributors.map((c) => c.key)).toEqual(expect.arrayContaining(['sleep', 'debt', 'hrv', 'rhr']));
  });

  it('builds trend rows', () => {
    const rows = trendRows(a, data, 30);
    expect(rows).toHaveLength(30);
    expect(rows.filter((r) => r.sleepMin !== undefined).length).toBeGreaterThan(25);
  });

  it('assumes a habitual night when last night has not synced', () => {
    const partial = { ...data, sessions: data.sessions.filter((s) => s.end < now - 12 * HOUR) };
    const b = analyze(partial, now);
    expect(b.lastNightIsCurrent).toBe(false);
    expect(b.energy.assumedLastNight).toBe(true);
    expect(b.energy.now).toBeDefined();
  });

  it('runs fast enough for a phone', () => {
    const t0 = Date.now();
    analyze(data, now + 5 * MINUTE);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
