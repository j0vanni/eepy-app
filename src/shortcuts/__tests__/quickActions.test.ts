import { usualDoseId } from '../../engine/caffeineHabits';
import type { NapOption } from '../../engine/nap';
import { addDays, atMinutes, MINUTE } from '../../engine/time';
import type { CaffeineDose } from '../../engine/types';
import { anotherDose, APP_SHORTCUTS, decideQuickAction, parseQuickAction, planQuickCoffee, quickLink, type QuickInput } from '../quickActions';

const TODAY = '2026-10-21';
const COFFEE = 'Coffee (8 oz / 240 ml)';
const at = (day: string, h: number) => atMinutes(day, h * 60);

/** Six mornings of a 07:30 coffee before today. */
function history(): CaffeineDose[] {
  return [1, 2, 3, 4, 5, 6].map((d) => ({ id: `c-${d}`, time: at(addDays(TODAY, -d), 7.5), mg: 95, label: COFFEE }));
}

describe('parseQuickAction', () => {
  it('reads the route param, tolerating case, spaces, arrays and aliases', () => {
    expect(parseQuickAction('coffee')).toBe('coffee');
    expect(parseQuickAction(['nap', 'x'])).toBe('nap');
    expect(parseQuickAction(' Running-Late ')).toBe('late');
    expect(parseQuickAction('tonight')).toBe('late');
    expect(parseQuickAction('check-in')).toBe('checkin');
    expect(parseQuickAction('sounds')).toBe('sounds');
    expect(parseQuickAction('')).toBeUndefined();
    expect(parseQuickAction('bogus')).toBeUndefined();
    expect(parseQuickAction(undefined)).toBeUndefined();
    expect(parseQuickAction([])).toBeUndefined();
  });

  it('round-trips every shortcut link', () => {
    for (const s of APP_SHORTCUTS) {
      expect(s.link).toBe(quickLink(parseQuickAction(s.link.replace('eepy://quick/', ''))!));
    }
  });
});

describe('app-icon shortcuts', () => {
  it('are the four one-tap actions, each on its own eepy:// link', () => {
    expect(APP_SHORTCUTS.map((s) => s.longLabel)).toEqual(['Log my usual coffee', 'Start a nap', 'Running late', 'Check in']);
    expect(APP_SHORTCUTS.map((s) => s.link)).toEqual(['eepy://quick/coffee', 'eepy://quick/nap', 'eepy://quick/late', 'eepy://quick/checkin']);
    expect(new Set(APP_SHORTCUTS.map((s) => s.id)).size).toBe(APP_SHORTCUTS.length);
    // Launchers truncate long short labels.
    for (const s of APP_SHORTCUTS) expect(s.shortLabel.length).toBeLessThanOrEqual(12);
  });
});

describe('planQuickCoffee', () => {
  it('opens the drink editor until there is a usual drink', () => {
    expect(planQuickCoffee([], at(TODAY, 10))).toEqual({ kind: 'no-usual' });
    expect(planQuickCoffee(history().slice(0, 2), at(TODAY, 10))).toEqual({ kind: 'no-usual' });
  });

  it('logs the usual drink at its usual time, with the per-day usual id', () => {
    const plan = planQuickCoffee(history(), at(TODAY, 10));
    expect(plan).toMatchObject({ kind: 'log', dose: { id: usualDoseId(TODAY), time: at(TODAY, 7.5), mg: 95, label: COFFEE } });
  });

  it('never logs it in the future', () => {
    const now = at(TODAY, 6);
    const plan = planQuickCoffee(history(), now);
    expect(plan).toMatchObject({ kind: 'log', dose: { time: now } });
  });

  it("can't log the usual twice", () => {
    const doses = [...history(), { id: usualDoseId(TODAY), time: at(TODAY, 7.5), mg: 95, label: COFFEE }];
    expect(planQuickCoffee(doses, at(TODAY, 10))).toMatchObject({ kind: 'already', dose: { id: usualDoseId(TODAY) } });
  });

  it('counts the same drink logged by hand around the usual time as the usual', () => {
    const doses = [...history(), { id: 'c-manual', time: at(TODAY, 8.25), mg: 95, label: COFFEE }];
    expect(planQuickCoffee(doses, at(TODAY, 10))).toMatchObject({ kind: 'already', dose: { id: 'c-manual' } });
  });

  it('still logs the usual when only something else was logged today', () => {
    const doses = [...history(), { id: 'c-tea', time: at(TODAY, 15), mg: 47, label: 'Black tea' }];
    expect(planQuickCoffee(doses, at(TODAY, 16))).toMatchObject({ kind: 'log', dose: { id: usualDoseId(TODAY) } });
  });

  it('"Log another now" gets a fresh id at the current time', () => {
    const now = at(TODAY, 11);
    expect(anotherDose({ mg: 95, label: COFFEE }, now)).toEqual({ id: `c-${now}-95`, time: now, mg: 95, label: COFFEE });
  });
});

describe('decideQuickAction', () => {
  const nap: NapOption = {
    type: 'power',
    label: 'Power nap',
    sleepMin: 20,
    alarmAfterMin: 25,
    start: at(TODAY, 14),
    description: '',
    bedtimeDelayMin: 0,
    energyGain: 6,
    suitable: true,
  };
  const base: QuickInput = { onboarded: true, caffeine: history(), napRunning: false, nap: { best: nap, headline: 'A short nap would help.' } };
  const now = at(TODAY, 13);

  it('sends you to onboarding first', () => {
    expect(decideQuickAction('coffee', { ...base, onboarded: false }, now)).toEqual({ redirect: '/onboarding' });
  });

  it('logs coffee, or opens the drink editor without a usual', () => {
    expect(decideQuickAction('coffee', base, now)).toMatchObject({ sheet: 'coffee-logged', dose: { id: usualDoseId(TODAY) } });
    expect(decideQuickAction('coffee', { ...base, caffeine: [] }, now)).toEqual({ redirect: '/caffeine' });
    const logged = [...history(), { id: usualDoseId(TODAY), time: at(TODAY, 7.5), mg: 95, label: COFFEE }];
    expect(decideQuickAction('coffee', { ...base, caffeine: logged }, now)).toMatchObject({ sheet: 'coffee-already' });
  });

  it('offers the recommended nap, else opens the Nap coach', () => {
    expect(decideQuickAction('nap', base, now)).toEqual({ sheet: 'nap', option: nap, headline: 'A short nap would help.' });
    expect(decideQuickAction('nap', { ...base, napRunning: true }, now)).toEqual({ redirect: '/nap' });
    expect(decideQuickAction('nap', { ...base, nap: { best: { ...nap, suitable: false }, headline: '' } }, now)).toEqual({ redirect: '/nap' });
    expect(decideQuickAction('nap', { ...base, nap: undefined }, now)).toEqual({ redirect: '/nap' });
  });

  it('routes the rest', () => {
    expect(decideQuickAction('late', base, now)).toEqual({ redirect: '/tonight' });
    expect(decideQuickAction('checkin', base, now)).toEqual({ redirect: '/checkin' });
    expect(decideQuickAction('sounds', base, now)).toEqual({ sheet: 'sounds' });
    expect(decideQuickAction(undefined, base, now)).toEqual({ redirect: '/' });
  });

  it('is decided at the time of the tap', () => {
    // 06:00, before the usual 07:30: logged "now", not in the future.
    const early = at(TODAY, 6);
    expect(decideQuickAction('coffee', base, early)).toMatchObject({ dose: { time: early } });
    expect(early + 90 * MINUTE).toBe(at(TODAY, 7.5));
  });
});
