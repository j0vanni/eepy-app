import type { Analysis } from '../../engine/analysis';
import { addDays, atMinutes, HOUR, MINUTE, minutesOfDay, weekdayOfKey } from '../../engine/time';
import { DEFAULT_PROFILE } from '../../engine/types';
import type { AppState } from '../../state/store';
import { naturalWake } from '../features/naturalWake';
import { pings } from '../features/pings';
import type { PlannerContext } from '../types';

jest.mock('../features/learningShared', () => ({ dismissPresented: jest.fn(async () => undefined), openRoute: jest.fn() }));
jest.mock('../../state/learning', () => ({ refitCalibration: jest.fn() }));
const mockState: { current?: AppState } = {};
jest.mock('../../state/store', () => ({ useStore: { getState: () => mockState.current } }));

// 2026-10-24 is a Saturday (free day by default), 2026-10-26 a Monday.
const SAT = '2026-10-24';
const MON = '2026-10-26';

function ctx(day: string, nowH: number, opts: { lastNightIsCurrent?: boolean; wakeH?: number; state?: Partial<AppState>; prefs?: object } = {}): PlannerContext {
  const tomorrow = addDays(day, 1);
  const analysis = {
    day,
    now: atMinutes(day, nowH * 60),
    wakeTime: atMinutes(day, (opts.wakeH ?? 7) * 60),
    lastNightIsCurrent: opts.lastNightIsCurrent ?? true,
    tonight: { wakeDate: tomorrow, wake: atMinutes(tomorrow, 7 * 60), windDownStart: atMinutes(day, 22 * 60) },
  } as unknown as Analysis;
  const state = {
    profile: DEFAULT_PROFILE,
    dayLogs: {},
    checkins: [],
    calibration: undefined,
    settings: { notifications: { pings: true, pingsPerDay: 3, naturalWakePrompt: true, ...opts.prefs }, marks: {} },
    ...opts.state,
  } as unknown as AppState;
  return { analysis, state, now: analysis.now, background: false };
}

describe('pings feature', () => {
  it('plans the rest of today and tomorrow with action buttons', () => {
    const planned = pings.plan(ctx(MON, 12));
    const today = planned.filter((p) => p.id.startsWith(MON));
    const tomorrow = planned.filter((p) => p.id.startsWith(addDays(MON, 1)));
    expect(today.every((p) => p.at > atMinutes(MON, 12 * 60))).toBe(true);
    expect(tomorrow).toHaveLength(3);
    expect(planned.every((p) => p.categoryId === 'eepy-ping' && p.channel === 'pings' && p.data?.pid === p.id)).toBe(true);
  });

  it('respects the setting and the taper', () => {
    expect(pings.plan(ctx(MON, 6, { prefs: { pings: false } }))).toEqual([]);
    const tapered = pings.plan(ctx(MON, 6, { state: { calibration: { n: 50, days: 20 } as AppState['calibration'] } }));
    expect(tapered.filter((p) => p.id.startsWith(MON))).toHaveLength(1);
  });

  it('logs a button answer once, ignores stale answers', async () => {
    const addCheckIn = jest.fn();
    const at = Date.now() - 10 * MINUTE;
    mockState.current = { ...ctx(MON, 12).state, addCheckIn, checkins: [] } as unknown as AppState;
    await pings.onResponse!({ actionId: 'ping-sleepy', data: { pid: `${MON}-afternoon`, at } }, mockState.current);
    expect(addCheckIn).toHaveBeenCalledWith(expect.objectContaining({ id: `ping-${MON}-afternoon`, kss: 7, source: 'ping' }));

    mockState.current = { ...mockState.current, checkins: [{ id: `ping-${MON}-afternoon`, time: at, kss: 7, source: 'ping' }] } as AppState;
    await pings.onResponse!({ actionId: 'ping-alert', data: { pid: `${MON}-afternoon`, at } }, mockState.current);
    await pings.onResponse!({ actionId: 'ping-alert', data: { pid: `${MON}-morning`, at: Date.now() - 3 * HOUR } }, mockState.current);
    expect(addCheckIn).toHaveBeenCalledTimes(1);
  });
});

describe('natural-wake feature', () => {
  it('asks 45 min after the recorded wake on a free day, and tomorrow if free', () => {
    expect(weekdayOfKey(SAT)).toBe(6);
    const planned = naturalWake.plan(ctx(SAT, 8, { wakeH: 7.75 }));
    expect(planned.map((p) => p.id)).toEqual([SAT, addDays(SAT, 1)]);
    expect(minutesOfDay(planned[0].at)).toBe(8 * 60 + 30);
    // Sunday: no data yet → free-day target (08:00) + 30 min sleep-in + 45 min.
    expect(minutesOfDay(planned[1].at)).toBe(9 * 60 + 15);
  });

  it('falls back to a stable time while last night is missing, or once the real time has passed', () => {
    expect(minutesOfDay(naturalWake.plan(ctx(SAT, 7, { lastNightIsCurrent: false }))[0].at)).toBe(9 * 60 + 15);
    expect(minutesOfDay(naturalWake.plan(ctx(SAT, 8.9, { wakeH: 7.75 }))[0].at)).toBe(9 * 60 + 15);
  });

  it('skips workdays, answered days and a disabled prompt', () => {
    expect(naturalWake.plan(ctx(MON, 7)).map((p) => p.id)).toEqual([]);
    expect(naturalWake.plan(ctx(SAT, 7, { state: { dayLogs: { [SAT]: { date: SAT, tags: [], wokeNaturally: true } } } })).map((p) => p.id)).toEqual([addDays(SAT, 1)]);
    expect(naturalWake.plan(ctx(SAT, 7, { prefs: { naturalWakePrompt: false } }))).toEqual([]);
  });
});
