/**
 * "Options for tonight" (planOptions.ts): which options appear when, the utility and eepy's pick,
 * "how eepy decided", using an option, and the "Still up?" re-plan — on nights like the user's:
 * up at 6:00 with a 5:00 routine, ~3½ h of sleep debt, usually asleep around 2 AM.
 */
import { analyze, Analysis } from '../analysis';
import { OptionApply, optionUtility, PlanOption, planTonightOptions, PlanOptionsInput, sleepPoints, UTILITY } from '../planOptions';
import { simulateTomorrow } from '../simulate';
import { computeSleepDebt, projectDebt } from '../sleepDebt';
import { addDays, atMinutes, formatTime, HOUR, MINUTE } from '../time';
import type { Profile, SleepDataset } from '../types';
import { USER_MON, userLikeData } from './helpers';

const TUE = addDays(USER_MON, 1);
const at = (min: number) => atMinutes(USER_MON, min);
const AHEAD = at(21 * 60);
const EVENING = at(23 * 60 + 10);
const STILL_UP = at(24 * 60 + 5);

function optionsAt(now: number, opts: { data?: SleepDataset; override?: PlanOptionsInput['override']; firstEvent?: [number, string]; screensOff?: boolean } = {}) {
  const { data: base, planLog } = userLikeData();
  const data = opts.data ?? base;
  const a = analyze(data, now, { tonightOverride: opts.override, ...(opts.firstEvent ? { firstEventTomorrow: opts.firstEvent[0], firstEventTitle: opts.firstEvent[1] } : {}) });
  const o = planTonightOptions({ analysis: a, data, now, planLog, override: opts.override, screensOffReminder: opts.screensOff })!;
  return { a, o, data, planLog, get: (id: string) => o.options.find((x) => x.id === id) };
}

/** What src/state/planOptions.applyPlanOption does to the profile. */
function withApplied(profile: Profile, apply: OptionApply): Profile {
  const plan = { ...profile.wakePlan?.[apply.wakeDate] };
  if (apply.routine === null) delete plan.twoStep;
  else plan.twoStep = apply.routine;
  return { ...profile, wakePlan: { ...profile.wakePlan, [apply.wakeDate]: plan } };
}

const ids = (o: { options: PlanOption[] }) => o.options.map((x) => x.id).sort();

