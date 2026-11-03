/**
 * How far lights-out may move ahead of the body clock (schedule.planTonight): sleep debt lets you
 * fall asleep sooner, coming nights step earlier, and a night with an alarm is never planned under
 * five hours of sleep.
 */
import { BODY_CLOCK, bodyClockAdvanceMin, planTonight, PlanInput } from '../schedule';
import { atMinutes, formatTime } from '../time';
import { twoStepSleep } from '../twoStep';
import { profile } from './helpers';

const MON = '2026-11-02'; // tonight → Tuesday morning, a workday

/**
 * The screenshot that started this: up for good at 6:00 with a 5:00 routine, 6h 40m need,
 * ~3h of sleep debt, usually asleep around 2:12 AM. The old rule held lights-out at 1:27 AM — about
 * 3h 40m of sleep before a 5:00 alarm.
 */
const USER: PlanInput = {
  profile: profile({ workWakeMin: 6 * 60, twoStepMorning: { enabled: true, firstWakeMin: 5 * 60, routineMin: 20 } }),
  today: MON,
  needMin: 400,
  debtMin: 179,
  efficiency: 0.9,
  latencyMin: 15,
  habitualOnsetMin: 2 * 60 + 12,
};

describe('lights-out and the body clock', () => {
  it('lets sleep debt move lights-out further ahead of the body clock (1–2 h)', () => {
    expect([0, 90, 179, 180, 600].map(bodyClockAdvanceMin)).toEqual([60, 90, 120, 120, 120]);
  });

  it('never plans a night with an alarm under five hours of sleep', () => {
    const p = planTonight(USER);
    expect(p.gradual).toBe(true);
    expect(formatTime(p.wake)).toBe('06:00');
    // 6:00 − (5 h / 0.9 + 15 min to fall asleep + 30 min for the routine) = 23:42.
    expect(formatTime(p.bedtime)).toBe('23:42');
    expect(p.twoStep).toBeDefined();
    const sleep = twoStepSleep(p.bedtime, p.twoStep!, USER.latencyMin, USER.efficiency);
    expect(sleep.totalMin).toBeGreaterThanOrEqual(BODY_CLOCK.minSleepMin - 2);
    const why = p.rationale.join(' ');
    expect(why).toMatch(/you've been falling asleep around 02:12/);
    expect(why).toMatch(/With 2h 59m of sleep debt you'll get sleepy sooner than usual, so aim for 23:42 tonight, then about 30 min earlier each night/);
    expect(why).toMatch(/doesn't plan a night with an alarm under 5h/);
    expect(why).toMatch(/read until you are/);
    expect(why).toMatch(/bright light soon after your 06:00 wake-up/);
    // The routine comes out of a short night — say so, instead of "lights out 30 min earlier".
    expect(why).toMatch(/the routine costs 30 min of sleep — skipping it/);
    expect(why).not.toMatch(/Lights out 30 min earlier/);
    // The extra time for debt can't happen on a held night, so it isn't promised.
    expect(why).not.toMatch(/to pay down/);
  });

  it('without the floor, holds lights-out the debt-allowed time before the usual sleep onset', () => {
    // Usually asleep 2:00, need-based lights-out 23:52 before a 9:00 wake-up; no debt → an hour ahead.
    const late: PlanInput = { ...USER, profile: profile({ workWakeMin: 9 * 60 }), needMin: 480, debtMin: 0, habitualOnsetMin: 2 * 60 };
    const p = planTonight(late);
    expect(formatTime(p.bedtime)).toBe('01:00');
    // Two hours of debt: 1h 40m ahead (and the need-based lights-out moves 20 min earlier for the debt).
    expect(formatTime(planTonight({ ...late, debtMin: 120 }).bedtime)).toBe('00:20');
  });

  it('steps coming nights earlier, assuming the plan is kept', () => {
    const late: PlanInput = { ...USER, profile: profile({ workWakeMin: 9 * 60 }), needMin: 480, debtMin: 0, habitualOnsetMin: 2 * 60 };
    const clock = (rampNights: number) => formatTime(planTonight({ ...late, today: MON, rampNights }).bedtime);
    // By the third night the hold would be only 8 min — the need-based 23:52 it is.
    expect([0, 1, 2, 3].map(clock)).toEqual(['01:00', '00:30', '23:52', '23:52']);
    expect(planTonight({ ...late, rampNights: 2 }).gradual).toBe(false);
  });

  it('uses the last few nights when they are earlier than the four-week habit', () => {
    const late: PlanInput = { ...USER, profile: profile({ workWakeMin: 9 * 60 }), needMin: 480, debtMin: 0, habitualOnsetMin: 2 * 60 };
    expect(formatTime(planTonight({ ...late, recentOnsetMin: 90 }).bedtime)).toBe('00:30');
    // A late weekend doesn't undo it: the earlier of the two counts.
    expect(formatTime(planTonight({ ...late, recentOnsetMin: 3 * 60 }).bedtime)).toBe('01:00');
  });

  it('a day off with no alarm has no five-hour floor', () => {
    const free: PlanInput = { ...USER, profile: profile({ workWakeMin: 6 * 60, wakePlan: { '2026-11-03': { free: true } }, freeWakeMin: 6 * 60 }), habitualOnsetMin: 3 * 60 };
    const p = planTonight(free);
    expect(p.noAlarm).toBe(true);
    expect(formatTime(p.bedtime)).toBe('01:00');
  });

  it("doesn't hold lights-out for a few minutes", () => {
    // Need-based lights-out 23:52; usually asleep 01:05 → only 13 min past the hour ahead.
    const p = planTonight({ ...USER, profile: profile({ workWakeMin: 9 * 60 }), needMin: 480, debtMin: 0, habitualOnsetMin: 65 });
    expect(p.gradual).toBe(false);
    expect(formatTime(p.bedtime)).toBe('23:52');
    expect(p.bedtime).toBe(atMinutes(MON, 23 * 60 + 52));
  });
});
