import { bedtimeDelayMin, circadian, inertiaAmplitude, simulateAlertness, sleepPressureAt } from '../alertness';
import { caffeineAt, caffeineCutoff } from '../caffeine';
import { analyzeChronotype, categoryFromMsfSc, categoryFromRmeq } from '../chronotype';
import { planJetLag } from '../jetlag';
import { analyzeRegularity } from '../regularity';
import { bedtimesForWake, planTonight, shiftSchedule, smartAlarm, wakesForBedtime } from '../schedule';
import { scoreQuiz } from '../screening';
import { analyzeSessions, buildNights, computeSessionMetrics } from '../sessions';
import { scoreSleep } from '../sleepScore';
import { addDays, atMinutes, formatTime, HOUR, MINUTE, minutesOfDay, weekdayOfKey } from '../time';
import { night, profile } from './helpers';

const DAY = '2026-10-21';

function regularSleeps(lastNightH = 8) {
  const out = [];
  for (let d = -6; d <= 0; d++) {
    const wake = atMinutes(DAY, 7 * 60) + d * 24 * HOUR;
    out.push({ start: wake - (d === 0 ? lastNightH : 8) * HOUR, end: wake });
  }
  return out;
}

describe('alertness model', () => {
  const energyAt = (sleeps: { start: number; end: number }[], hh: number, debtMin = 0) =>
    simulateAlertness(sleeps, atMinutes(DAY, 7 * 60), atMinutes(DAY, 23.5 * 60), { midSleepMin: 180, debtMin }).find(
      (p) => p.t >= atMinutes(DAY, hh * 60),
    )!.energy;

  it('reproduces the daily shape: groggy on waking, afternoon dip, evening decline', () => {
    const s = regularSleeps();
    expect(energyAt(s, 7.1)).toBeLessThan(energyAt(s, 10));
    expect(energyAt(s, 14)).toBeLessThan(energyAt(s, 10));
    expect(energyAt(s, 14)).toBeLessThan(energyAt(s, 17.5));
    expect(energyAt(s, 23)).toBeLessThan(energyAt(s, 14) - 15);
  });

  it('lowers energy after a short night and with sleep debt', () => {
    expect(energyAt(regularSleeps(5), 11, 180)).toBeLessThan(energyAt(regularSleeps(8), 11) - 8);
  });

  it('models nap inertia by depth of sleep', () => {
    expect(inertiaAmplitude(15)).toBeLessThan(inertiaAmplitude(45));
    expect(inertiaAmplitude(90)).toBeLessThan(inertiaAmplitude(45));
  });

  it('puts the circadian low in the early morning', () => {
    expect(circadian(atMinutes(DAY, 5 * 60), 180)).toBeLessThan(circadian(atMinutes(DAY, 17 * 60), 180));
  });

  it('estimates bigger bedtime delays for longer, later naps', () => {
    const s = regularSleeps();
    const bed = atMinutes(DAY, 23 * 60);
    const short = bedtimeDelayMin(s, { start: atMinutes(DAY, 13 * 60), end: atMinutes(DAY, 13 * 60 + 20) }, bed);
    const long = bedtimeDelayMin(s, { start: atMinutes(DAY, 13 * 60), end: atMinutes(DAY, 14 * 60 + 30) }, bed);
    const late = bedtimeDelayMin(s, { start: atMinutes(DAY, 18 * 60), end: atMinutes(DAY, 18 * 60 + 20) }, bed);
    expect(short).toBeGreaterThan(0);
    expect(short).toBeLessThan(40);
    expect(long).toBeGreaterThan(short * 2);
    expect(late).toBeGreaterThan(short);
    expect(sleepPressureAt(s, bed)).toBeGreaterThan(sleepPressureAt(s, atMinutes(DAY, 9 * 60)));
  });
});

describe('caffeine', () => {
  const coffee = (h: number, mg = 95) => ({ id: String(h), time: atMinutes(DAY, h * 60), mg, label: 'coffee' });

  it('peaks within about an hour and halves every half-life', () => {
    const peakAt = [15, 30, 45, 60, 90, 120].map((mm) => caffeineAt([coffee(8)], atMinutes(DAY, 8 * 60 + mm), 5));
    expect([peakAt[2], peakAt[3]]).toContain(Math.max(...peakAt));
    const a = caffeineAt([coffee(8)], atMinutes(DAY, 12 * 60), 5);
    const b = caffeineAt([coffee(8)], atMinutes(DAY, 17 * 60), 5);
    expect(b / a).toBeCloseTo(0.5, 1);
  });

  it('suggests a cut-off several hours before bed and flags when already over', () => {
    const bed = atMinutes(DAY, 23 * 60);
    const r = caffeineCutoff([coffee(8)], bed, 5, 50);
    expect(r.overLimit).toBe(false);
    const hoursBefore = (bed - r.cutoff!) / HOUR;
    expect(hoursBefore).toBeGreaterThan(6);
    expect(hoursBefore).toBeLessThan(11);
    expect(caffeineCutoff([coffee(18, 200)], bed, 5, 50).overLimit).toBe(true);
  });
});