describe('options for tonight — the user-like night', () => {
  it("in the evening: eepy's plan, skipping the routine, a full catch-up and a nap; the plan stays eepy's pick", () => {
    const { a, o, get } = optionsAt(AHEAD);
    expect(o.mode).toBe('ahead');
    expect(ids(o)).toEqual(['catch-up', 'nap', 'plan', 'skip-routine']);
    const plan = get('plan')!;
    expect(plan).toMatchObject({ recommended: true, inUse: true, isDefault: true, bedtime: a.tonight.bedtime, wake: atMinutes(TUE, 6 * 60) });
    expect(o.options[0]).toBe(plan);
    expect(plan.times).toBe('Lights out 23:52 · routine 05:00 · up 06:00');
    expect(plan.sleepMin).toBeGreaterThan(5 * 60);
    expect(plan.sleepMin).toBeLessThan(5 * 60 + 40);
    expect(plan.apply).toEqual({ wakeDate: TUE, routine: null });

    // Skipping the routine: the same lights-out, one alarm before 6:00, ~30 min more sleep — but not enough to give the routine up.
    const skip = get('skip-routine')!;
    expect(skip.bedtime).toBe(plan.bedtime);
    expect(skip.routine).toBeUndefined();
    expect(skip.alarm).toBeLessThanOrEqual(atMinutes(TUE, 6 * 60));
    expect(skip.deltaSleepMin).toBeGreaterThanOrEqual(25);
    expect(skip.deltaSleepMin).toBeLessThanOrEqual(32);
    expect(skip.utility).toBeGreaterThan(plan.utility);
    expect(skip.utility).toBeLessThan(plan.utility + UTILITY.keepMargin);
    expect(skip.apply).toEqual({ wakeDate: TUE, routine: false, tonight: { wakeDate: TUE, choice: { id: 'skip-routine', title: 'Skip the routine', routineBefore: null } } });
    expect(skip.kept?.debtWeekMin).toBeLessThan(skip.debtWeekMin);

    // The full catch-up is ~1h 45m earlier, which the body clock isn't ready for.
    const catchUp = get('catch-up')!;
    expect(catchUp.bedtime).toBeLessThan(plan.bedtime - 90 * MINUTE);
    expect(catchUp.lyingAwakeMin).toBeGreaterThanOrEqual(30);
    expect(catchUp.cons.join(' ')).toMatch(/lying awake/);
    expect(catchUp.apply.tonight?.bedtime).toBe(catchUp.bedtime);

    // The nap: same night, 20 min around 2:30 PM tomorrow, by 3 PM.
    const nap = get('nap')!;
    expect(nap.bedtime).toBe(plan.bedtime);
    expect(nap.nap!.start).toBeGreaterThanOrEqual(atMinutes(TUE, 12 * 60));
    expect(nap.nap!.start + nap.nap!.minutes * MINUTE).toBeLessThanOrEqual(atMinutes(TUE, 15 * 60));
    expect(nap.debtWeekMin).toBeLessThan(plan.debtWeekMin);
    expect(nap.apply.tonight?.choice?.napAt).toBe(nap.nap!.start);

    for (const x of o.options) {
      expect(x.title).toBeTruthy();
      expect(x.pros.length).toBeGreaterThan(0);
      expect(x.week).toHaveLength(7);
      expect(x.week[0]).toMatchObject({ wakeDate: TUE, bedtime: x.bedtime, debtAfterMin: x.debtAfterMin });
      expect(x.debtWeekMin).toBe(x.week[6].debtAfterMin);
      expect(Number.isFinite(x.energy) && Number.isFinite(x.focusHours)).toBe(true);
    }
  });

  it('explains itself: debt, body clock, the morning, how late you go to bed, the pace — then the decision', () => {
    const { o } = optionsAt(AHEAD);
    expect(o.thinking).toEqual([
      'You have 3h 38m of sleep debt.',
      "You've been falling asleep around 01:52 — with that debt you can likely fall asleep from about 23:50.",
      'Tomorrow starts at 06:00 with your routine at 05:00.',
      'Last 3 nights you went to bed ~35 min after the plan.',
      'Your sleep onset has moved ~2 min earlier a night this week, so coming nights step 15 min earlier each, not 30.',
      "So: keep eepy's plan — lights out 23:52, routine alarm 05:00. (“Skip the routine” would add 30m of sleep — not enough to change it.)",
    ]);
    expect(o.adherence?.recentLateMin).toBe(35);
    // Bedtime keeps slipping: start wind-down 35 min earlier (the screens-off reminder is on).
    expect(o.nudge).toEqual({ text: "Planning earlier won't help while bedtime keeps slipping ~35 min — start wind-down at 22:17 instead of 22:52." });
    expect(optionsAt(AHEAD, { screensOff: false }).o.nudge).toMatchObject({ action: 'screens-off', text: expect.stringMatching(/and turn on the screens-off reminder\.$/) });
    expect(o.options.find((x) => x.id === 'plan')!.cons).toContain("You've been going to bed ~35 min after the plan lately");
  });

  it('within the hour before lights-out: "can\'t make it" 30 min later, with and without the routine', () => {
    const { o, get } = optionsAt(EVENING);
    expect(o.mode).toBe('evening');
    expect(ids(o)).toEqual(['later', 'later-skip', 'nap', 'plan', 'skip-routine']);
    const plan = get('plan')!;
    const later = get('later')!;
    expect(formatTime(later.bedtime)).toBe('00:25');
    expect(later.deltaSleepMin).toBeLessThan(-25);
    // The routine comes out of an already short night; skipping it wins most of it back.
    expect(get('later-skip')!.sleepMin).toBeGreaterThan(later.sleepMin + 20);
    // A late night tonight nudges tomorrow's held lights-out later too (body clock).
    expect(later.week[1].bedtime).toBeGreaterThan(plan.week[1].bedtime);
    expect(o.recommended.id).toBe('plan');
    expect(o.thinking).toContain("It's 23:10 — 42m to the planned lights-out.");
  });

  it('a sick day or an early exam tips it to skipping the routine', () => {
    const { data } = userLikeData();
    const sick = optionsAt(AHEAD, { data: { ...data, dayLogs: { [USER_MON]: { date: USER_MON, tags: ['sick'] } } } }).o;
    expect(sick.recommended.id).toBe('skip-routine');
    expect(sick.strained).toBe('You logged being sick');
    expect(sick.thinking).toContain('You logged being sick → sleep wins over the routine.');
    expect(sick.thinking[sick.thinking.length - 1]).toBe('So: lights out 23:52 and skip the routine (+30m sleep).');
    expect(sick.recommended.parts.routine).toBe(0);

    const exam = optionsAt(AHEAD, { firstEvent: [atMinutes(TUE, 7 * 60), 'Chemistry exam'] }).o;
    expect(exam.thinking).toContain('First event at 07:00 (“Chemistry exam”) — tomorrow\'s energy counts double.');
    expect(exam.recommended.id).toBe('skip-routine');
  });
});

