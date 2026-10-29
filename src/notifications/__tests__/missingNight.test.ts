jest.mock('expo-notifications', () => ({ dismissNotificationAsync: jest.fn(() => Promise.resolve()), clearLastNotificationResponse: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

import { router } from 'expo-router';

import { addDays } from '../../engine/time';
import type { SleepDataset } from '../../engine/types';
import { missingNight, planMissingNight } from '../features/missingNight';
import { at, SATURDAY, scenario, WORKDAY } from './helpers';

const withoutLastNight =
  (day: string) =>
  (d: SleepDataset): SleepDataset => ({ ...d, sessions: d.sessions.filter((s) => s.id !== `demo-${day}`) });

describe('missing-night nudge', () => {
  it('nudges at 10:00 on a workday when last night has not arrived', () => {
    const ctx = scenario(at(WORKDAY, 8.5), { edit: withoutLastNight(WORKDAY) });
    expect(ctx.analysis.lastNightIsCurrent).toBe(false);
    const planned = planMissingNight(ctx);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ id: `missing-${WORKDAY}`, at: at(WORKDAY, 10), channel: 'reminders', categoryId: 'missing-night' });
    expect(planned[0].body).toMatch(/Nothing X/);
  });

  it('waits until 90 min after a late free-day wake-up', () => {
    const ctx = scenario(at(SATURDAY, 9));
    expect(ctx.analysis.lastNightIsCurrent).toBe(false);
    const [p] = planMissingNight(ctx);
    expect(p.id).toBe(`missing-${SATURDAY}`);
    expect(p.at).toBeGreaterThanOrEqual(at(SATURDAY, 10));
    expect(p.at).toBeLessThan(at(SATURDAY, 13));
  });

  it("schedules tomorrow's instead once today's 10:00 has passed", () => {
    const ctx = scenario(at(WORKDAY, 8.5), { now: at(WORKDAY, 10.5), edit: withoutLastNight(WORKDAY) });
    const planned = planMissingNight(ctx);
    expect(planned.map((p) => p.id)).toEqual([`missing-${addDays(WORKDAY, 1)}`]);
    expect(planned[0].at).toBe(at(addDays(WORKDAY, 1), 10));
  });

  it("keeps tomorrow's nudge pending when today's night is in (a sync tomorrow cancels it)", () => {
    const ctx = scenario(at(WORKDAY, 8.5));
    expect(ctx.analysis.lastNightIsCurrent).toBe(true);
    expect(planMissingNight(ctx).map((p) => p.id)).toEqual([`missing-${addDays(WORKDAY, 1)}`]);
  });

  it('only applies to live Health Connect data with the setting on', () => {
    const edit = withoutLastNight(WORKDAY);
    expect(planMissingNight(scenario(at(WORKDAY, 8.5), { edit, prefs: { missingNightNudge: false } }))).toEqual([]);
    expect(planMissingNight(scenario(at(WORKDAY, 8.5), { edit, settings: { dataMode: 'demo' } }))).toEqual([]);
    const manual = scenario(at(WORKDAY, 8.5), { edit });
    const state = { ...manual.state, sessions: manual.state.sessions.map((s) => ({ ...s, source: 'manual' as const })) };
    expect(planMissingNight({ ...manual, state })).toEqual([]);
  });

  it('offers to log the night manually', async () => {
    const ctx = scenario(at(WORKDAY, 8.5));
    await missingNight.onResponse!({ actionId: 'log', data: {} }, ctx.state);
    expect(router.push).toHaveBeenCalledWith('/log-sleep');
  });
});
