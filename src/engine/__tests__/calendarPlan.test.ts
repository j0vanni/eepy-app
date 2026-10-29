import { CalendarEvent, eveningConflicts, livingDay, pickFirstEvent, shortTitle, tomorrowWindow, tonightWindow } from '../calendarEvents';
import { planTonight, PlanInput, wakeForEvent } from '../schedule';
import { atMinutes, formatTime, MINUTE, weekdayOfKey } from '../time';
import { profile } from './helpers';

// 2026-10-20 is a Tuesday, so the plan's wake date (Wednesday) is a workday; 2026-10-23 → Saturday is free.
const WORK_EVENING = '2026-10-20';
const WORK_MORNING = '2026-10-21';
const FREE_EVENING = '2026-10-23';
const FREE_MORNING = '2026-10-24';

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  profile: profile({ workWakeMin: 7 * 60 }),
  today: WORK_EVENING,
  needMin: 480,
  debtMin: 0,
  efficiency: 0.92,
  latencyMin: 15,
  ...over,
});

const at = (date: string, hh: number, mm = 0) => atMinutes(date, hh * 60 + mm);

describe('planTonight with a calendar event', () => {
  it('sanity: test dates fall on the intended weekdays', () => {
    expect(weekdayOfKey(WORK_MORNING)).toBe(3);
    expect(weekdayOfKey(FREE_MORNING)).toBe(6);
  });

  it('is unchanged when there is no event', () => {
    const plain = planTonight(base());
    expect(plain.calendar).toBeUndefined();
    expect(planTonight(base({ firstEventStart: undefined, firstEventPrepMin: 120, firstEventTitle: 'x' }))).toEqual(plain);
  });

  it('keeps the usual wake when the event leaves enough time', () => {
    const plain = planTonight(base());
    const plan = planTonight(base({ firstEventStart: at(WORK_MORNING, 8) }));
    expect(plan.wake).toBe(plain.wake);
    expect(plan.bedtime).toBe(plain.bedtime);
    expect(plan.rationale).toEqual(plain.rationale);
    expect(plan.calendar).toMatchObject({ drove: false, fits: true, shortByMin: 0, reasons: [] });
  });

  it('wakes earlier for an early event and moves bedtime with it', () => {
    const plain = planTonight(base());
    const plan = planTonight(base({ firstEventStart: at(WORK_MORNING, 7, 30) }));
    expect(formatTime(plan.wake)).toBe('06:30');
    expect(plan.bedtime).toBe(plain.bedtime - 30 * MINUTE);
    expect(plan.inBedMin).toBe(plain.inBedMin);
    expect(plan.calendar).toMatchObject({ drove: true, fits: true, shortByMin: 0, usualWake: plain.wake, usualBedtime: plain.bedtime });
    expect(plan.rationale[0]).toBe('First event at 07:30 — waking 06:30 to have an hour before it.');
    expect(plan.rationale[plan.rationale.length - 1]).toMatch(/still covers your sleep need/);
    expect(plan.rationale[plan.rationale.length - 1]).toMatch(/30m earlier than usual/);
    expect(plan.calendar!.reasons).toHaveLength(2);
  });

  it('rounds the wake down to 5 minutes and names the event', () => {
    const plan = planTonight(base({ firstEventStart: at(WORK_MORNING, 7, 37), firstEventTitle: '  Team   stand-up ' }));
    expect(formatTime(plan.wake)).toBe('06:35');
    expect(plan.rationale[0]).toBe('First event at 07:37 (“Team stand-up”) — waking 06:35 to have an hour before it.');
    expect(plan.calendar!.eventTitle).toBe('Team stand-up');
  });

  it('uses the prep time from settings', () => {
    const plan = planTonight(base({ firstEventStart: at(WORK_MORNING, 8), firstEventPrepMin: 120 }));
    expect(formatTime(plan.wake)).toBe('06:00');
    expect(plan.rationale[0]).toMatch(/to have 2 hours before it/);
    const short = planTonight(base({ firstEventStart: at(WORK_MORNING, 7, 30), firstEventPrepMin: 45 }));
    expect(formatTime(short.wake)).toBe('06:45');
    expect(short.rationale[0]).toMatch(/to have 45 min before it/);
  });

  it('on free days, a later event never pushes the wake later than the free-day rule', () => {
    const free = planTonight(base({ today: FREE_EVENING }));
    expect(free.isWorkday).toBe(false);
    expect(formatTime(free.wake)).toBe('08:00');
    const late = planTonight(base({ today: FREE_EVENING, firstEventStart: at(FREE_MORNING, 13) }));
    expect(late.wake).toBe(free.wake);
    expect(late.calendar!.drove).toBe(false);
    const early = planTonight(base({ today: FREE_EVENING, firstEventStart: at(FREE_MORNING, 8, 30) }));
    expect(formatTime(early.wake)).toBe('07:30');
    expect(early.calendar!.drove).toBe(true);
  });

  it('says so when the body clock limits how early bedtime can move', () => {
    // Habitually asleep around 22:30 (usual lights-out 22:03); a 06:00 event means waking 05:00.
    const usual = planTonight(base({ habitualOnsetMin: 22 * 60 + 30 }));
    expect(usual.gradual).toBe(false);
    const plan = planTonight(base({ habitualOnsetMin: 22 * 60 + 30, firstEventStart: at(WORK_MORNING, 6) }));
    expect(formatTime(plan.wake)).toBe('05:00');
    expect(formatTime(plan.bedtime)).toBe('21:45');
    expect(plan.gradual).toBe(true);
    expect(plan.calendar!.shortByMin).toBeGreaterThan(60);
    const last = plan.rationale[plan.rationale.length - 1];
    expect(last).toMatch(/lights out at 20:03, too early for your body clock to fall asleep, so aim for 21:45 \(18m earlier than usual\)/);
    expect(last).toMatch(/short of your need/);
    // The "move earlier each night" advice is for permanent shifts, not a one-off event.
    expect(plan.rationale.join(' ')).not.toMatch(/each night/);
  });

  it('keeps lights-out where it is when the usual bedtime is already as early as the body clock allows', () => {
    const usual = planTonight(base({ habitualOnsetMin: 23 * 60 + 30 }));
    expect(formatTime(usual.bedtime)).toBe('22:45');
    const plan = planTonight(base({ habitualOnsetMin: 23 * 60 + 30, firstEventStart: at(WORK_MORNING, 6) }));
    expect(plan.bedtime).toBe(usual.bedtime);
    expect(plan.rationale[plan.rationale.length - 1]).toMatch(/^Lights out stays at 22:45 — .*short of your need/);
  });

  it('without body-clock data, keeps lights-out within 90 min of the usual bedtime', () => {
    const plain = planTonight(base());
    const plan = planTonight(base({ firstEventStart: at(WORK_MORNING, 5), firstEventPrepMin: 90 }));
    expect(formatTime(plan.wake)).toBe('03:30');
    expect(plan.bedtime).toBe(plain.bedtime - 90 * MINUTE);
    expect(plan.calendar!.shortByMin).toBeGreaterThan(0);
  });

  it('insomnia mode keeps the usual lights-out and accepts a shorter night', () => {
    const p = profile({ workWakeMin: 7 * 60, insomniaMode: true });
    const plain = planTonight(base({ profile: p }));
    const plan = planTonight(base({ profile: p, firstEventStart: at(WORK_MORNING, 7) }));
    expect(formatTime(plan.wake)).toBe('06:00');
    expect(plan.bedtime).toBe(plain.bedtime);
    expect(plan.rationale.join(' ')).toMatch(/Keeping your usual/);
  });

  it('ignores events that are not on the wake date or start in the small hours', () => {
    const plain = planTonight(base());
    for (const t of [at(WORK_MORNING, 1), at('2026-10-22', 6), at(WORK_EVENING, 21)]) {
      const plan = planTonight(base({ firstEventStart: t }));
      expect(plan.wake).toBe(plain.wake);
      expect(plan.calendar).toBeUndefined();
    }
  });

  it('a CBT-I window still wins, with a heads-up if it leaves too little time', () => {
    const sleepWindow = { bedMin: 23 * 60 + 30, wakeMin: 7 * 60, reason: 'CBT-I week 2: 7h 30m window.' };
    const ok = planTonight(base({ sleepWindow, firstEventStart: at(WORK_MORNING, 9) }));
    expect(ok.rationale).toEqual(['CBT-I week 2: 7h 30m window.']);
    expect(ok.calendar).toMatchObject({ drove: false, fits: true });
    const tight = planTonight(base({ sleepWindow, firstEventStart: at(WORK_MORNING, 7, 30) }));
    expect(formatTime(tight.wake)).toBe('07:00');
    expect(formatTime(tight.bedtime)).toBe('23:30');
    expect(tight.calendar).toMatchObject({ drove: false, fits: false });
    expect(tight.rationale[1]).toBe('Heads-up: First event at 07:30 is only 30m after this wake-up.');
  });

  it('wakeForEvent rounds down and rejects other days', () => {
    expect(formatTime(wakeForEvent(at(WORK_MORNING, 9, 4), 60, WORK_MORNING)!)).toBe('08:00');
    expect(wakeForEvent(at(WORK_MORNING, 2, 59), 60, WORK_MORNING)).toBeUndefined();
    expect(wakeForEvent(at('2026-10-22', 0), 60, WORK_MORNING)).toBeUndefined();
  });
});

