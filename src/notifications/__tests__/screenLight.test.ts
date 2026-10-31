jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

import { analyze } from '../../engine/analysis';
import { MINUTE } from '../../engine/time';
import { screenLight } from '../features/screenLight';
import { at, scenario, WORKDAY } from './helpers';

describe('phone-light reminder', () => {
  it('asks for Night Light ~3 h before lights-out, with a settings button', () => {
    const ctx = scenario(at(WORKDAY, 12), { prefs: { screenLight: true } });
    const [n] = screenLight.plan(ctx);
    expect(n).toMatchObject({ at: ctx.analysis.tonight.bedtime - 180 * MINUTE, categoryId: 'screen-light', data: { route: '/winddown' } });
    expect(n.body).toMatch(/Night Light/);
  });

  it('follows an adjusted night and can be turned off', () => {
    const ctx = scenario(at(WORKDAY, 12), { prefs: { screenLight: true } });
    const late = ctx.analysis.tonight.bedtime + 60 * MINUTE;
    const analysis = analyze({ ...ctx.state }, ctx.now, { tonightOverride: { wakeDate: ctx.analysis.tonight.wakeDate, bedtime: late } });
    expect(screenLight.plan({ ...ctx, analysis })[0].at).toBe(late - 180 * MINUTE);
    expect(screenLight.plan(scenario(at(WORKDAY, 12), { prefs: { screenLight: false } }))).toEqual([]);
  });
});
