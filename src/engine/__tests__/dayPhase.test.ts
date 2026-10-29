import { AlertnessPoint, EnergyForecast, forecastEnergy } from '../alertness';
import { analyze } from '../analysis';
import { curvePosition, dayPhase, DayPhaseInput, energyAt, fallAsleepNowOptions, nightWakeTarget, phaseInputFor } from '../dayPhase';
import { generateDemoData } from '../demo';
import { atMinutes, HOUR, MINUTE } from '../time';
import { night, profile } from './helpers';

const DAY = '2026-10-21';
const at = (h: number, day = DAY) => atMinutes(day, h * 60);

// Up at 07:00, wind-down 22:00, lights out 23:00, alarm 06:55 tomorrow.
const plan: DayPhaseInput = { wakeTime: at(7), windDownStart: at(22), bedtime: at(23), nextWake: at(6 + 55 / 60, '2026-10-22') };

describe('dayPhase', () => {
  it.each([
    [7, 'morning'],
    [9.9, 'morning'],
    [10, 'day'],
    [15, 'day'],
    [19.9, 'day'],
    [20, 'evening'],
    [22.5, 'evening'],
    [23, 'night'],
    [26, 'night'], // 02:00 the next calendar day, still the same plan
  ] as const)('at %sh it is %s', (h, phase) => {
    expect(dayPhase(at(h), plan)).toBe(phase);
  });

  it('ends the night at the next wake-up', () => {
    expect(dayPhase(plan.nextWake - MINUTE, plan)).toBe('night');
    expect(dayPhase(plan.nextWake, plan)).toBe('morning');
    expect(dayPhase(plan.nextWake + 4 * HOUR, plan)).toBe('day');
  });

  it('is night before this morning’s wake-up once the day has rolled over', () => {
    const input = { ...plan, wakeTime: at(7) };
    expect(dayPhase(at(4.5), input)).toBe('night');
    expect(dayPhase(at(6.9), input)).toBe('night');
  });

  it('counts being up shortly before the planned wake as morning when last night has not synced', () => {
    const planned = { ...plan, wakeRecorded: false };
    expect(dayPhase(at(5.5), planned)).toBe('night');
    expect(dayPhase(at(6.25), planned)).toBe('morning');
    expect(dayPhase(at(9.5), planned)).toBe('morning');
    expect(dayPhase(at(10.5), planned)).toBe('day');
  });

  it('lets morning win over evening on a very late wake-up', () => {
    const late = { ...plan, wakeTime: at(15), windDownStart: at(18), bedtime: at(19) };
    expect(dayPhase(at(17), late)).toBe('morning');
    expect(dayPhase(at(18.2), late)).toBe('evening');
  });

  it('handles a bedtime after midnight', () => {
    const owl = { ...plan, windDownStart: at(23.5), bedtime: at(24.5), nextWake: at(8.5, '2026-10-22') };
    expect(dayPhase(at(21), owl)).toBe('day');
    expect(dayPhase(at(21.6), owl)).toBe('evening');
    expect(dayPhase(at(24.25), owl)).toBe('evening');
    expect(dayPhase(at(24.5), owl)).toBe('night');
  });

  it('works across the DST change (America/Chicago falls back on 1 Nov 2026)', () => {
    const dst: DayPhaseInput = {
      wakeTime: atMinutes('2026-10-31', 7 * 60),
      windDownStart: atMinutes('2026-10-31', 22 * 60),
      bedtime: atMinutes('2026-10-31', 23 * 60),
      nextWake: atMinutes('2026-11-01', 7 * 60),
    };
    // 9 real hours between lights-out and the alarm on the night clocks go back.
    expect((dst.nextWake - dst.bedtime) / HOUR).toBe(9);
    expect(dayPhase(atMinutes('2026-11-01', 6.5 * 60), dst)).toBe('night');
    expect(dayPhase(atMinutes('2026-11-01', 7 * 60), dst)).toBe('morning');
  });

  it('knows which wake-up the night is heading for', () => {
    expect(nightWakeTarget(at(23.5), plan)).toBe(plan.nextWake);
    expect(nightWakeTarget(at(5), plan)).toBe(plan.wakeTime);
  });
});

