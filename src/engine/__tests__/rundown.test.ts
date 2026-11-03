import { analyze } from '../analysis';
import { generateDemoData } from '../demo';
import {
  addCustomRundownStep,
  backRundownStep,
  canMoveRundownStep,
  canPickUp,
  DEFAULT_ORDER,
  DEFAULT_RUNDOWN,
  markRundownStep,
  moveRundownStep,
  nudgeRundownMinutes,
  phoneDownAt,
  playerPosition,
  removeCustomRundownStep,
  resetRundown,
  Rundown,
  rundownCatalog,
  rundownFor,
  rundownGlance,
  rundownNow,
  RundownProgress,
  RundownSettings,
  rundownSettingsFrom,
  RundownState,
  routineOrder,
  screenFreeSummary,
  setRundownMinutes,
  setRundownReminder,
  startRundownProgress,
  toggleRundownStep,
} from '../rundown';
import type { TonightPlan } from '../schedule';
import { atMinutes, formatTime, MINUTE } from '../time';
import type { TwoStepPlan } from '../twoStep';

const bed = atMinutes('2026-10-29', 23 * 60 + 15);
const tonight = {
  wakeDate: '2026-10-30',
  isWorkday: true,
  wake: atMinutes('2026-10-30', 7 * 60),
  bedtime: bed,
  windDownStart: bed - 60 * MINUTE,
  lastMeal: bed - 180 * MINUTE,
  lastExercise: bed - 120 * MINUTE,
  inBedMin: 465,
  extraForDebtMin: 0,
  gradual: false,
  rationale: [],
} as TonightPlan;
const caffeine = { cutoff: { cutoff: bed - 330 * MINUTE, atBedtimeMg: 12, overLimit: false, doseMg: 95 } };
const alarm = { alarm: atMinutes('2026-10-30', 6 * 60 + 52), cycles: 5, onBoundary: true };

function state(rundown: Partial<RundownSettings> = {}, settings: Partial<RundownState['settings']> = {}): RundownState {
  return {
    settings: { rundown: { ...DEFAULT_RUNDOWN, ...rundown }, screensOffMin: 45, eReader: { enabled: false, warmLight: false }, sleepMode: { enabled: false, startAt: 'lightsout' }, screenDim: true, notifications: { smartAlarm: true }, ...settings },
    profile: { caffeineHalfLifeH: 5, caffeineBedtimeLimitMg: 50, insomniaMode: false },
  };
}
const build = (st: RundownState = state(), t: TonightPlan = tonight, now?: number) => rundownFor({ tonight: t, alarm, caffeine }, st, now)!;
const times = (r: Rundown) => r.steps.map((s) => [s.id, formatTime(s.at), s.min]);
const step = (r: Rundown, id: string) => r.steps.find((s) => s.id === id)!;

