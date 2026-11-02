import { analyze } from '../analysis';
import { generateDemoData } from '../demo';
import { applyTonightOverride, planTonight, PlanInput } from '../schedule';
import { atMinutes, MINUTE } from '../time';
import { checkTwoStep, DEFAULT_TWO_STEP, routineWindowFor, twoStepConfig, twoStepFor, twoStepLine, twoStepSetting, twoStepSleep } from '../twoStep';
import type { Profile, SleepDataset, TwoStepMorning } from '../types';
import { profile } from './helpers';

/** Thursday 2026-10-22 → tonight's plan is for Friday 2026-10-23 (a workday). */
const THU = '2026-10-22';
const FRI = '2026-10-23';
const fri = (min: number) => atMinutes(FRI, min);

const TWO: TwoStepMorning = { enabled: true, firstWakeMin: 5 * 60, routineMin: 20 };
/** The user: up at 5:00 for the routine, final wake-up 6:05. */
const userProfile = (over: Partial<Profile> = {}) => profile({ workWakeMin: 6 * 60 + 5, twoStepMorning: TWO, ...over });

const BASE: PlanInput = { profile: profile({ workWakeMin: 6 * 60 + 5 }), today: THU, needMin: 450, debtMin: 0, efficiency: 0.9, latencyMin: 15 };