describe('phaseInputFor', () => {
  it('uses the recorded wake once last night has synced, the plan before', () => {
    const now = atMinutes('2026-10-29', 13 * 60);
    const data = generateDemoData(now);
    const a = analyze(data, now);
    const input = phaseInputFor(a, data.profile);
    expect(a.lastNightIsCurrent).toBe(true);
    expect(input.wakeTime).toBe(a.wakeTime);
    expect(input.wakeRecorded).toBe(true);
    expect(input.bedtime).toBe(a.tonight.bedtime);
    expect(input.nextWake).toBe(a.alarm.alarm);
    expect(dayPhase(now, input)).toBe('day');
  });

  it('falls back to the planned wake when last night is missing', () => {
    const sessions = [night('2026-10-18', 23 * 60, 8), night('2026-10-19', 23 * 60, 8)];
    const p = profile({ workWakeMin: 7 * 60 });
    const now = atMinutes('2026-10-21', 5 * 60);
    const a = analyze({ sessions, vitals: {}, daily: {}, dayLogs: {}, caffeine: [], profile: p }, now);
    expect(a.lastNightIsCurrent).toBe(false);
    const input = phaseInputFor(a, p);
    expect(input.wakeRecorded).toBe(false);
    expect(input.wakeTime).toBeGreaterThan(now);
    expect(dayPhase(now, input)).toBe('night');
  });
});

describe('energy curve position', () => {
  const pts = (values: number[], start = at(7)): AlertnessPoint[] =>
    values.map((energy, i) => ({ t: start + i * 30 * MINUTE, energy, asleep: false, S: 0, C: 0, W: 0, alertness: 0, kss: 0 }));

  it('interpolates energy between points', () => {
    const p = pts([40, 60, 50]);
    expect(energyAt(p, at(7))).toBe(40);
    expect(energyAt(p, at(7.25))).toBeCloseTo(50);
    expect(energyAt(p, at(8))).toBe(50);
    expect(energyAt(p, at(6.9))).toBeUndefined();
    expect(energyAt(p, at(8.1))).toBeUndefined();
    expect(energyAt([], at(7))).toBeUndefined();
  });

  it('reports trend, the next event and whether you are in the dip', () => {
    const points = pts([30, 50, 70, 75, 60, 50, 55, 65, 60, 40]);
    const f: EnergyForecast = {
      points,
      wakeTime: at(7),
      bedtime: at(11.5),
      peaks: [{ t: at(8.5), energy: 75 }],
      dip: { t: at(9.5), energy: 50, start: at(9), end: at(10) },
      focusWindows: [{ start: at(8), end: at(9) }],
      assumedLastNight: false,
    };
    const early = curvePosition(f, at(7.25))!;
    expect(early.trend).toBe('rising');
    expect(early.next).toEqual({ kind: 'peak', t: at(8.5), energy: 75 });
    expect(early.inFocus).toBe(false);

    const focus = curvePosition(f, at(8.5))!;
    expect(focus.inFocus).toBe(true);
    expect(focus.trend).toBe('falling');
    expect(focus.next?.kind).toBe('dip');

    const dip = curvePosition(f, at(9.5))!;
    expect(dip.inDip).toBe(true);
    expect(dip.trend).toBe('rising');
    expect(dip.next?.kind).toBe('bedtime');

    expect(curvePosition(f, at(12))).toBeUndefined();
  });

  it('finds the afternoon dip on a real forecast', () => {
    const sleeps = [];
    for (let d = -6; d <= 0; d++) sleeps.push({ start: at(23) + (d - 1) * 24 * HOUR, end: at(7) + d * 24 * HOUR });
    const f = forecastEnergy({ sleeps, now: at(10), wakeTime: at(7), bedtime: at(23), nextWake: at(7, '2026-10-22'), midSleepMin: 180, debtMin: 0 });
    const pos = curvePosition(f, at(10))!;
    expect(pos.energy).toBeGreaterThan(50);
    expect(f.dip).toBeDefined();
    expect(curvePosition(f, f.dip!.t)!.inDip).toBe(true);
  });
});

describe('fallAsleepNowOptions', () => {
  const opts = { cycleMin: 90, latencyMin: 15, needMin: 480 };

  it('lists whole cycles from now plus the time to fall asleep', () => {
    const list = fallAsleepNowOptions(at(23), opts);
    expect(list.map((o) => o.cycles)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(list[4].wake).toBe(at(23) + (5 * 90 + 15) * MINUTE);
    // Without a planned wake the best option is the one that covers the need.
    expect(list.find((o) => o.best)?.cycles).toBe(6);
  });

  it('picks the longest option that still fits before the latest wake-up', () => {
    const list = fallAsleepNowOptions(at(24 + 40 / 60), { ...opts, latestWake: at(7, '2026-10-22') });
    // 00:40 + 15 min + 4 × 90 min = 06:55.
    const best = list.find((o) => o.best)!;
    expect(best.cycles).toBe(4);
    expect(best.fitsBeforeWake).toBe(true);
    expect(list.find((o) => o.cycles === 5)!.fitsBeforeWake).toBe(false);
    // Five minutes earlier and the same option no longer fits.
    expect(fallAsleepNowOptions(at(24 + 40 / 60), { ...opts, latestWake: at(6 + 50 / 60, '2026-10-22') }).find((o) => o.best)!.cycles).toBe(3);
  });
});