describe('"Still up?" — re-planning after lights-out', () => {
  it('bed now with or without the routine, a nap tomorrow, or 30 min more — best: skip the routine', () => {
    const { o, get } = optionsAt(STILL_UP);
    expect(o.mode).toBe('still-up');
    expect(ids(o)).toEqual(['now', 'now-nap', 'now-skip', 'stay-up']);
    const best = o.recommended;
    expect(best.id).toBe('now-skip');
    expect(best.headline).toBe('Lights out by 00:20, skip the routine');
    expect(best.decision).toBe('lights out by 00:20 and skip the routine (+30m sleep)');
    expect(best.sleepMin).toBeGreaterThan(5 * 60 + 15);
    expect(best.apply).toEqual({
      wakeDate: TUE,
      routine: false,
      tonight: { wakeDate: TUE, bedtime: at(24 * 60 + 20), choice: { id: 'now-skip', title: 'Bed now, skip the routine', routineBefore: null } },
    });
    // Going to bed now with the routine is the default it beats; staying up costs half an hour.
    const now = get('now')!;
    expect(now.isDefault).toBe(true);
    expect(now.routine).toBeDefined();
    expect(best.utility).toBeGreaterThanOrEqual(now.utility + UTILITY.keepMargin);
    expect(get('stay-up')!.deltaSleepMin).toBeLessThan(-25);
    expect(o.thinking).toContain("It's 00:05 and the planned 23:52 lights-out has passed.");
    expect(o.options.some((x) => x.id === 'plan')).toBe(false);
  });

  it('nothing to choose in bed, in the insomnia programme, or right before the alarm', () => {
    const { data, planLog } = userLikeData();
    const a = analyze(data, STILL_UP);
    expect(planTonightOptions({ analysis: a, data, now: STILL_UP, planLog, inBed: true })).toBeUndefined();
    const cbti: Analysis = { ...a, planInput: { ...a.planInput, sleepWindow: { bedMin: 60, wakeMin: 6 * 60, reason: 'Your programme window.' } } };
    expect(planTonightOptions({ analysis: cbti, data, now: STILL_UP, planLog })).toBeUndefined();
    expect(planTonightOptions({ analysis: a, data, now: atMinutes(TUE, 4 * 60 + 45), planLog })).toBeUndefined();
  });
});

