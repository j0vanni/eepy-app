/**
 * Learning from what actually happens (adherence.ts): the plan log, how late you go to bed vs the
 * plan, how fast your sleep onset really moves — and the planner's ramp for coming nights following it.
 */
import { ADVANCE, estimateAdherence, estimateAdvanceRate, logPlannedNight, PLAN_LOG_DAYS, PlanLog } from '../adherence';
import { analyze } from '../analysis';
import { BODY_CLOCK, planTonight, PlanInput, TonightPlan } from '../schedule';
import { buildNights, computeSessionMetrics } from '../sessions';
import { addDays, atMinutes, formatTime, HOUR, MINUTE } from '../time';
import { night, profile, USER_MON, userLikeData } from './helpers';

const plan = (over: Partial<TonightPlan> = {}): TonightPlan => ({
  wakeDate: '2026-11-03',
  isWorkday: true,
  wake: atMinutes('2026-11-03', 6 * 60),
  bedtime: atMinutes(USER_MON, 23 * 60 + 50),
  windDownStart: atMinutes(USER_MON, 22 * 60 + 50),
  lastMeal: 0,
  lastExercise: 0,
  inBedMin: 370,
  extraForDebtMin: 0,
  gradual: true,
  rationale: [],
  ...over,
});

describe('plan log', () => {
  const evening = atMinutes(USER_MON, 20 * 60);

  it("records eepy's plan and the lights-out you aim for, until that lights-out has passed", () => {
    const log = logPlannedNight(undefined, { tonight: plan(), now: evening });
    expect(log['2026-11-03']).toEqual({ wakeDate: '2026-11-03', planned: plan().bedtime, target: plan().bedtime, wake: plan().wake, held: true });
    // Nothing changed → the very same log (no store write every few minutes).
    expect(logPlannedNight(log, { tonight: plan(), now: evening + HOUR })).toBe(log);
    // "Can't make it": your own time becomes the target, eepy's plan stays known.
    const later = plan({ bedtime: plan().bedtime + 30 * MINUTE, adjusted: { plannedBedtime: plan().bedtime, plannedWake: plan().wake } });
    const moved = logPlannedNight(log, { tonight: later, now: evening + HOUR });
    expect(moved['2026-11-03']).toMatchObject({ planned: plan().bedtime, target: later.bedtime });
    // Once that lights-out has passed the night is frozen — re-planning at 00:30 doesn't rewrite it.
    const past = later.bedtime + 10 * MINUTE;
    expect(logPlannedNight(moved, { tonight: plan({ bedtime: past + 15 * MINUTE }), now: past })).toBe(moved);
  });

  it("never follows an \"I'm in bed\" tap, and first seen late it keeps eepy's own time", () => {
    const log = logPlannedNight(undefined, { tonight: plan(), now: evening });
    const tapped = plan({ bedtime: plan().bedtime - 40 * MINUTE, adjusted: { plannedBedtime: plan().bedtime, plannedWake: plan().wake } });
    expect(logPlannedNight(log, { tonight: tapped, now: evening + HOUR, inBed: true })).toBe(log);
    // eepy opened for the first time at 00:20, after an "Adjust tonight" to 00:30: the target is eepy's plan.
    const late = plan({ bedtime: atMinutes('2026-11-03', 30), adjusted: { plannedBedtime: plan().bedtime, plannedWake: plan().wake } });
    expect(logPlannedNight(undefined, { tonight: late, now: atMinutes('2026-11-03', 20) })['2026-11-03'].target).toBe(plan().bedtime);
  });

  it(`keeps ${PLAN_LOG_DAYS} days`, () => {
    const old: PlanLog = { '2026-09-01': { wakeDate: '2026-09-01', planned: 0, target: 0, wake: 0, held: false } };
    const log = logPlannedNight(old, { tonight: plan(), now: evening });
    expect(Object.keys(log)).toEqual(['2026-11-03']);
  });
});

describe('adherence', () => {
  it('measures how late you go to bed vs the plan (the user-like nights: ~35 min)', () => {
    const { data, planLog } = userLikeData();
    const a = analyze(data, atMinutes(USER_MON, 21 * 60));
    const ad = estimateAdherence({ nights: a.nights, timelines: a.timelines, planLog, latencyMin: a.latencyMin, today: a.day })!;
    expect(ad.nights).toHaveLength(6);
    expect(ad.recentNights).toBe(3);
    expect(ad.recentLateMin).toBeGreaterThanOrEqual(33);
    expect(ad.recentLateMin).toBeLessThanOrEqual(37);
    expect(ad.usualLateMin).toBeGreaterThanOrEqual(33);
    expect(ad.onTimeShare).toBe(0);
    expect(ad.nights.every((n) => n.source === 'watch')).toBe(true);
    // In bed ~1:36 AM lately (asleep ~1:51, 15 min to fall asleep).
    expect(Math.abs(ad.recentLightsOutMin - (60 + 36))).toBeLessThanOrEqual(5);
  });

  it("uses the \"I'm in bed\" tap when there is one", () => {
    const { data, planLog } = userLikeData();
    // Last night: in bed at 00:50 by the tap, the watch only saw sleep from ~01:51.
    const tap = atMinutes(USER_MON, 50);
    const withTap = { ...data, wakeLog: { ...data.wakeLog!, detect: true, inBed: [tap] } };
    const a = analyze(withTap, atMinutes(USER_MON, 21 * 60));
    const ad = estimateAdherence({ nights: a.nights, timelines: a.timelines, planLog, latencyMin: a.latencyMin, today: a.day })!;
    const last = ad.nights[ad.nights.length - 1];
    expect(last.wakeDate).toBe(USER_MON);
    expect(last.source).toBe('tap');
    expect(last.lightsOut).toBe(tap);
    expect(last.lateMin).toBe(Math.round((tap - planLog[USER_MON].target) / MINUTE));
  });

  it('needs a logged plan for at least two recent nights, and ignores a different kind of night', () => {
    const { data, planLog } = userLikeData();
    const a = analyze(data, atMinutes(USER_MON, 21 * 60));
    const input = { nights: a.nights, timelines: a.timelines, latencyMin: a.latencyMin, today: a.day };
    expect(estimateAdherence({ ...input, planLog: undefined })).toBeUndefined();
    expect(estimateAdherence({ ...input, planLog: { [USER_MON]: planLog[USER_MON] } })).toBeUndefined();
    // A plan five hours off what happened (travel, a party) isn't lateness.
    const odd: PlanLog = { ...planLog, [USER_MON]: { ...planLog[USER_MON], target: planLog[USER_MON].target - 5 * HOUR } };
    expect(estimateAdherence({ ...input, planLog: odd })!.nights.map((n) => n.wakeDate)).not.toContain(USER_MON);
  });
});