const ev = (over: Partial<CalendarEvent> & { start: number; end: number }): CalendarEvent => ({
  id: `e-${over.start}`,
  title: 'Meeting',
  allDay: false,
  ...over,
});

describe('calendar event selection', () => {
  it('works out tomorrow and tonight from the living day (before 04:00 is still yesterday)', () => {
    expect(livingDay(at(WORK_MORNING, 1))).toBe(WORK_EVENING);
    expect(tomorrowWindow(at(WORK_MORNING, 1)).date).toBe(WORK_MORNING);
    expect(tomorrowWindow(at(WORK_EVENING, 15))).toEqual({ date: WORK_MORNING, from: at(WORK_MORNING, 0), to: at('2026-10-22', 0) });
    expect(tonightWindow(at(WORK_EVENING, 15))).toEqual({ from: at(WORK_EVENING, 15), to: at(WORK_MORNING, 3) });
  });

  it('picks the earliest timed, attended event from 03:00 tomorrow', () => {
    const events = [
      ev({ title: 'Holiday', start: at(WORK_MORNING, 0), end: at('2026-10-22', 0), allDay: true }),
      ev({ title: 'Late party', start: at(WORK_MORNING, 0, 30), end: at(WORK_MORNING, 2) }),
      ev({ title: 'Declined sync', start: at(WORK_MORNING, 7), end: at(WORK_MORNING, 7, 30), declined: true }),
      ev({ title: 'Cancelled', start: at(WORK_MORNING, 7, 15), end: at(WORK_MORNING, 8), canceled: true }),
      ev({ title: 'Lunch', start: at(WORK_MORNING, 12), end: at(WORK_MORNING, 13) }),
      ev({ title: 'Stand-up', start: at(WORK_MORNING, 9), end: at(WORK_MORNING, 9, 15) }),
      ev({ title: 'Next day', start: at('2026-10-22', 6), end: at('2026-10-22', 7) }),
    ];
    expect(pickFirstEvent(events, WORK_MORNING)?.title).toBe('Stand-up');
    expect(pickFirstEvent(events.slice(0, 4), WORK_MORNING)).toBeUndefined();
  });

  it('shortens long titles', () => {
    expect(shortTitle('  ')).toBeUndefined();
    expect(shortTitle('A'.repeat(60))).toHaveLength(40);
  });
});