describe('which options appear', () => {
  it('a free day: sleep in a little (with its body-clock cost); no routine to skip', () => {
    const { data } = userLikeData({ wakePlan: { [TUE]: { free: true } } });
    const { o, get } = optionsAt(AHEAD, { data });
    expect(o.options.some((x) => x.id === 'skip-routine')).toBe(false);
    const plan = get('plan')!;
    expect(plan.noAlarm).toBe(true);
    const sleepIn = get('sleep-in')!;
    expect(sleepIn.wake - plan.wake).toBe(60 * MINUTE);
    expect(sleepIn.cons.join(' ')).toMatch(/body clock/);
    expect(sleepIn.parts.bodyClock).toBeLessThan(0);
    // eepy is easing the body clock earlier, so lying in costs more than it gains.
    expect(o.recommended.id).toBe('plan');
  });

  it('insomnia mode: no early lights-out, no nap and no lying in', () => {
    const { data } = userLikeData({ insomniaMode: true });
    expect(ids(optionsAt(AHEAD, { data }).o)).toEqual(['plan', 'skip-routine']);
  });

  it('"earliest" when the 5-hour floor put lights-out before your body clock is ready', () => {
    // Asleep ~2:42 lately: the body clock is ready from ~00:40, but 5 h of sleep before the routine means lights out 00:06.
    const { data, planLog } = userLikeData();
    const shift = 70 * MINUTE;
    const later = { ...data, sessions: data.sessions.map((s) => ({ ...s, start: s.start + shift, end: s.end + shift, stages: s.stages.map((g) => ({ ...g, start: g.start + shift, end: g.end + shift })) })) };
    const a = analyze(later, AHEAD);
    const o = planTonightOptions({ analysis: a, data: later, now: AHEAD, planLog })!;
    expect(formatTime(a.tonight.bedtime)).toBe('00:06');
    const earliest = o.options.find((x) => x.id === 'earliest')!;
    expect(formatTime(earliest.bedtime)).toBe('00:40');
    expect(earliest.pros.join(' ')).toMatch(/34m later, when you're likely to be sleepy/);
    expect(earliest.deltaSleepMin).toBeLessThan(0);
    expect(o.recommended.id).not.toBe('earliest');
    // Without the floor (no routine, a later wake-up) the plan *is* the earliest: not offered twice.
    expect(ids(optionsAt(AHEAD).o)).not.toContain('earliest');
  });
});

describe('using an option', () => {
  it('skip the routine: the routine alarm goes, lights-out stays, and the card shows it in use with the way back', () => {
    const { o, data, planLog } = optionsAt(AHEAD);
    const skip = o.options.find((x) => x.id === 'skip-routine')!;
    const used = { ...data, profile: withApplied(data.profile, skip.apply) };
    const a = analyze(used, AHEAD, { tonightOverride: skip.apply.tonight });
    expect(a.tonight.twoStep).toBeUndefined();
    expect(a.tonight.bedtime).toBe(skip.bedtime);
    const after = planTonightOptions({ analysis: a, data: used, now: AHEAD, planLog, override: skip.apply.tonight })!;
    // The same options as before (eepy's plan still with the routine), the choice in use and kept as the pick.
    expect(ids(after)).toEqual(ids(o));
    expect(after.base.routine).toBeDefined();
    expect(after.inUse?.id).toBe('skip-routine');
    expect(after.recommended.id).toBe('skip-routine');
    expect(after.choice?.title).toBe('Skip the routine');
    expect(after.reset).toEqual({ wakeDate: TUE, routine: null });
    expect(after.options.find((x) => x.id === 'plan')!.bedtime).toBe(o.options.find((x) => x.id === 'plan')!.bedtime);
  });

  it("can't make it: the later lights-out is in use", () => {
    const { o } = optionsAt(EVENING);
    const later = o.options.find((x) => x.id === 'later')!;
    const after = optionsAt(EVENING, { override: later.apply.tonight }).o;
    expect(after.inUse?.id).toBe('later');
    expect(after.base.bedtime).toBe(o.base.bedtime);
  });

  it('your own times from "Adjust tonight" show as their own row', () => {
    const override = { wakeDate: TUE, bedtime: at(24 * 60 + 40) };
    const { a, o } = optionsAt(AHEAD, { override });
    expect(a.tonight.adjusted).toBeDefined();
    expect(o.base.bedtime).toBe(a.tonight.adjusted!.plannedBedtime);
    expect(o.inUse).toMatchObject({ id: 'current', title: 'Your own times', bedtime: override.bedtime });
    // 00:40 with the routine at 5:00 is a short night: eepy points to something clearly better (still only a suggestion).
    expect(o.recommended.id).not.toBe('current');
    expect(o.recommended.utility).toBeGreaterThanOrEqual(o.inUse!.utility + UTILITY.keepMargin);
  });
});

describe('the utility', () => {
  it('values an hour of sleep more on a short night and less beyond your need', () => {
    expect(sleepPoints(300, 400)).toBeCloseTo(70, 5);
    expect(sleepPoints(400, 400)).toBeCloseTo(70 + 100 / 6, 5);
    expect(sleepPoints(460, 400)).toBeCloseTo(70 + 100 / 6 + 5, 5);
    // "Short" is relative to your need: with an 8-hour need, 6 hours is still a short night.
    expect(sleepPoints(360, 480)).toBeCloseTo(14 * 6, 5);
    expect(sleepPoints(480, 480)).toBeCloseTo(14 * 6 + 10 * 2, 5);
  });

  it('is the sum of transparent parts; run down, sleep wins and the routine counts for nothing', () => {
    const o = { sleepMin: 330, debtWeekMin: 120, energy: 50, focusHours: 5, lyingAwakeMin: 20, keepsRoutine: true, bedtime: at(23 * 60 + 30), sleepInMin: 0, nap: false };
    const c = { needMin: 400, strained: false, tomorrowWeight: 1, insomnia: false, recentLightsOutMin: 90, lateMin: 0 };
    const u = optionUtility(o, c);
    expect(u.total).toBeCloseTo(Object.values(u.parts).reduce((s, x) => s + x, 0), 0);
    expect(u.parts).toMatchObject({ debt: -4, routine: UTILITY.routine, effort: 0, bodyClock: 0 });
    expect(u.parts.lyingAwake).toBeCloseTo(-5, 5);
    // 23:30 is 2 h before you've been going to bed: an hour beyond the grace.
    expect(u.parts.realism).toBeCloseTo(-0.04 * 60, 5);
    const strained = optionUtility(o, { ...c, strained: true });
    expect(strained.parts.routine).toBe(0);
    expect(strained.parts.sleep).toBeCloseTo(u.parts.sleep * UTILITY.strainedSleep, 5);
    expect(strained.parts.lyingAwake).toBeCloseTo(u.parts.lyingAwake * UTILITY.strainedLyingAwake, 5);
    // Often late for the plan: less grace for an early lights-out; an important early day counts double.
    expect(optionUtility(o, { ...c, lateMin: 35 }).parts.realism).toBeCloseTo(-0.04 * 95, 5);
    expect(optionUtility(o, { ...c, tomorrowWeight: 2 }).parts.tomorrow).toBeCloseTo(2 * u.parts.tomorrow, 5);
  });
});

describe('the projection and the simulator', () => {
  it("projects debt with the 14-night model, and the plan's coming nights are the week plan's", () => {
    const { a, o } = optionsAt(AHEAD);
    const plan = o.options.find((x) => x.id === 'plan')!;
    for (let k = 1; k < 7; k++) expect(plan.week[k].bedtime).toBe(a.upcoming[k].bedtime);
    const coming = plan.week.slice(1).map((n) => ({ wakeDate: n.wakeDate, sleepMin: n.sleepMin }));
    const debts = projectDebt(a.nights, a.need.needMin, [{ wakeDate: TUE, sleepMin: plan.sleepMin }, ...coming]);
    expect(Math.abs(debts[6] - plan.debtWeekMin)).toBeLessThanOrEqual(2);
    // Same model as the debt today: no coming nights → today's debt.
    expect(projectDebt(a.nights, a.need.needMin, [])).toEqual([]);
    expect(Math.round(computeSleepDebt(a.nights, a.need.needMin, a.day).debtMin)).toBe(Math.round(a.debt.debtMin));
  });

  it('simulates the routine as time awake in the night, and a nap tomorrow', () => {
    const { a, data } = optionsAt(AHEAD);
    const t = a.tonight;
    const plain = simulateTomorrow(a, data, { bedtime: t.bedtime, wake: t.wake }).scenario;
    const routine = simulateTomorrow(a, data, { bedtime: t.bedtime, wake: t.wake, routine: { start: t.twoStep!.firstAlarm, minutes: t.twoStep!.awakeMin } }).scenario;
    expect(plain.sleep.sleepMin - routine.sleep.sleepMin).toBeCloseTo(t.twoStep!.awakeMin * a.efficiency, -1);
    const napped = simulateTomorrow(a, data, { bedtime: t.bedtime, wake: t.wake, tomorrowNap: { start: atMinutes(TUE, 14 * 60), minutes: 30 } }).scenario;
    expect(napped.tomorrowNapSleepMin).toBeGreaterThan(15);
    expect(napped.tomorrow.points.filter((p) => p.t > atMinutes(TUE, 15 * 60) && p.t < atMinutes(TUE, 18 * 60)).length).toBeGreaterThan(0);
    const afternoon = (s: typeof plain) => {
      const pts = s.tomorrow.points.filter((p) => p.t > atMinutes(TUE, 15 * 60) && p.t < atMinutes(TUE, 17 * 60));
      return pts.reduce((x, p) => x + p.energy, 0) / pts.length;
    };
    expect(afternoon(napped)).toBeGreaterThan(afternoon(plain));
    expect(plain.tomorrowNapSleepMin).toBe(0);
    expect(napped.sleep.sleepMin).toBe(plain.sleep.sleepMin);
    expect(napped.debtMin).toBe(plain.debtMin);
    expect(HOUR).toBe(60 * MINUTE);
  });
});
