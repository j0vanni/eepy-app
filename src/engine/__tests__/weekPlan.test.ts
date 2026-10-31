import { analyze } from '../analysis';
import { generateDemoData } from '../demo';
import { TonightPlan, wakeTargetFor } from '../schedule';
import { addDays, atMinutes, formatTime, MINUTE, startOfDateKey } from '../time';
import { DEFAULT_PROFILE, Profile } from '../types';
import { MAX_ADVANCE_PER_NIGHT_MIN, planUpcomingNights, recoveryExtraMin } from '../weekPlan';

const START = '2026-11-02'; // Monday morning = night 0's wake date
const NEED = 480;

/** A stand-in for planTonight: need-based bedtime from the wake target, no body-clock hold. */
function fakePlanner(profile: Profile) {
  return (wakeDate: string, _debt: number, extra: number): TonightPlan => {
    const t = wakeTargetFor(profile, wakeDate);
    const wake = atMinutes(wakeDate, t.wakeMin);
    const bedtime = wake - (NEED + 20 + extra) * MINUTE;
    return {
      wakeDate,
      isWorkday: t.isWorkday,
      wake,
      bedtime,
      windDownStart: bedtime - 60 * MINUTE,
      lastMeal: bedtime,
      lastExercise: bedtime,
      inBedMin: NEED + 20 + extra,
      extraForDebtMin: extra,
      gradual: false,
      rationale: [],
      ...(t.noAlarm ? { noAlarm: true } : {}),
    };
  };
}

function plan(profile: Profile, debtMin = 0, days = 7) {
  const planNight = fakePlanner(profile);
  return planUpcomingNights({ first: planNight(START, debtMin, 0), planNight, profile, needMin: NEED, latencyMin: 15, efficiency: 0.97, cycleMin: 90, debtMin, days });
}

describe('upcoming nights', () => {
  it('uses the calendar for single mornings: custom wake-ups and free days with no alarm', () => {
    const profile: Profile = { ...DEFAULT_PROFILE, wakePlan: { '2026-11-04': { wakeMin: 6 * 60 + 30 }, '2026-11-06': { free: true } } };
    expect(wakeTargetFor(profile, '2026-11-04')).toEqual({ wakeMin: 390, isWorkday: true, custom: true });
    expect(wakeTargetFor(profile, '2026-11-06')).toMatchObject({ isWorkday: false, custom: true, noAlarm: true });
    const nights = plan(profile);
    const wed = nights.find((n) => n.wakeDate === '2026-11-04')!;
    expect(formatTime(wed.wake)).toBe('06:30');
    expect(wed.custom).toBe(true);
    const fri = nights.find((n) => n.wakeDate === '2026-11-06')!;
    expect(fri.noAlarm).toBe(true);
    expect(fri.alarm).toBeUndefined();
    expect(nights.find((n) => n.wakeDate === '2026-11-05')!.alarm).toBeDefined();
  });

  it('eases into an early morning: earlier nights move at most 45 min a night', () => {
    const profile: Profile = { ...DEFAULT_PROFILE, wakePlan: { '2026-11-05': { wakeMin: 4 * 60 + 30 } } };
    const nights = plan(profile);
    const clock = (i: number) => (nights[i].bedtime - startOfDateKey(nights[i].wakeDate)) / MINUTE;
    for (let i = 0; i < nights.length - 1; i++) expect(clock(i) - clock(i + 1)).toBeLessThanOrEqual(MAX_ADVANCE_PER_NIGHT_MIN);
    const before = nights.find((n) => n.wakeDate === '2026-11-04')!;
    expect(before.preShiftMin).toBeGreaterThan(0);
    expect(before.preShiftFor).toBe('2026-11-05');
    // Two nights before is eased too (the jump is 2.5 h).
    expect(nights.find((n) => n.wakeDate === '2026-11-03')!.preShiftFor).toBe('2026-11-05');
  });

  it('pays sleep debt back over several nights, at most +30 min a night', () => {
    expect([0, 20, 45, 60, 150, 400].map(recoveryExtraMin)).toEqual([0, 0, 10, 15, 30, 30]);
    const nights = plan(DEFAULT_PROFILE, 150);
    expect(nights[1].extraForDebtMin).toBe(30);
    expect(nights[1].debtAfterMin).toBeLessThan(nights[0].debtAfterMin);
    const last = nights[nights.length - 1];
    expect(last.extraForDebtMin).toBeLessThan(nights[1].extraForDebtMin);
    expect(last.debtAfterMin).toBeLessThan(150);
  });

  it('plans tonight from the calendar too', () => {
    const now = atMinutes('2026-10-29', 19 * 60);
    const data = generateDemoData(now);
    const plain = analyze(data, now);
    const tomorrow = plain.tonight.wakeDate;
    const late = analyze({ ...data, profile: { ...data.profile, wakePlan: { [tomorrow]: { wakeMin: 9 * 60 + 30 } } } }, now);
    expect(formatTime(late.tonight.wake)).toBe('09:30');
    expect(late.tonight.bedtime).toBeGreaterThan(plain.tonight.bedtime);
    // Far earlier than the body clock allows: held back (shorter night) rather than lying awake.
    const veryEarly = analyze({ ...data, profile: { ...data.profile, wakePlan: { [tomorrow]: { wakeMin: 4 * 60 } } } }, now);
    expect(veryEarly.tonight.gradual).toBe(true);
    const free = analyze({ ...data, profile: { ...data.profile, wakePlan: { [tomorrow]: { free: true } } } }, now);
    expect(free.tonight.noAlarm).toBe(true);
    expect(free.upcoming[0].alarm).toBeUndefined();
    expect(plain.upcoming).toHaveLength(14);
    expect(plain.upcoming[0].bedtime).toBe(plain.tonight.bedtime);
    expect(plain.upcoming[1].wakeDate).toBe(addDays(tomorrow, 1));
  });
});