/** Nights asleep at `onsets` (clock minutes on the evening, may exceed 1440), one per evening up to USER_MON. */
function nightsAt(onsets: number[]) {
  const metrics = onsets.map((o, i) => computeSessionMetrics(night(addDays(USER_MON, i - onsets.length), o, 6))!);
  return buildNights(metrics);
}

describe('advance rate', () => {
  it('flat onsets: slows the ramp to 15 min a night', () => {
    const r = estimateAdvanceRate(nightsAt([120, 125, 118, 122, 120, 119, 121].map((m) => 24 * 60 + m)), USER_MON)!;
    expect(Math.abs(r.observedMinPerNight)).toBeLessThan(3);
    expect(r).toMatchObject({ nights: 7, rampMinPerNight: ADVANCE.minRampMin, adapted: true });
  });

  it('keeping up 30 min a night keeps the default ramp; faster is capped at 45', () => {
    const steady = estimateAdvanceRate(nightsAt([0, 1, 2, 3, 4, 5, 6].map((k) => 27 * 60 - 30 * k)), USER_MON)!;
    expect(steady.observedMinPerNight).toBeCloseTo(30, 0);
    expect(steady).toMatchObject({ rampMinPerNight: BODY_CLOCK.rampMinPerNight, adapted: false });
    const fast = estimateAdvanceRate(nightsAt([0, 1, 2, 3, 4, 5, 6].map((k) => 28 * 60 - 60 * k)), USER_MON)!;
    expect(fast.rampMinPerNight).toBe(ADVANCE.maxRampMin);
  });

  it('a drift later bottoms out at 15; one late Saturday does not swing it', () => {
    expect(estimateAdvanceRate(nightsAt([0, 1, 2, 3, 4, 5].map((k) => 24 * 60 + 20 * k)), USER_MON)!.rampMinPerNight).toBe(15);
    const onsets = [0, 1, 2, 3, 4, 5, 6].map((k) => 27 * 60 - 20 * k);
    onsets[4] += 180;
    const r = estimateAdvanceRate(nightsAt(onsets), USER_MON)!;
    expect(r.observedMinPerNight).toBeGreaterThan(15);
    expect(r.observedMinPerNight).toBeLessThan(25);
    expect(r.rampMinPerNight).toBe(20);
  });

  it(`needs ${ADVANCE.minNights} recent nights`, () => {
    expect(estimateAdvanceRate(nightsAt([120, 110, 100].map((m) => 24 * 60 + m)), USER_MON)).toBeUndefined();
  });
});

describe('the ramp of coming nights follows the advance rate', () => {
  const late: PlanInput = { profile: profile({ workWakeMin: 9 * 60 }), today: USER_MON, needMin: 480, debtMin: 0, efficiency: 0.9, latencyMin: 15, habitualOnsetMin: 2 * 60 };

  it('planTonight steps coming nights by rampMinPerNight and says so', () => {
    const clock = (rampNights: number, rampMinPerNight?: number) => formatTime(planTonight({ ...late, rampNights, rampMinPerNight }).bedtime);
    expect([0, 1, 2, 3].map((k) => clock(k))).toEqual(['01:00', '00:30', '23:52', '23:52']);
    expect([0, 1, 2, 3, 4].map((k) => clock(k, 15))).toEqual(['01:00', '00:45', '00:30', '00:15', '23:52']);
    expect(planTonight({ ...late, rampMinPerNight: 15 }).rationale.join(' ')).toMatch(/aim for 01:00 tonight, then about 15 min earlier each night/);
  });

  it('the analysis plans the week at the pace you have actually kept', () => {
    const { data } = userLikeData();
    const a = analyze(data, atMinutes(USER_MON, 21 * 60));
    // Asleep ~2 AM for weeks, ~1:51 lately: barely moving, so 15 min a night instead of 30.
    expect(a.advance).toMatchObject({ rampMinPerNight: 15, adapted: true });
    expect(a.planInput.rampMinPerNight).toBe(15);
    const held = a.upcoming.slice(0, 4);
    expect(held.every((n) => n.heldBack)).toBe(true);
    const steps = held.slice(1).map((n, i) => Math.round((held[i].bedtime + 24 * HOUR - n.bedtime) / MINUTE));
    expect(steps).toEqual([15, 15, 15]);
    expect(a.tonight.rationale.join(' ')).toMatch(/then about 15 min earlier each night/);
  });
});
