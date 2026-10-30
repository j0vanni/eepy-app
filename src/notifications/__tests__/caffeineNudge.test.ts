import type { Analysis } from '../../engine/analysis';
import { USUAL_SKIPPED_MARK } from '../../engine/caffeineHabits';
import { addDays, atMinutes, formatTime } from '../../engine/time';
import type { CaffeineDose } from '../../engine/types';
import type { AppState } from '../../state/store';
import { caffeineNudge } from '../features/caffeineNudge';
import { openRoute } from '../features/learningShared';
import type { PlannerContext } from '../types';

jest.mock('../features/learningShared', () => ({ dismissPresented: jest.fn(async () => undefined), openRoute: jest.fn() }));
const mockState: { current?: AppState } = {};
jest.mock('../../state/store', () => ({ useStore: { getState: () => mockState.current } }));

const TODAY = '2026-10-29';
const coffee = (day: string, min: number): CaffeineDose => ({ id: `${day}-${min}`, time: atMinutes(day, min), mg: 95, label: 'Coffee (8 oz / 240 ml)' });
/** Two weeks of an ~08:10 coffee. */
const HISTORY = Array.from({ length: 14 }, (_, i) => coffee(addDays(TODAY, -i - 1), 8 * 60 + 5 + (i % 3) * 5));

function ctx(nowH: number, opts: { caffeine?: CaffeineDose[]; marks?: Record<string, string>; on?: boolean } = {}): PlannerContext {
  const state = {
    caffeine: opts.caffeine ?? HISTORY,
    settings: { notifications: { caffeineNudge: opts.on ?? true }, marks: opts.marks ?? {} },
    setMark: jest.fn(),
    addCaffeine: jest.fn(),
  } as unknown as AppState;
  mockState.current = state;
  return { analysis: {} as Analysis, state, now: atMinutes(TODAY, nowH * 60), background: false };
}

describe('caffeine nudge', () => {
  it('asks an hour after the usual coffee, today and tomorrow', () => {
    const planned = caffeineNudge.plan(ctx(7));
    expect(planned.map((p) => [p.id, formatTime(p.at)])).toEqual([
      [TODAY, '09:10'],
      [addDays(TODAY, 1), '09:10'],
    ]);
    expect(planned[0]).toMatchObject({ categoryId: 'eepy-usual-coffee', data: { date: TODAY, timeMin: 8 * 60 + 10, mg: 95 } });
    expect(planned[0].body).toContain('08:10');
  });

  it("doesn't ask when something is logged, the user said not today, it's off, or the habit is over", () => {
    expect(caffeineNudge.plan(ctx(7, { caffeine: [...HISTORY, coffee(TODAY, 7 * 60)] })).map((p) => p.id)).toEqual([addDays(TODAY, 1)]);
    expect(caffeineNudge.plan(ctx(7, { marks: { [USUAL_SKIPPED_MARK]: TODAY } })).map((p) => p.id)).toEqual([addDays(TODAY, 1)]);
    expect(caffeineNudge.plan(ctx(7, { on: false }))).toEqual([]);
    const old = HISTORY.map((d) => ({ ...d, time: d.time - 10 * 24 * 3600_000 }));
    expect(caffeineNudge.plan(ctx(7, { caffeine: old }))).toEqual([]);
  });

  it('"Yes" logs the usual drink at the usual time, once', async () => {
    const c = ctx(9.3);
    jest.spyOn(Date, 'now').mockReturnValue(c.now);
    const data = { date: TODAY, timeMin: 8 * 60 + 10, mg: 95, label: 'Coffee (8 oz / 240 ml)' };
    await caffeineNudge.onResponse!({ actionId: 'coffee-yes', data }, c.state);
    expect(c.state.addCaffeine).toHaveBeenCalledWith({ id: `c-usual-${TODAY}`, time: atMinutes(TODAY, 8 * 60 + 10), mg: 95, label: data.label });

    const again = ctx(9.4, { caffeine: [...HISTORY, { id: `c-usual-${TODAY}`, time: 0, mg: 95, label: 'x' }] });
    await caffeineNudge.onResponse!({ actionId: 'coffee-yes', data }, again.state);
    expect(again.state.addCaffeine).not.toHaveBeenCalled();
  });

  it('"Not today" stops asking; a tap opens the drink editor', async () => {
    const c = ctx(9.3);
    jest.spyOn(Date, 'now').mockReturnValue(c.now);
    await caffeineNudge.onResponse!({ actionId: 'coffee-no', data: { date: TODAY } }, c.state);
    expect(c.state.setMark).toHaveBeenCalledWith(USUAL_SKIPPED_MARK, TODAY);
    await caffeineNudge.onResponse!({ actionId: 'default', data: { date: TODAY } }, c.state);
    expect(openRoute).toHaveBeenCalledWith({ pathname: '/caffeine', params: { usual: '1' } });
  });
});