describe('the setting', () => {
  it('defaults to off, with a 5:00 alarm and a 20-min routine, on your workdays', () => {
    expect(DEFAULT_TWO_STEP).toEqual({ enabled: false, firstWakeMin: 300, routineMin: 20 });
    expect(twoStepSetting(profile())).toEqual(DEFAULT_TWO_STEP);
    expect(twoStepConfig(profile())).toBeUndefined();
    expect(twoStepConfig(userProfile())).toEqual({ firstWakeMin: 300, routineMin: 20, fallBackAsleepMin: 10, days: [1, 2, 3, 4, 5], gapMin: 65, since: undefined });
    // A partly saved setting gets its defaults.
    expect(twoStepConfig(profile({ workWakeMin: 365, twoStepMorning: { enabled: true } as TwoStepMorning }))?.routineMin).toBe(20);
  });

  it('explains settings that would not work', () => {
    expect(checkTwoStep(userProfile({ workWakeMin: 4 * 60 + 30 }))).toMatchObject({ ok: false, off: false, reason: expect.stringMatching(/before your 04:30 wake-up/) });
    expect(checkTwoStep(userProfile({ workWakeMin: 9 * 60 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/at most 3 hours/) });
    // 5:00 → 5:30 back in bed (20 + 10 to fall asleep) leaves only 5 min before 5:35.
    expect(checkTwoStep(userProfile({ workWakeMin: 5 * 60 + 35 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/Only 5 min would be left/) });
    expect(checkTwoStep(userProfile({ twoStepMorning: { ...TWO, days: [] } }))).toMatchObject({ ok: false, reason: 'Pick at least one morning.' });
    expect(checkTwoStep(profile())).toMatchObject({ ok: false, off: true });
  });

  it('applies to mornings with a fixed wake-up on its days — never free days', () => {
    const p = userProfile();
    expect(twoStepFor(p, FRI, { wakeMin: 365, isWorkday: true })).toBeDefined();
    expect(twoStepFor(p, '2026-10-24', { wakeMin: 425, isWorkday: false })).toBeUndefined();
    expect(twoStepFor(p, FRI, { wakeMin: 425, isWorkday: false, noAlarm: true })).toBeUndefined();
    // A calendar wake-up on a Saturday is only two-step if Saturday is one of its days.
    expect(twoStepFor(p, '2026-10-24', { wakeMin: 420, isWorkday: true })).toBeUndefined();
    expect(twoStepFor(userProfile({ twoStepMorning: { ...TWO, days: [6] } }), '2026-10-24', { wakeMin: 420, isWorkday: true })).toBeDefined();
  });
});

describe('planning a two-step night', () => {
  const off = planTonight(BASE);
  const on = planTonight({ ...BASE, profile: userProfile() });

  it('keeps the final wake-up and moves lights-out earlier by the routine + falling back asleep', () => {
    expect(on.wake).toBe(off.wake);
    expect(on.wake).toBe(fri(365));
    expect(off.bedtime - on.bedtime).toBe(30 * MINUTE);
    // 7h 30m need / 0.9 + 15 min to fall asleep + 30 min awake for the routine = 9h 05m before 6:05.
    expect(on.inBedMin).toBe(545);
    expect(on.bedtime).toBe(atMinutes(THU, 21 * 60));
    expect(on.twoStep).toEqual({
      firstWake: fri(300),
      firstAlarm: fri(300),
      routineEnd: fri(320),
      backToSleep: fri(330),
      routineMin: 20,
      fallBackAsleepMin: 10,
      awakeMin: 30,
      // 5:30 → 6:05 at 90% efficiency.
      backToSleepMin: 32,
    });
  });

  it('plans the two stretches to add up to the sleep need', () => {
    const s = twoStepSleep(on.bedtime, on.twoStep!, BASE.latencyMin, BASE.efficiency);
    expect(s.backMin).toBe(32);
    expect(s.mainMin).toBe(Math.round((8 * 60 - 15) * 0.9));
    expect(Math.abs(s.totalMin - BASE.needMin)).toBeLessThanOrEqual(2);
    expect(twoStepLine({ bedtime: on.bedtime, wake: on.wake, twoStep: on.twoStep! }, 15, 0.9)).toBe('Lights out 21:00 → 05:00 routine alarm → back to sleep ~05:30 → up 06:05 · 7h 31m sleep');
  });

  it('explains it in the rationale', () => {
    expect(on.rationale[0]).toBe(off.rationale[0]);
    expect(on.rationale[1]).toBe(
      'Two-step morning: routine alarm by 05:00 (cycle-timed), back in bed ~05:20 and asleep again ~05:30 until 06:05. Lights out 30 min earlier so the two stretches still add up to your need — the 20-min routine and falling back asleep are time awake.',
    );
  });

  it('changes nothing when the setting is off (or missing)', () => {
    expect(planTonight({ ...BASE, profile: userProfile({ twoStepMorning: { ...TWO, enabled: false } }) })).toEqual(off);
    expect(off.twoStep).toBeUndefined();
  });

  it('never splits a free day', () => {
    const sat = planTonight({ ...BASE, today: FRI, profile: userProfile() });
    expect(sat.isWorkday).toBe(false);
    expect(sat.twoStep).toBeUndefined();
    const free = planTonight({ ...BASE, profile: userProfile({ wakePlan: { [FRI]: { free: true } } }) });
    expect(free.noAlarm).toBe(true);
    expect(free.twoStep).toBeUndefined();
  });

  it('keeps the same gap before a calendar wake-up', () => {
    const early = planTonight({ ...BASE, profile: userProfile({ wakePlan: { [FRI]: { wakeMin: 5 * 60 + 30 } } }) });
    expect(early.wake).toBe(fri(330));
    expect(early.twoStep?.firstWake).toBe(fri(330 - 65));
    // An early first event moves the final wake-up — the routine alarm moves with it.
    const event = planTonight({ ...BASE, profile: userProfile(), firstEventStart: fri(7 * 60), firstEventPrepMin: 90 });
    expect(event.wake).toBe(fri(330));
    expect(event.twoStep?.firstWake).toBe(fri(265));
  });

  it('a single date can switch the routine off, or on outside its days', () => {
    // Friday is a usual two-step morning — off for just that date: one alarm, lights out 30 min later.
    const skip = planTonight({ ...BASE, profile: userProfile({ wakePlan: { [FRI]: { twoStep: false } } }) });
    expect(skip.twoStep).toBeUndefined();
    expect(skip.wake).toBe(off.wake);
    expect(skip.bedtime).toBe(off.bedtime);
    // Not one of its days (Mon–Wed only) — on for just Friday.
    const p = userProfile({ twoStepMorning: { ...TWO, days: [1, 2, 3] }, wakePlan: { [FRI]: { twoStep: true } } });
    expect(planTonight({ ...BASE, profile: p }).twoStep?.firstWake).toBe(fri(300));
    // Works with a set time too, keeping the gap.
    const custom = planTonight({ ...BASE, profile: userProfile({ twoStepMorning: { ...TWO, days: [1] }, wakePlan: { [FRI]: { wakeMin: 7 * 60, twoStep: true } } }) });
    expect(custom.twoStep?.firstWake).toBe(fri(7 * 60 - 65));
    // Even while the weekly setting is off.
    const weeklyOff = userProfile({ twoStepMorning: { ...TWO, enabled: false }, wakePlan: { [FRI]: { twoStep: true } } });
    expect(planTonight({ ...BASE, profile: weeklyOff }).twoStep).toBeDefined();
    // A day off in the calendar has no alarms at all.
    expect(twoStepFor(userProfile({ wakePlan: { [FRI]: { free: true, twoStep: true } } }), FRI, { wakeMin: 425, isWorkday: false, noAlarm: true })).toBeUndefined();
    // On a weekend morning (an alarm, just a later one).
    expect(twoStepFor(userProfile({ wakePlan: { '2026-10-24': { twoStep: true } } }), '2026-10-24', { wakeMin: 425, isWorkday: false })).toBeDefined();
    // The times still have to work.
    expect(twoStepFor(userProfile({ workWakeMin: 4 * 60, wakePlan: { [FRI]: { twoStep: true } } }), FRI, { wakeMin: 240, isWorkday: true })).toBeUndefined();
  });

  it('only on the chosen days', () => {
    const p = userProfile({ twoStepMorning: { ...TWO, days: [1, 2, 3] } });
    expect(planTonight({ ...BASE, profile: p }).twoStep).toBeUndefined(); // Friday
    expect(planTonight({ ...BASE, today: '2026-10-20', profile: p }).twoStep).toBeDefined(); // Wednesday
  });

  it('pauses under a prescribed CBT-I window', () => {
    const p = planTonight({ ...BASE, profile: userProfile(), sleepWindow: { bedMin: 23 * 60 + 30, wakeMin: 6 * 60 + 5, reason: 'Programme window.' } });
    expect(p.twoStep).toBeUndefined();
    expect(p.rationale).toEqual(['Programme window.', expect.stringMatching(/^Two-step morning paused/)]);
  });

  it('still splits a night held back by the body clock, with less sleep before the routine', () => {
    const held = planTonight({ ...BASE, profile: userProfile(), habitualOnsetMin: 23 * 60 + 30 });
    expect(held.gradual).toBe(true);
    expect(held.twoStep?.firstWake).toBe(fri(300));
    expect(held.bedtime).toBeGreaterThan(on.bedtime);
  });

  it('"Adjust tonight": a moved wake-up keeps the gap; lights-out right before the routine drops it', () => {
    const later = applyTonightOverride(on, { wakeDate: FRI, wake: fri(395) }, 60);
    expect(later.twoStep?.firstWake).toBe(fri(330));
    expect(later.twoStep?.backToSleepMin).toBe(on.twoStep!.backToSleepMin);
    const bedOnly = applyTonightOverride(on, { wakeDate: FRI, bedtime: atMinutes(THU, 23 * 60) }, 60);
    expect(bedOnly.twoStep).toEqual(on.twoStep);
    const tooLate = applyTonightOverride(on, { wakeDate: FRI, bedtime: fri(4 * 60) }, 60);
    expect(tooLate.twoStep).toBeUndefined();
    expect(tooLate.bedtime).toBe(fri(240));
  });
});

describe('two-step mornings in the analysis', () => {
  const NOW = atMinutes(THU, 21 * 60);
  const demo = generateDemoData(NOW);
  const withProfile = (p: Partial<Profile>): SleepDataset => ({ ...demo, profile: { ...demo.profile, workWakeMin: 6 * 60 + 5, ...p } });
  const plain = analyze(withProfile({}), NOW);
  const a = analyze(withProfile({ twoStepMorning: TWO }), NOW);

  it('times the routine alarm to a sleep cycle before 5:00 and the final alarm at the wake-up', () => {
    const two = a.tonight.twoStep!;
    expect(two.firstWake).toBe(fri(300));
    expect(a.alarm.alarm).toBeLessThanOrEqual(two.firstWake);
    expect(a.alarm.alarm).toBeGreaterThanOrEqual(two.firstWake - 30 * MINUTE);
    expect(two.firstAlarm).toBe(a.alarm.alarm);
    expect(two.routineEnd).toBe(a.alarm.alarm + 20 * MINUTE);
    expect(two.backToSleep).toBe(a.alarm.alarm + 30 * MINUTE);
    expect(a.tonight.wake).toBe(plain.tonight.wake);
    expect(a.upcoming[0].twoStep).toEqual(two);
    expect(a.upcoming[0].alarm).toBe(a.alarm.alarm);
  });

  it('plans the coming workday nights two-step too, counting both stretches', () => {
    for (const n of a.upcoming) {
      const wd = [1, 2, 3, 4, 5].includes(new Date(n.wake).getDay());
      expect(!!n.twoStep).toBe(wd && !n.noAlarm);
      if (!n.twoStep) continue;
      expect(n.alarm).toBe(n.twoStep.firstAlarm);
      expect(n.alarm!).toBeLessThanOrEqual(n.twoStep.firstWake);
      const eff = Math.min(0.97, Math.max(0.8, a.efficiency));
      expect(n.sleepMin).toBe(Math.round(((n.wake - n.bedtime) / MINUTE - a.latencyMin - 30) * eff));
    }
  });

  it('puts both alarms in the day plan', () => {
    const routine = a.plan.find((p) => p.id === 'routine');
    const final = a.plan.find((p) => p.id === 'alarm');
    expect(routine).toMatchObject({ kind: 'alarm', time: a.alarm.alarm, end: a.tonight.twoStep!.routineEnd });
    expect(final).toMatchObject({ kind: 'alarm', time: a.tonight.wake, title: 'Final alarm' });
    expect(plain.plan.find((p) => p.id === 'routine')).toBeUndefined();
  });

  it('changes nothing when the setting is off', () => {
    const offA = analyze(withProfile({ twoStepMorning: { ...TWO, enabled: false } }), NOW);
    expect(offA.tonight).toEqual(plain.tonight);
    expect(offA.alarm).toEqual(plain.alarm);
    expect(offA.upcoming).toEqual(plain.upcoming);
    expect(offA.plan).toEqual(plain.plan);
    expect(offA.scores).toEqual(plain.scores);
  });

  it('only reads nights from the day it was switched on as two-step mornings', () => {
    const p = userProfile({ twoStepMorning: { ...TWO, since: FRI } });
    expect(routineWindowFor(p, THU, { wakeMin: 365, isWorkday: true })).toBeUndefined();
    expect(routineWindowFor(p, FRI, { wakeMin: 365, isWorkday: true })).toEqual({
      start: fri(300 - 45),
      // 5:00 + 20 + 10 + 30 min of slack = 6:00, but never closer than 10 min to the final wake-up.
      end: fri(365 - 10),
      firstWake: fri(300),
      finalWake: fri(365),
      routineMin: 20,
      allowanceMin: 45,
    });
  });

  it('follows single dates: none on a date switched off, one on a date switched on', () => {
    const p = userProfile({ twoStepMorning: { ...TWO, since: FRI }, wakePlan: { [FRI]: { twoStep: false }, [THU]: { twoStep: true } } });
    expect(routineWindowFor(p, FRI, { wakeMin: 365, isWorkday: true })).toBeUndefined();
    // Before `since`, but switched on for that date.
    expect(routineWindowFor(p, THU, { wakeMin: 365, isWorkday: true })?.firstWake).toBe(atMinutes(THU, 300));
  });
});