describe('tonight’s late events', () => {
  // Lights out 23:15, wind-down from 22:15, wake 07:00.
  const plan = { windDownStart: at(WORK_EVENING, 22, 15), bedtime: at(WORK_EVENING, 23, 15), wake: at(WORK_MORNING, 7), lastMeal: at(WORK_EVENING, 20, 15) };
  const now = at(WORK_EVENING, 17);

  it('flags a dinner that eats into the wind-down', () => {
    const [c] = eveningConflicts([ev({ title: 'Dinner with Sam', start: at(WORK_EVENING, 19, 30), end: at(WORK_EVENING, 22, 30) })], plan, now);
    expect(c.kind).toBe('short-wind-down');
    expect(c.windDownLeftMin).toBe(45);
    expect(c.lateMeal).toBe(true);
    expect(c.headline).toBe('“Dinner with Sam” ends 22:30 — your wind-down will be short (45 min instead of 60)');
    expect(c.advice).toMatch(/keep lights-out at 23:15/);
    expect(c.advice).toMatch(/go easy on alcohol/);
  });

  it('flags events running past bedtime and suggests keeping the wake time', () => {
    const [c] = eveningConflicts([ev({ title: 'Concert', start: at(WORK_EVENING, 21), end: at(WORK_MORNING, 0, 30) })], plan, now);
    expect(c.kind).toBe('past-bedtime');
    expect(c.headline).toBe('“Concert” runs until 00:30 — past your 23:15 lights-out');
    expect(c.advice).toMatch(/Keep tomorrow's 07:00 wake-up/);
    expect(c.advice).toMatch(/6h 10m in bed/);
    expect(c.lateMeal).toBe(false);
  });

  it('flags a late workout', () => {
    const [c] = eveningConflicts([ev({ title: 'Gym', start: at(WORK_EVENING, 21, 30), end: at(WORK_EVENING, 22, 30) })], plan, now);
    expect(c.lateWorkout).toBe(true);
    expect(c.advice).toMatch(/moderate/);
  });

  it('ignores events that end before the wind-down, have ended, are declined, or are tomorrow morning', () => {
    const events = [
      ev({ title: 'Early dinner', start: at(WORK_EVENING, 18), end: at(WORK_EVENING, 20) }),
      ev({ title: 'Declined drinks', start: at(WORK_EVENING, 21), end: at(WORK_EVENING, 23), declined: true }),
      ev({ title: 'All day', start: at(WORK_EVENING, 0), end: at(WORK_MORNING, 0), allDay: true }),
      ev({ title: 'Stand-up', start: at(WORK_MORNING, 6, 30), end: at(WORK_MORNING, 7) }),
    ];
    expect(eveningConflicts(events, plan, now)).toEqual([]);
    const ended = ev({ title: 'Call', start: at(WORK_EVENING, 21), end: at(WORK_EVENING, 22, 30) });
    expect(eveningConflicts([ended], plan, at(WORK_EVENING, 22, 45))).toEqual([]);
    expect(eveningConflicts([ended], plan, at(WORK_EVENING, 22))).toHaveLength(1);
  });

  it('sorts by end time', () => {
    const out = eveningConflicts(
      [
        ev({ title: 'B', start: at(WORK_EVENING, 22), end: at(WORK_MORNING, 1) }),
        ev({ title: 'A', start: at(WORK_EVENING, 21), end: at(WORK_EVENING, 22, 45) }),
      ],
      plan,
      now,
    );
    expect(out.map((c) => c.event.title)).toEqual(['A', 'B']);
    expect(out[1].windDownLeftMin).toBe(-105);
  });
});