describe('chronotype', () => {
  it('computes MSFsc and social jet lag MCTQ-style', () => {
    const sessions = [];
    for (let i = 1; i <= 28; i++) {
      const wakeDate = addDays('2026-10-28', -i);
      const free = [0, 6].includes(weekdayOfKey(wakeDate));
      // Work: 23:30–06:30 (7h). Free: 01:00–10:00 (9h).
      sessions.push(night(addDays(wakeDate, -1), free ? 25 * 60 : 23.5 * 60, free ? 9 : 7, { latencyMin: 0 }));
    }
    const nights = buildNights(analyzeSessions(sessions));
    const r = analyzeChronotype({ nights, profile: profile(), dayLogs: {} });
    expect(r.source).toBe('data');
    expect(r.socialJetlagMin).toBeCloseTo(150, -1);
    // MSF 05:30 corrected for oversleep → earlier than 05:30.
    expect(r.msfScMin!).toBeLessThan(5.5 * 60);
    expect(r.category).toBe('intermediate');
  });

  it('maps scores to categories', () => {
    expect(categoryFromMsfSc(2 * 60)).toBe('early');
    expect(categoryFromMsfSc(23 * 60)).toBe('early');
    expect(categoryFromMsfSc(6.5 * 60)).toBe('late');
    expect(categoryFromRmeq(24)).toBe('early');
    expect(categoryFromRmeq(14)).toBe('intermediate');
    expect(categoryFromRmeq(5)).toBe('late');
  });
});

describe('regularity', () => {
  const build = (jitter: (i: number) => number) => {
    const sessions = [];
    for (let i = 0; i < 16; i++) sessions.push(night(addDays('2026-10-10', i), 23 * 60 + jitter(i), 8, { latencyMin: 0 }));
    const metrics = analyzeSessions(sessions);
    return analyzeRegularity(metrics, buildNights(metrics), '2026-10-26', 20, 14);
  };

  it('scores a perfectly regular schedule near 100', () => {
    expect(build(() => 0).sri).toBeGreaterThan(97);
  });

  it('scores an alternating schedule lower', () => {
    const r = build((i) => (i % 2 ? 150 : 0));
    expect(r.sri).toBeLessThan(75);
    expect(r.label).not.toBe('very regular');
  });
});

describe('scheduling', () => {
  it('offers bedtimes on cycle boundaries and recommends the smallest that covers need', () => {
    const wake = atMinutes(DAY, 7 * 60);
    const opts = bedtimesForWake(wake, 90, 15, 480);
    const rec = opts.find((o) => o.recommended)!;
    expect(rec.cycles).toBe(6);
    expect(formatTime(rec.bedtime)).toBe('21:45');
    expect(wakesForBedtime(atMinutes(DAY, 23 * 60), 90, 15, 450).find((o) => o.recommended)!.cycles).toBe(5);
  });

  it('places the smart alarm on a cycle boundary within the window', () => {
    const r = smartAlarm(atMinutes(DAY, 23 * 60), atMinutes('2026-10-22', 7 * 60), 90, 15, 30);
    expect(r.onBoundary).toBe(true);
    expect(formatTime(r.alarm)).toBe('06:45');
  });

  it('plans tonight from need, efficiency, latency and debt', () => {
    const p = profile({ workWakeMin: 7 * 60 });
    const plan = planTonight({ profile: p, today: '2026-10-20', needMin: 480, debtMin: 0, efficiency: 0.92, latencyMin: 15 });
    expect(plan.isWorkday).toBe(true);
    expect(formatTime(plan.wake)).toBe('07:00');
    expect(plan.inBedMin).toBe(Math.round(480 / 0.92 + 15));
    const withDebt = planTonight({ profile: p, today: '2026-10-20', needMin: 480, debtMin: 300, payoffExtraMin: 45, efficiency: 0.92, latencyMin: 15 });
    expect(withDebt.bedtime).toBe(plan.bedtime - 45 * MINUTE);
  });

  it('holds back a bedtime far earlier than the body clock and handles post-midnight habits', () => {
    const p = profile({ workWakeMin: 7 * 60 });
    const plan = planTonight({ profile: p, today: '2026-10-20', needMin: 480, debtMin: 0, efficiency: 0.92, latencyMin: 15, habitualOnsetMin: 30 });
    expect(plan.gradual).toBe(true);
    expect(formatTime(plan.bedtime)).toBe('23:45');
    expect(plan.bedtime).toBeGreaterThan(atMinutes('2026-10-20', 20 * 60));
  });

  it('shifts a schedule earlier in 20-minute steps', () => {
    const r = shiftSchedule(8 * 60, 6 * 60 + 30, 510, '2026-10-21');
    expect(r.direction).toBe('earlier');
    expect(r.days).toHaveLength(5);
    expect(r.days[r.days.length - 1].wakeMin).toBe(6 * 60 + 30);
  });
});

