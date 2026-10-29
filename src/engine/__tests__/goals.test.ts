import { analyze } from '../analysis';
import { generateDemoData } from '../demo';
import { evaluateGoalDay, evaluateGoals, GoalDay, GoalInput, goalAdherence, goalInput, GoalSetting, streaks, toggleGoal, WIND_DOWN_TAG } from '../goals';
import { analyzeSessions, buildNights } from '../sessions';
import { addDays, atMinutes } from '../time';
import type { CaffeineDose, DayLog, SleepSession } from '../types';
import { night, profile } from './helpers';

const TODAY = '2026-10-21';

function input(opts: { sessions: SleepSession[]; caffeine?: CaffeineDose[]; dayLogs?: Record<string, DayLog>; needMin?: number; now?: number }): GoalInput {
  const nights = buildNights(analyzeSessions(opts.sessions));
  return {
    today: TODAY,
    now: opts.now ?? atMinutes(TODAY, 12 * 60),
    nights,
    needMin: opts.needMin ?? 450,
    latencyMin: 10,
    efficiency: 0.92,
    habitualOnsetMin: 23 * 60,
    dayLogs: opts.dayLogs ?? {},
    caffeine: opts.caffeine ?? [],
    profile: profile({ workWakeMin: 7 * 60, workdays: [0, 1, 2, 3, 4, 5, 6] }),
  };
}

/** Wake dates from TODAY-13 … TODAY; `wakeShift` moves individual mornings. */
function twoWeeks(opts: { hours?: number; wakeShift?: Record<string, number>; skip?: string[]; onsetMin?: number } = {}): SleepSession[] {
  const out: SleepSession[] = [];
  for (let i = 13; i >= 0; i--) {
    const wake = addDays(TODAY, -i);
    if (opts.skip?.includes(wake)) continue;
    const hours = opts.hours ?? 7.5;
    const onset = (opts.onsetMin ?? 7 * 60 - hours * 60 + 24 * 60) + (opts.wakeShift?.[wake] ?? 0);
    out.push(night(addDays(wake, -1), onset, hours, { latencyMin: 10, id: `n-${wake}` }));
  }
  return out;
}

const setting = (id: GoalSetting['id'], targetMin?: number): GoalSetting => ({ id, enabled: true, startedAt: TODAY, targetMin });
const day = (s: GoalSetting, date: string, inp: GoalInput) => evaluateGoalDay(s, date, inp, new Map(inp.nights.map((n) => [n.wakeDate, n])));

describe('goal evaluation', () => {
  it('checks the wake time against the target (±30 min)', () => {
    const inp = input({ sessions: twoWeeks({ wakeShift: { '2026-10-18': 45, '2026-10-19': 25 } }) });
    const s = setting('consistent-wake', 7 * 60);
    expect(day(s, '2026-10-17', inp).status).toBe('met');
    expect(day(s, '2026-10-18', inp)).toMatchObject({ status: 'missed', detail: expect.stringContaining('45 min late') });
    expect(day(s, '2026-10-19', inp).status).toBe('met');
  });

  it('marks missing nights unknown, and today pending until it syncs', () => {
    const inp = input({ sessions: twoWeeks({ skip: ['2026-10-15', TODAY] }) });
    expect(day(setting('meet-need'), '2026-10-15', inp).status).toBe('unknown');
    expect(day(setting('meet-need'), TODAY, inp).status).toBe('pending');
  });

  it('checks sleep need and debt', () => {
    const short = input({ sessions: twoWeeks({ hours: 6 }), needMin: 480 });
    expect(day(setting('meet-need'), TODAY, short).status).toBe('missed');
    expect(day(setting('debt-under-2h'), TODAY, short).status).toBe('missed');
    const enough = input({ sessions: twoWeeks({ hours: 8 }), needMin: 480 });
    expect(day(setting('meet-need'), TODAY, enough).status).toBe('met');
    expect(day(setting('debt-under-2h'), TODAY, enough).status).toBe('met');
  });

  it('compares sleep onset with the planned or a fixed lights-out', () => {
    const inp = input({ sessions: twoWeeks({ wakeShift: { '2026-10-18': 50 } }) });
    // Fixed lights-out 23:30: normal nights fall asleep 23:30, the shifted one 00:20.
    const s = setting('in-bed-on-time', 23 * 60 + 30);
    expect(day(s, '2026-10-17', inp).status).toBe('met');
    expect(day(s, '2026-10-18', inp).status).toBe('missed');
    // Without a fixed time it recreates that evening's plan.
    expect(day(setting('in-bed-on-time'), '2026-10-17', inp).detail).toMatch(/planned \d\d:\d\d/);
  });

  it('checks the caffeine cut-off only for people who log caffeine', () => {
    const sessions = twoWeeks();
    const none = input({ sessions });
    const s = setting('caffeine-cutoff', 14 * 60);
    expect(day(s, '2026-10-18', none).status).toBe('unknown');
    const caffeine: CaffeineDose[] = [
      { id: 'a', time: atMinutes('2026-10-18', 8 * 60), mg: 95, label: 'Coffee' },
      { id: 'b', time: atMinutes('2026-10-19', 16 * 60), mg: 95, label: 'Coffee' },
      { id: 'c', time: atMinutes(TODAY, 15 * 60), mg: 63, label: 'Espresso' },
    ];
    const logged = input({ sessions, caffeine, now: atMinutes(TODAY, 16 * 60) });
    expect(day(s, '2026-10-18', logged).status).toBe('met');
    expect(day(s, '2026-10-19', logged).status).toBe('missed');
    expect(day(s, TODAY, logged)).toMatchObject({ status: 'missed', detail: '63 mg at 15:00' });
    const clean = input({ sessions, caffeine: caffeine.slice(0, 2), now: atMinutes(TODAY, 16 * 60) });
    expect(day(s, TODAY, clean)).toMatchObject({ status: 'pending', detail: 'Nothing after 14:00 so far' });
  });

  it('reads wind-down from journal tags', () => {
    const dayLogs: Record<string, DayLog> = {
      '2026-10-18': { date: '2026-10-18', tags: ['reading'] },
      '2026-10-19': { date: '2026-10-19', tags: ['reading', 'screens'] },
      [TODAY]: { date: TODAY, tags: [WIND_DOWN_TAG] },
    };
    const inp = input({ sessions: twoWeeks(), dayLogs });
    const s = setting('wind-down');
    expect(day(s, '2026-10-18', inp).status).toBe('met');
    expect(day(s, '2026-10-19', inp).status).toBe('missed');
    expect(day(s, '2026-10-20', inp).status).toBe('unknown');
    expect(day(s, TODAY, inp).status).toBe('met');
  });
});