describe('bedtime rundown: the default evening', () => {
  it('builds the routine backwards from lights-out to fill the hour of wind-down, with the evening before it', () => {
    const r = build();
    expect(times(r)).toEqual([
      ['caffeine', '17:45', 0],
      ['dim-lights', '20:15', 0],
      ['meal', '20:15', 0],
      ['alcohol', '20:15', 0],
      ['exercise', '21:15', 0],
      ['fluids', '21:15', 0],
      ['shower', '21:45', 15],
      ['tomorrow', '22:15', 5],
      ['todo-list', '22:20', 5],
      ['bedroom', '22:25', 3],
      ['alarm', '22:28', 2],
      ['phone-down', '22:30', 0],
      ['teeth', '22:30', 10],
      ['reading', '22:40', 30],
      ['relax', '23:10', 5],
      ['lights-out', '23:15', 0],
    ]);
    expect(r.routine.map((s) => s.phase)).toEqual(['winddown', 'winddown', 'winddown', 'winddown', 'phone-down', 'screen-free', 'screen-free', 'screen-free', 'lights-out']);
    expect(r.start).toBe(tonight.windDownStart);
    expect(r).toMatchObject({ setMin: 60, plannedMin: 60, readingMin: 30, dropped: [], shortened: [], playing: false });
    expect(r.note).toBeUndefined();
    expect(rundownGlance(r)).toBe('Phone down 22:30 · read 30 min · lights out 23:15');
    expect(screenFreeSummary(r)).toBe('teeth & skin care, 30 min of reading and relaxing in bed');
  });

  it('gives every step a description of what to do and why', () => {
    const r = build();
    for (const s of r.steps) {
      expect(s.summary.length).toBeGreaterThan(5);
      expect(s.detail.length).toBeGreaterThan(60);
    }
    expect(step(r, 'todo-list').detail).toMatch(/Scullin et al\., 2018/);
    expect(step(r, 'shower').detail).toMatch(/Haghayegh et al\., 2019/);
    expect(step(r, 'bedroom').detail).toMatch(/18–20 °C/);
    expect(step(r, 'caffeine').detail).toMatch(/after 17:45 would leave more than 50 mg/);
    expect(step(r, 'alarm').detail).toMatch(/^eepy rings at 06:52 — the end of sleep cycle 5, never after 07:00\. Send any last messages now — at 22:30 the phone goes down\./);
    expect(step(r, 'lights-out').detail).toMatch(/Tap "I'm in bed": eepy times your alarm from that moment, starts your sleep sounds and keeps tonight's reminders quiet/);
    expect(step(r, 'lights-out').detail).toMatch(/Not sleepy after ~20 min\? Get up/);
  });

  it('says what eepy does at phone-down', () => {
    const plain = step(build(), 'phone-down').detail;
    expect(plain).toMatch(/charger across the room, face down/);
    expect(plain).toMatch(/What eepy does now: eepy dims itself to its night level; sleep sounds keep playing with the screen off\. Tip: bedtime autopilot/);
    const autopilot = step(build(state({}, { sleepMode: { enabled: true, startAt: 'lightsout' } })), 'phone-down').detail;
    expect(autopilot).toMatch(/bedtime autopilot switches sleep mode on at 23:15/);
    expect(autopilot).not.toMatch(/Tip:/);
    expect(step(build(state({}, { sleepMode: { enabled: true, startAt: 'winddown' } })), 'phone-down').detail).toMatch(/sleep mode stays on \(since 22:15\)/);
    expect(step(build(state({}, { sleepMode: { enabled: true, startAt: 'winddown' } })), 'lights-out').detail).toMatch(/switches sleep mode on, starts your sleep sounds/);
  });

  it('reads on the e-reader (frontlight low and warm) or a paper book under a dim lamp', () => {
    const paper = build();
    expect(step(paper, 'reading')).toMatchObject({ title: 'Read a paper book', icon: 'book-open-page-variant-outline', summary: 'Under a dim, warm lamp · until 23:10' });
    expect(step(paper, 'reading').detail).toMatch(/paper book under a dim, warm lamp/);
    expect(step(paper, 'reading').detail).toMatch(/not in bed if you often lie awake/);
    expect(step(paper, 'phone-down').detail).not.toMatch(/e-reader/);
    expect(step(paper, 'lights-out').detail).toMatch(/^Book down, light off\./);

    const warm = build(state({}, { eReader: { enabled: true, warmLight: true } }));
    expect(step(warm, 'reading')).toMatchObject({ title: 'Read on your e-reader', icon: 'book-open-variant', summary: 'Frontlight low and warm · until 23:10' });
    expect(step(warm, 'reading').detail).toMatch(/about 10–20%\), warmth all the way up/);
    expect(step(warm, 'phone-down').detail).toMatch(/your e-reader is fine \(frontlight low and warm\)/);
    expect(step(warm, 'lights-out').detail).toMatch(/^E-reader down, light off\./);
    expect(step(warm, 'lights-out').detail).toMatch(/read on your e-reader — frontlight at its lowest and warmest/);

    const noWarm = build(state({}, { eReader: { enabled: true, warmLight: false } }));
    expect(step(noWarm, 'reading').detail).toMatch(/a dim bedside lamp on the page beats the frontlight/);
    // Insomnia programme: reading outside the bedroom; a held-back body clock: keep reading if not sleepy.
    const cbti = build({ ...state(), profile: { ...state().profile, insomniaMode: true } }, { ...tonight, gradual: true });
    expect(step(cbti, 'reading').detail).toMatch(/Read in another room — your insomnia programme keeps the bed for sleep/);
    expect(step(cbti, 'reading').detail).toMatch(/Your body clock is still running late/);
  });

  it('fits a two-step morning: the routine things laid out, both alarms named', () => {
    const twoStep = { firstWake: atMinutes('2026-10-30', 5 * 60), firstAlarm: atMinutes('2026-10-30', 4 * 60 + 52), routineMin: 20 } as TwoStepPlan;
    const r = build(state(), { ...tonight, wake: atMinutes('2026-10-30', 6 * 60), twoStep });
    expect(step(r, 'tomorrow').summary).toBe('Clothes, bag — and your 05:00 routine things');
    expect(step(r, 'tomorrow').detail).toMatch(/so the routine is quick, done in low light/);
    expect(step(r, 'alarm').detail).toMatch(/^eepy rings your routine alarm around 04:52 \(end of a sleep cycle, never after 05:00\) and the final one at 06:00\./);
    expect(step(r, 'lights-out').detail).toMatch(/At 04:52: your routine in low light, then straight back to bed until 06:00\./);
    // eepy's alarm off: check your own.
    expect(step(build(state({}, { notifications: { smartAlarm: false } })), 'alarm').detail).toMatch(/^eepy's alarm is off: check yours is set for 07:00 \(06:52 is the end of a sleep cycle\)\./);
    expect(step(build(state(), { ...tonight, noAlarm: true }), 'alarm').detail).toMatch(/^No alarm tomorrow/);
  });

  it("caffeine: the cut-off from the caffeine model, or none left today; no step when nothing's known", () => {
    const over = rundownFor({ tonight, alarm, caffeine: { cutoff: { atBedtimeMg: 80, overLimit: true, doseMg: 95 } } }, state())!;
    expect(step(over, 'caffeine')).toMatchObject({ title: 'No more caffeine today', summary: '~80 mg already at bedtime' });
    expect(rundownFor({ tonight, alarm }, state())!.steps.find((s) => s.id === 'caffeine')).toBeUndefined();
  });
});

describe('phone-down', () => {
  it('is lights-out minus the screen-free steps after it', () => {
    const at = (rundown: Partial<RundownSettings>) => formatTime(phoneDownAt(tonight, { rundown: { ...DEFAULT_RUNDOWN, ...rundown }, screensOffMin: 45 }));
    expect(at({})).toBe('22:30');
    expect(at({ readingMin: 15 })).toBe('22:45');
    expect(at({ readingMin: 0 })).toBe('23:00');
    expect(at({ off: ['teeth', 'relax'], readingMin: 0 })).toBe('23:15');
    // Longer teeth: with room in the wind-down the phone goes down earlier; without, reading gives way.
    expect(formatTime(phoneDownAt({ ...tonight, windDownStart: bed - 90 * MINUTE }, { rundown: { ...DEFAULT_RUNDOWN, minutes: { teeth: 15 } }, screensOffMin: 45 }))).toBe('22:25');
    expect(at({ minutes: { teeth: 15 } })).toBe('22:30');
    // The to-do list on paper after phone-down: the phone goes down 5 min earlier.
    expect(at({ order: ['tomorrow', 'bedroom', 'alarm', 'phone-down', 'todo-list', 'teeth', 'reading', 'relax'] })).toBe('22:25');
  });

  it('falls back to "screens off N min before lights-out" with the rundown off, never before wind-down', () => {
    const off = { ...DEFAULT_RUNDOWN, enabled: false };
    expect(formatTime(phoneDownAt(tonight, { rundown: off, screensOffMin: 30 }))).toBe('22:45');
    expect(phoneDownAt(tonight, { rundown: off, screensOffMin: 90 })).toBe(tonight.windDownStart);
    expect(phoneDownAt(tonight, { screensOffMin: 45 })).toBe(bed - 45 * MINUTE);
    expect(rundownFor({ tonight }, state({ enabled: false }))).toBeUndefined();
  });

  it('keeps an old screens-off choice for stores saved before the rundown', () => {
    expect(rundownSettingsFrom(undefined, 45)).toEqual(DEFAULT_RUNDOWN);
    expect(rundownSettingsFrom(undefined, 30).readingMin).toBe(15);
    expect(rundownSettingsFrom(undefined, 60).readingMin).toBe(45);
    expect(rundownSettingsFrom(undefined).readingMin).toBe(30);
    for (const m of [30, 45, 60]) expect(phoneDownAt({ ...tonight, windDownStart: bed - 120 * MINUTE }, { rundown: rundownSettingsFrom(undefined, m), screensOffMin: m })).toBe(bed - m * MINUTE);
    // A partly saved rundown gets the rest from the defaults.
    expect(rundownSettingsFrom({ readingMin: 20 } as Partial<RundownSettings>)).toEqual({ ...DEFAULT_RUNDOWN, readingMin: 20 });
  });
});

describe('short evenings', () => {
  it('shortens reading first, then the other optional steps, and says what changed and why', () => {
    const forty = build(state(), { ...tonight, windDownStart: bed - 40 * MINUTE });
    expect(forty.routine.filter((s) => s.shortened).map((s) => s.id)).toEqual(['reading']);
    expect(forty.note).toBe("Your rundown takes 1h 00m but tonight's wind-down is 40m, so reading is 10 min instead of 30.");
    const r = build(state(), { ...tonight, windDownStart: bed - 35 * MINUTE });
    expect(r.routine.map((s) => [s.id, formatTime(s.at), s.min])).toEqual([
      ['tomorrow', '22:40', 3],
      ['todo-list', '22:43', 4],
      ['bedroom', '22:47', 3],
      ['alarm', '22:50', 2],
      ['phone-down', '22:52', 0],
      ['teeth', '22:52', 10],
      ['reading', '23:02', 10],
      ['relax', '23:12', 3],
      ['lights-out', '23:15', 0],
    ]);
    expect(step(r, 'reading')).toMatchObject({ shortened: true, setMin: 30, min: 10 });
    expect(step(r, 'teeth').shortened).toBeUndefined();
    expect(r.note).toBe("Your rundown takes 1h 00m but tonight's wind-down is 35m, so reading is 10 min instead of 30 and setting up tomorrow, the to-do list and relaxing in bed are shorter.");
    expect(r.late).toBeUndefined();
  });

  it('keeps teeth, phone down and lights-out on a very short evening', () => {
    const r = build(state(), { ...tonight, windDownStart: bed - 20 * MINUTE });
    // Reading and setting up tomorrow go; what that frees goes back to the alarm check.
    expect(r.routine.map((s) => [s.id, s.min])).toEqual([
      ['todo-list', 3],
      ['bedroom', 2],
      ['alarm', 2],
      ['phone-down', 0],
      ['teeth', 10],
      ['relax', 3],
      ['lights-out', 0],
    ]);
    expect(r.dropped.map((d) => d.id)).toEqual(['reading', 'tomorrow']);
    expect(r.note).toMatch(/so the to-do list, getting the bedroom ready and relaxing in bed are shorter and reading and setting up tomorrow are skipped\.$/);
    const tiny = build(state(), { ...tonight, windDownStart: bed - 6 * MINUTE });
    expect(tiny.routine.map((s) => [s.id, s.min])).toEqual([
      ['phone-down', 0],
      ['teeth', 6],
      ['lights-out', 0],
    ]);
    expect(formatTime(tiny.phoneDown)).toBe('23:09');
  });

  it('a longer rundown than the wind-down shortens too (reading back to what fits)', () => {
    const r = build(state({ readingMin: 60 }));
    expect(step(r, 'reading').min).toBe(30);
    expect(r.note).toBe("Your rundown takes 1h 30m but tonight's wind-down is 1h 00m, so reading is 30 min instead of 60.");
    const longWindDown = build(state({ readingMin: 60 }), { ...tonight, windDownStart: bed - 90 * MINUTE });
    expect(step(longWindDown, 'reading').min).toBe(60);
    expect(longWindDown.note).toBeUndefined();
    expect(formatTime(longWindDown.phoneDown)).toBe('22:00');
  });

  it('a late start in the player fits the steps still to do into the time left', () => {
    const base = build();
    const now = bed - 35 * MINUTE;
    const r = build(state({}, { rundownProgress: startRundownProgress(base, now) }), tonight, now);
    expect(r.playing).toBe(true);
    expect(r.late).toBe(true);
    expect(r.routine.map((s) => [s.id, formatTime(s.at), s.min])).toEqual([
      ['tomorrow', '22:40', 3],
      ['todo-list', '22:43', 4],
      ['bedroom', '22:47', 3],
      ['alarm', '22:50', 2],
      ['phone-down', '22:52', 0],
      ['teeth', '22:52', 10],
      ['reading', '23:02', 10],
      ['relax', '23:12', 3],
      ['lights-out', '23:15', 0],
    ]);
    expect(r.note).toBe('Only 35m left before lights-out, so reading is 10 min instead of 30 and setting up tomorrow, the to-do list and relaxing in bed are shorter.');
  });
});

describe('following tonight', () => {
  it('moves with an adjusted lights-out (settings.tonight → analysis.tonight)', () => {
    const now = atMinutes('2026-10-21', 12 * 60);
    const data = generateDemoData(now);
    const planned = analyze(data, now);
    const later = planned.tonight.bedtime + 60 * MINUTE;
    const moved = analyze(data, now, { tonightOverride: { wakeDate: planned.tonight.wakeDate, bedtime: later } });
    const st = state();
    const r0 = rundownFor(planned, st)!;
    const r1 = rundownFor(moved, st)!;
    expect(r1.lightsOut).toBe(later);
    expect(r1.phoneDown - r0.phoneDown).toBe(60 * MINUTE);
    for (const s of r1.routine) expect(s.at - r0.routine.find((x) => x.id === s.id)!.at).toBe(60 * MINUTE);
    expect(step(r1, 'meal').at - step(r0, 'meal').at).toBe(60 * MINUTE);
    expect(step(r1, 'shower').at).toBe(later - 90 * MINUTE);
    expect(phoneDownAt(moved.tonight, st.settings)).toBe(r1.phoneDown);
  });
});

describe('your own steps and order', () => {
  it('adds a screen-free step before lights-out, one that needs a screen before phone-down', () => {
    let s = addCustomRundownStep(DEFAULT_RUNDOWN, { title: '  Stretch  ', min: 10, screenFree: true }, 'custom-a');
    s = addCustomRundownStep(s, { title: 'Duolingo', min: 5, screenFree: false }, 'custom-b');
    expect(routineOrder(s)).toEqual(['tomorrow', 'todo-list', 'bedroom', 'alarm', 'custom-b', 'phone-down', 'teeth', 'reading', 'relax', 'custom-a']);
    expect(s.custom).toEqual([
      { id: 'custom-a', title: 'Stretch', min: 10, screenFree: true },
      { id: 'custom-b', title: 'Duolingo', min: 5, screenFree: false },
    ]);
    const r = build(state(s), { ...tonight, windDownStart: bed - 90 * MINUTE });
    expect(step(r, 'custom-a')).toMatchObject({ title: 'Stretch', custom: true, phase: 'screen-free', min: 10, at: bed - 10 * MINUTE });
    expect(step(r, 'custom-b')).toMatchObject({ phase: 'winddown', screenFree: false });
    expect(formatTime(r.phoneDown)).toBe('22:20');
    // Blank titles aren't added; removing takes it out of everything.
    expect(addCustomRundownStep(DEFAULT_RUNDOWN, { title: '   ', min: 5, screenFree: true }, 'x')).toBe(DEFAULT_RUNDOWN);
    const removed = removeCustomRundownStep(setRundownReminder(s, 'custom-a', true), 'custom-a');
    expect(removed.custom.map((c) => c.id)).toEqual(['custom-b']);
    expect(removed.order).not.toContain('custom-a');
    expect(removed.remind).toEqual([]);
  });

  it('your own steps shorten after relaxing in bed on a short evening', () => {
    const s = addCustomRundownStep(DEFAULT_RUNDOWN, { title: 'Stretch', min: 10, screenFree: true }, 'custom-a');
    const r = build(state(s), { ...tonight, windDownStart: bed - 40 * MINUTE });
    expect(step(r, 'custom-a')).toMatchObject({ min: 5, shortened: true });
    expect(step(r, 'todo-list').min).toBe(4);
    expect(r.note).toMatch(/“Stretch”/);
  });

  it('reorders with up/down, never past lights-out, and nothing needing a screen after phone-down', () => {
    expect(canMoveRundownStep(DEFAULT_RUNDOWN, 'tomorrow', -1)).toBe(false);
    expect(canMoveRundownStep(DEFAULT_RUNDOWN, 'relax', 1)).toBe(false);
    expect(canMoveRundownStep(DEFAULT_RUNDOWN, 'alarm', 1)).toBe(false);
    expect(canMoveRundownStep(DEFAULT_RUNDOWN, 'phone-down', -1)).toBe(true);
    expect(canMoveRundownStep(DEFAULT_RUNDOWN, 'teeth', -1)).toBe(true);
    const moved = moveRundownStep(DEFAULT_RUNDOWN, 'teeth', -1);
    expect(routineOrder(moved)).toEqual(['tomorrow', 'todo-list', 'bedroom', 'alarm', 'teeth', 'phone-down', 'reading', 'relax']);
    expect(formatTime(phoneDownAt(tonight, { rundown: moved, screensOffMin: 45 }))).toBe('22:40');
    expect(moveRundownStep(DEFAULT_RUNDOWN, 'alarm', 1)).toBe(DEFAULT_RUNDOWN);
    expect(routineOrder(moveRundownStep(DEFAULT_RUNDOWN, 'reading', -1))).toEqual(['tomorrow', 'todo-list', 'bedroom', 'alarm', 'phone-down', 'reading', 'teeth', 'relax']);
  });

  it('repairs a saved order: unknown ids out, missing steps back in place, screen steps before phone-down', () => {
    expect(routineOrder({ ...DEFAULT_RUNDOWN, order: ['teeth', 'gone', 'phone-down', 'alarm', 'reading'] })).toEqual(['tomorrow', 'todo-list', 'bedroom', 'teeth', 'alarm', 'phone-down', 'reading', 'relax']);
    expect(routineOrder({ ...DEFAULT_RUNDOWN, order: [] })).toEqual(DEFAULT_ORDER);
  });

  it('switches steps off and on, sets minutes and reading time, and resets', () => {
    let s = toggleRundownStep(DEFAULT_RUNDOWN, 'shower', false);
    s = toggleRundownStep(s, 'phone-down', false);
    s = setRundownMinutes(s, 'teeth', 12);
    s = setRundownMinutes(s, 'alcohol', 240);
    s = setRundownMinutes(s, 'fluids', 5);
    s = setRundownMinutes(s, 'reading', 15);
    expect(s).toMatchObject({ off: ['shower'], minutes: { teeth: 12, alcohol: 240, fluids: 30 }, readingMin: 15 });
    const r = build(state(s), { ...tonight, windDownStart: bed - 90 * MINUTE });
    expect(r.steps.find((x) => x.id === 'shower')).toBeUndefined();
    expect(formatTime(step(r, 'alcohol').at)).toBe('19:15');
    expect(step(r, 'alcohol').detail).toMatch(/Stopping 4 h before lights-out/);
    expect(step(r, 'teeth').min).toBe(12);
    // Reading: none, and back on at its default.
    const none = toggleRundownStep(s, 'reading', false);
    expect(none.readingMin).toBe(0);
    expect(build(state(none)).steps.find((x) => x.id === 'reading')).toBeUndefined();
    expect(toggleRundownStep(none, 'reading', true).readingMin).toBe(30);
    expect(nudgeRundownMinutes('teeth', 10, 1)).toBe(15);
    expect(nudgeRundownMinutes('teeth', 10, -1)).toBe(9);
    expect(nudgeRundownMinutes('teeth', 1, -1)).toBe(1);
    expect(nudgeRundownMinutes('shower', 90, 1)).toBe(105);
    expect(nudgeRundownMinutes('meal', 180, 1)).toBe(180);
    expect(resetRundown({ ...s, enabled: false })).toEqual({ ...DEFAULT_RUNDOWN, enabled: false });
  });

  it('lists every step for the editor, on or off, with tonight’s times', () => {
    const s = toggleRundownStep(addCustomRundownStep(DEFAULT_RUNDOWN, { title: 'Stretch', min: 5, screenFree: true }, 'custom-a'), 'shower', false);
    const c = rundownCatalog({ tonight, alarm, caffeine }, state(s));
    expect(c.evening.map((x) => [x.id, x.on])).toEqual([
      ['caffeine', true],
      ['dim-lights', true],
      ['meal', true],
      ['alcohol', true],
      ['exercise', true],
      ['fluids', true],
      ['shower', false],
    ]);
    const shower = c.evening.find((x) => x.id === 'shower')!;
    expect(shower.detail).toMatch(/Haghayegh/);
    expect(shower.at).toBeUndefined();
    expect(shower.range).toEqual({ min: 45, max: 150, step: 15 });
    expect(c.evening.find((x) => x.id === 'meal')).toMatchObject({ at: tonight.lastMeal, from: '3 h before lights-out' });
    expect(c.routine.map((x) => x.id)).toEqual([...DEFAULT_ORDER, 'custom-a', 'lights-out']);
    expect(c.routine.find((x) => x.id === 'phone-down')).toMatchObject({ required: true, canUp: true, canDown: true, canRemind: false });
    expect(c.routine.find((x) => x.id === 'alarm')).toMatchObject({ canDown: false, screenFree: false });
    expect(c.routine.find((x) => x.id === 'custom-a')).toMatchObject({ custom: true, canDown: false, at: bed - 5 * MINUTE });
    // Without a plan yet the words are still there, without times.
    const none = rundownCatalog(undefined, state());
    expect(none.routine.every((x) => x.at === undefined && x.detail.length > 20)).toBe(true);
    expect(none.evening.find((x) => x.id === 'caffeine')!.detail).toMatch(/Log your coffee/);
  });

  it('marks steps with their own reminder', () => {
    const r = build(state(setRundownReminder(setRundownReminder(DEFAULT_RUNDOWN, 'shower', true), 'phone-down', true)));
    expect(step(r, 'shower').remind).toBe(true);
    expect(step(r, 'phone-down').remind).toBe(false);
    expect(step(r, 'teeth').remind).toBe(false);
  });
});

describe('the guided player', () => {
  const play = (p: RundownProgress, now: number) => build(state({}, { rundownProgress: p }), tonight, now);

  it('goes one step at a time with Done, Skip and Back', () => {
    const start = tonight.windDownStart;
    let p = startRundownProgress(build(), start);
    let r = play(p, start);
    expect(playerPosition(r)).toMatchObject({ index: 0, total: 9, marked: 0, step: { id: 'tomorrow' } });
    expect(rundownNow(r, start).current?.id).toBe('tomorrow');
    p = markRundownStep(p, 'tomorrow', 'done', start + 4 * MINUTE);
    p = markRundownStep(p, 'todo-list', 'skipped', start + 5 * MINUTE);
    r = play(p, start + 5 * MINUTE);
    expect(playerPosition(r)).toMatchObject({ index: 2, marked: 2, step: { id: 'bedroom' } });
    expect(step(r, 'tomorrow')).toMatchObject({ status: 'done', at: start, end: start + 4 * MINUTE, min: 4 });
    expect(step(r, 'todo-list').status).toBe('skipped');
    // Ahead of time: the rest still ends at lights-out, nothing shortened.
    expect(r.note).toBeUndefined();
    expect(step(r, 'bedroom').at).toBe(bed - 50 * MINUTE);
    // Back: the skipped step comes up again.
    p = backRundownStep(p, r, start + 6 * MINUTE);
    r = play(p, start + 6 * MINUTE);
    expect(playerPosition(r).step?.id).toBe('todo-list');
    expect(p.since).toBe(start + 6 * MINUTE);
  });

  it('once the phone is down, the screen-free steps move on by the clock', () => {
    let p = startRundownProgress(build(), tonight.windDownStart);
    for (const id of ['tomorrow', 'todo-list', 'bedroom', 'alarm']) p = markRundownStep(p, id, 'done', tonight.windDownStart + 10 * MINUTE);
    p = markRundownStep(p, 'phone-down', 'done', bed - 45 * MINUTE);
    expect(playerPosition(play(p, bed - 40 * MINUTE)).step?.id).toBe('teeth');
    const reading = play(p, bed - 20 * MINUTE);
    expect(playerPosition(reading).step?.id).toBe('reading');
    expect(step(reading, 'teeth').status).toBe('done');
    expect(playerPosition(play(p, bed - 1 * MINUTE)).step?.id).toBe('relax');
    expect(playerPosition(play(p, bed)).step?.id).toBe('lights-out');
  });

  it('"pick up from now" skips what the clock says is over', () => {
    const r = build();
    const now = bed - 20 * MINUTE;
    expect(canPickUp(r, now)).toBe(true);
    expect(canPickUp(r, tonight.windDownStart + MINUTE)).toBe(false);
    const p = startRundownProgress(r, now, true);
    expect(Object.keys(p.marks)).toEqual(['tomorrow', 'todo-list', 'bedroom', 'alarm', 'phone-down', 'teeth']);
    expect(playerPosition(play(p, now)).step?.id).toBe('reading');
  });

  it("is tonight's only: another night's progress is ignored", () => {
    const p = { ...startRundownProgress(build(), tonight.windDownStart), wakeDate: '2026-10-29' };
    expect(play(p, tonight.windDownStart).playing).toBe(false);
  });

  it('without the player: the step under way now and the next one', () => {
    const r = build();
    expect(rundownNow(r, bed - 40 * MINUTE)).toMatchObject({ current: { id: 'teeth' }, next: { id: 'reading' } });
    expect(rundownNow(r, bed - 85 * MINUTE)).toMatchObject({ current: { id: 'shower' }, next: { id: 'tomorrow' } });
    expect(rundownNow(r, bed - 120 * MINUTE).current).toBeUndefined();
  });
});