describe('jet lag', () => {
  it('advances for moderate eastward travel', () => {
    const p = planJetLag({ homeOffsetMin: -300, destOffsetMin: 60, bedtimeMin: 23 * 60, wakeMin: 7 * 60, preDays: 2 });
    expect(p.direction).toBe('east');
    expect(p.strategy).toBe('advance');
    expect(p.daysToAdjust).toBe(4);
    expect(p.days[0].dayIndex).toBe(-2);
    // Pre-flight days shift 1h earlier per day (home time).
    expect(p.days[0].bedtimeMin).toBe(22 * 60);
    expect(p.days[1].bedtimeMin).toBe(21 * 60);
    // After arrival, sleep on local time at the usual clock times.
    const day1 = p.days.find((d) => d.dayIndex === 1)!;
    expect(day1.bedtimeMin).toBe(23 * 60);
    expect(day1.wakeMin).toBe(7 * 60);
    // Body still ~3h behind: CBTmin ≈ 08:00 local, so seek light after it, avoid it before.
    expect(day1.seekLight).toEqual({ startMin: 8 * 60, endMin: 11 * 60 });
    expect(day1.avoidLight).toEqual({ startMin: 5 * 60, endMin: 8 * 60 });
  });

  it('delays the long way round for very large eastward jumps', () => {
    const p = planJetLag({ homeOffsetMin: -480, destOffsetMin: 540, bedtimeMin: 23 * 60, wakeMin: 7 * 60, preDays: 0 });
    expect(p.shiftHours).toBe(-7);
    expect(p.direction).toBe('west');
    const q = planJetLag({ homeOffsetMin: 0, destOffsetMin: 600, bedtimeMin: 23 * 60, wakeMin: 7 * 60, preDays: 0 });
    expect(q.strategy).toBe('delay');
  });

  it('delays for westward travel at 1.5h/day', () => {
    const p = planJetLag({ homeOffsetMin: 60, destOffsetMin: -300, bedtimeMin: 23 * 60, wakeMin: 7 * 60, preDays: 0 });
    expect(p.strategy).toBe('delay');
    expect(p.daysToAdjust).toBe(4);
  });
});

describe('sleep score', () => {
  it('rewards a full, efficient, on-time night and penalises a short one', () => {
    const good = computeSessionMetrics(night('2026-10-20', 23 * 60, 8, { latencyMin: 12 }))!;
    const short = computeSessionMetrics(night('2026-10-20', 25 * 60, 5, { latencyMin: 40 }))!;
    const ctx = { needMin: 480, age: 30, habitualMidSleepMin: 3 * 60 };
    const g = scoreSleep(good, ctx);
    const s = scoreSleep(short, ctx);
    expect(g.total).toBeGreaterThanOrEqual(85);
    expect(s.total).toBeLessThan(60);
    expect(g.components.map((c) => c.key)).toEqual(['duration', 'efficiency', 'latency', 'deep', 'rem', 'disruptions', 'timing']);
    expect(minutesOfDay(good.midSleep)).toBe(3 * 60);
  });
});

describe('screening', () => {
  it('scores the Epworth-style scale into bands', () => {
    expect(scoreQuiz('ess', [1, 1, 1, 1, 2, 0, 1, 1]).band.label).toBe('Normal');
    expect(scoreQuiz('ess', [3, 3, 2, 2, 3, 1, 2, 1]).band.level).toBe('alert');
  });

  it('applies the STOP-Bang high-risk rule', () => {
    expect(scoreQuiz('stopbang', [1, 1, 0, 0, 0, 0, 0, 1]).band.label).toBe('High risk');
    expect(scoreQuiz('stopbang', [1, 0, 0, 0, 0, 1, 0, 0]).band.label).toBe('Low risk');
  });
});