describe('streaks', () => {
  const d = (statuses: string): GoalDay[] =>
    [...statuses].map((c, i) => ({ date: addDays(TODAY, i - statuses.length + 1), status: ({ m: 'met', x: 'missed', u: 'unknown', p: 'pending' } as const)[c as 'm']! }));

  it('counts consecutive met days, ignoring today while pending', () => {
    expect(streaks(d('xmmmp'))).toEqual({ current: 3, best: 3 });
    expect(streaks(d('mmmmxmmp'))).toEqual({ current: 2, best: 4 });
    expect(streaks(d('mmx'))).toEqual({ current: 0, best: 2 });
  });

  it('lets up to two days without data pass without breaking a streak', () => {
    expect(streaks(d('mmuumm'))).toEqual({ current: 4, best: 4 });
    expect(streaks(d('mmuuumm'))).toEqual({ current: 2, best: 2 });
  });
});

describe('goals summary', () => {
  it('evaluates only enabled goals with history, streaks and a weekly score', () => {
    const inp = input({ sessions: twoWeeks({ wakeShift: { '2026-10-16': 60 } }) });
    const res = evaluateGoals([setting('consistent-wake', 7 * 60), { ...setting('meet-need'), enabled: false }], inp, 30);
    expect(res.goals).toHaveLength(1);
    const g = res.goals[0];
    expect(g.days).toHaveLength(30);
    expect(g.today.date).toBe(TODAY);
    expect(g.currentStreak).toBe(5); // 17th … 21st
    expect(g.bestStreak).toBe(8); // 8th … 15th
    expect(g.weekMet).toBe(6);
    expect(g.weekKnown).toBe(7);
    expect(res.weeklyScore).toBe(86);
    expect(goalAdherence([setting('consistent-wake', 7 * 60)], inp, '2026-10-12', '2026-10-18')).toEqual([{ id: 'consistent-wake', title: 'Consistent wake time', met: 6, known: 7 }]);
  });

  it('keeps the original start date when a goal is switched back on the same way', () => {
    let goals = toggleGoal([], 'debt-under-2h', true, '2026-10-01');
    expect(goals).toEqual([{ id: 'debt-under-2h', enabled: true, startedAt: '2026-10-01', targetMin: undefined }]);
    goals = toggleGoal(goals, 'debt-under-2h', false, '2026-10-05');
    expect(goals[0]).toMatchObject({ enabled: false, startedAt: '2026-10-01' });
    goals = toggleGoal(goals, 'debt-under-2h', true, '2026-10-09');
    expect(goals[0]).toMatchObject({ enabled: true, startedAt: '2026-10-09' });
  });

  it('runs on the demo dataset', () => {
    const now = atMinutes('2026-10-29', 15 * 60);
    const demo = generateDemoData(now);
    const a = analyze(demo, now);
    const all: GoalSetting[] = (['consistent-wake', 'debt-under-2h', 'caffeine-cutoff', 'in-bed-on-time', 'meet-need', 'wind-down'] as const).map((id) => setting(id, id === 'caffeine-cutoff' ? 14 * 60 : undefined));
    const res = evaluateGoals(all, goalInput(a, demo));
    expect(res.goals).toHaveLength(6);
    for (const g of res.goals) {
      expect(g.bestStreak).toBeGreaterThanOrEqual(g.currentStreak);
      expect(g.days.every((x) => ['met', 'missed', 'unknown', 'pending'].includes(x.status))).toBe(true);
    }
    expect(res.weeklyScore).toBeGreaterThanOrEqual(0);
    expect(res.weeklyScore).toBeLessThanOrEqual(100);
  });
});
