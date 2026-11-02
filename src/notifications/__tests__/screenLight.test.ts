jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

import { analyze } from '../../engine/analysis';
import { formatTime, MINUTE } from '../../engine/time';
import { screenLight } from '../features/screenLight';
import { screensOff } from '../features/screensOff';
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

describe('screens-off reminder', () => {
  it('fires screensOffMin before lights-out and opens the wind-down', () => {
    const ctx = scenario(at(WORKDAY, 12), { prefs: { screensOff: true }, settings: { screensOffMin: 60 } });
    const [n] = screensOff.plan(ctx);
    expect(n).toMatchObject({ at: Math.max(ctx.analysis.tonight.windDownStart, ctx.analysis.tonight.bedtime - 60 * MINUTE), data: { route: '/winddown' } });
    expect(screensOff.plan(scenario(at(WORKDAY, 12), { prefs: { screensOff: false } }))).toEqual([]);
  });

  it('says the e-reader is fine when you read on one', () => {
    const [plain] = screensOff.plan(scenario(at(WORKDAY, 12), { prefs: { screensOff: true } }));
    expect(plain.body).toMatch(/^Send last messages/);
    expect(plain.body).not.toMatch(/e-reader/);

    const warm = scenario(at(WORKDAY, 12), { prefs: { screensOff: true }, settings: { eReader: { enabled: true, warmLight: true } } });
    const [n] = screensOff.plan(warm);
    expect(n.title).toBe('Screens off 📵');
    expect(n.body).toBe(`Phone down — e-reader's fine, frontlight low and warm. Send last messages, check your alarm, then phone on the charger, face down — lights out at ${formatTime(warm.analysis.tonight.bedtime)}.`);

    const [noWarm] = screensOff.plan(scenario(at(WORKDAY, 12), { prefs: { screensOff: true }, settings: { eReader: { enabled: true, warmLight: false } } }));
    expect(noWarm.body).toMatch(/^Phone down — e-reader's fine, frontlight low\. /);
    // Switched off again: back to the plain reminder.
    const [off] = screensOff.plan(scenario(at(WORKDAY, 12), { prefs: { screensOff: true }, settings: { eReader: { enabled: false, warmLight: true } } }));
    expect(off.body).toBe(plain.body);
  });
});
