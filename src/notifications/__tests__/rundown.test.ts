/**
 * The bedtime rundown's reminders: "Phone down in 10 min", the screens-off reminder at the rundown's
 * phone-down (with what's next), lights-out as "Reading time's up", the live card's copy, per-step
 * reminders, and staying quiet in bed, during a nap and for steps the player has done.
 */
jest.mock('expo-notifications', () => ({ dismissNotificationAsync: jest.fn(() => Promise.resolve()), clearLastNotificationResponse: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

import { router } from 'expo-router';

import type { InBedSession } from '../../engine/inBed';
import { DEFAULT_RUNDOWN, markRundownStep, phoneDownAt, rundownFor, setRundownReminder, startRundownProgress } from '../../engine/rundown';
import { formatTime, MINUTE } from '../../engine/time';
import type { Settings } from '../../state/store';
import { liveWindDownPhase, planLiveWindDown } from '../features/liveWindDown';
import { planReminders } from '../features/reminders';
import { BY_STEP_LEAD_MIN, rundown } from '../features/rundown';
import { screensOff } from '../features/screensOff';
import { eveningNotificationIds, plannedId } from '../ids';
import { at, RUNDOWN_ON, scenario, WORKDAY } from './helpers';

const noon = at(WORKDAY, 12);
const on = (settings: Partial<Settings> = {}, prefs = {}) => scenario(noon, { settings: { rundown: RUNDOWN_ON, ...settings }, prefs });

describe('phone-down reminder with the bedtime rundown', () => {
  it("fires at the rundown's phone-down and says what's next", () => {
    const ctx = on();
    const t = ctx.analysis.tonight;
    const [n] = screensOff.plan(ctx);
    expect(n.at).toBe(t.bedtime - 45 * MINUTE);
    expect(n.at).toBe(phoneDownAt(t, ctx.state.settings));
    expect(n).toMatchObject({ title: 'Phone down 📵', data: { route: '/winddown' } });
    expect(n.body).toBe(`Charger across the room, face down. Next: teeth & skin care, 30 min of reading and relaxing in bed. Lights out at ${formatTime(t.bedtime)}.`);
  });

  it('moves with reading time and mentions the e-reader', () => {
    const short = on({ rundown: { ...RUNDOWN_ON, readingMin: 15 } });
    expect(screensOff.plan(short)[0].at).toBe(short.analysis.tonight.bedtime - 30 * MINUTE);
    const none = on({ rundown: { ...RUNDOWN_ON, readingMin: 0 } });
    expect(screensOff.plan(none)[0].body).toMatch(/Next: teeth & skin care and relaxing in bed\./);
    const [e] = screensOff.plan(on({ eReader: { enabled: true, warmLight: true } }));
    expect(e.body).toMatch(/^Charger across the room, face down — e-reader's fine, frontlight low and warm\. Next: teeth & skin care, 30 min of reading/);
  });

  it('keeps the screens-off setting as the fallback with the rundown off', () => {
    const ctx = scenario(noon, { settings: { screensOffMin: 30 } });
    const [n] = screensOff.plan(ctx);
    expect(n.at).toBe(ctx.analysis.tonight.bedtime - 30 * MINUTE);
    expect(n.title).toBe('Screens off 📵');
  });
});

describe('"Phone down in 10 min"', () => {
  it('comes 10 min before phone-down, with last messages and the alarm check', () => {
    const ctx = on();
    const t = ctx.analysis.tonight;
    const down = t.bedtime - 45 * MINUTE;
    const [n] = rundown.plan(ctx);
    expect(n).toMatchObject({ id: `${t.wakeDate}-soon`, at: down - 10 * MINUTE, channel: 'reminders', title: 'Phone down in 10 min', data: { route: '/winddown' } });
    expect(n.body).toBe(`Send last messages and check your alarm — at ${formatTime(down)} the phone goes on the charger, then teeth & skin care, 30 min of reading and relaxing in bed.`);
    expect(rundown.plan(on({}, { phoneDownSoon: false }))).toEqual([]);
  });

  it('works with the rundown off too, but never before wind-down starts', () => {
    const ctx = scenario(noon, { settings: { screensOffMin: 30 } });
    const t = ctx.analysis.tonight;
    const [n] = rundown.plan(ctx);
    expect(n.at).toBe(t.bedtime - 40 * MINUTE);
    expect(n.body).toBe(`Send last messages and check your alarm — screens off at ${formatTime(t.bedtime - 30 * MINUTE)}, lights out at ${formatTime(t.bedtime)}.`);
    // Screens off right at the start of wind-down: no heads-up before it.
    expect(rundown.plan(scenario(noon, { settings: { screensOffMin: 60 } }))).toEqual([]);
  });
});

describe('lights-out with reading time', () => {
  it('the bedtime reminder becomes "Reading time\'s up" (one notification, not two)', () => {
    const prefs = { liveWindDown: false, adaptiveReminders: false };
    const t = on().analysis.tonight;
    const bedtime = planReminders(on({}, prefs)).filter((p) => p.at === t.bedtime);
    expect(bedtime).toHaveLength(1);
    expect(bedtime[0]).toMatchObject({ id: 'bedtime', title: "Reading time's up — lights out" });
    expect(bedtime[0].body).toMatch(/^Book down, light off\. Going to sleep now gets you/);
    const e = planReminders(on({ eReader: { enabled: true, warmLight: true } }, prefs)).find((p) => p.id === 'bedtime')!;
    expect(e.body).toMatch(/^E-reader down, light off\./);
    // No reading tonight, or the rundown off: the plain "Lights out".
    expect(planReminders(on({ rundown: { ...RUNDOWN_ON, readingMin: 0 } }, prefs)).find((p) => p.id === 'bedtime')!.title).toBe('Lights out');
    expect(planReminders(scenario(noon, { prefs })).find((p) => p.id === 'bedtime')!.title).toBe('Lights out');
    // The wind-down reminder names the rundown's phone-down.
    expect(planReminders(on({}, prefs)).find((p) => p.id === 'winddown')!.body).toBe(
      `Your bedtime rundown starts — phone down at ${formatTime(t.bedtime - 45 * MINUTE)}, lights out at ${formatTime(t.bedtime)}.`,
    );
  });

  it('the live wind-down card: phone-down on its checklist, then "Reading time\'s up"', () => {
    const before = on({ eReader: { enabled: true, warmLight: true } });
    const t = before.analysis.tonight;
    const [card] = planLiveWindDown(before);
    expect(card.body).toContain(`☐ Phone down at ${formatTime(t.bedtime - 45 * MINUTE)}, then read 30 min`);
    expect(card.body).not.toContain('Screens away');
    const during = scenario(noon, { now: t.windDownStart + 10 * MINUTE, settings: { rundown: RUNDOWN_ON, eReader: { enabled: true, warmLight: true } } });
    expect(liveWindDownPhase(during.analysis, during.state, during.now)).toBe('during');
    const [lights] = planLiveWindDown(during);
    expect(lights.title).toBe(`Reading time's up · lights out ${formatTime(during.analysis.tonight.bedtime)}`);
    expect(lights.body).toMatch(/^Reading time's up\. E-reader down, light off\. Lights out now gives you/);
    // …and it carries the bedtime reminder: nothing else at lights-out.
    expect(planReminders(during).find((p) => p.id === 'bedtime')).toBeUndefined();
  });
});

describe('per-step reminders', () => {
  it('are off by default; a "by" step comes 15 min early, anything else when it starts', () => {
    const remind = setRundownReminder(setRundownReminder(RUNDOWN_ON, 'shower', true), 'meal', true);
    const ctx = on({ rundown: remind, eReader: { enabled: true, warmLight: true } });
    const t = ctx.analysis.tonight;
    const planned = rundown.plan(ctx);
    expect(planned.map((p) => p.id).sort()).toEqual([`${t.wakeDate}-meal`, `${t.wakeDate}-shower`, `${t.wakeDate}-soon`].sort());
    expect(planned.find((p) => p.id.endsWith('-meal'))).toMatchObject({ at: t.lastMeal - BY_STEP_LEAD_MIN * MINUTE, title: `Last big meal by ${formatTime(t.lastMeal)}` });
    const shower = planned.find((p) => p.id.endsWith('-shower'))!;
    expect(shower).toMatchObject({ at: t.bedtime - 90 * MINUTE, title: 'Warm shower or bath' });
    expect(shower.body).toBe('A warm shower or bath (15 min) draws heat to your skin, so your core cools faster afterwards — the same drop that starts sleep.');
    // "I'm in bed" clears every one of them.
    const cleared = eveningNotificationIds(t.wakeDate, remind.remind);
    for (const p of planned) expect(cleared).toContain(plannedId('rundown', p.id));
  });
});

describe('quiet when they would be noise', () => {
  it("once you're in bed", () => {
    const ctx = on({ rundown: setRundownReminder(RUNDOWN_ON, 'shower', true) });
    const t = ctx.analysis.tonight;
    const session: InBedSession = { inBedAt: t.windDownStart, wakeDate: t.wakeDate, wakeAt: t.wake, retimed: false };
    const inBed = { ...ctx, state: { ...ctx.state, settings: { ...ctx.state.settings, session } } };
    expect(rundown.plan(inBed)).toEqual([]);
    expect(screensOff.plan(inBed)).toEqual([]);
  });

  it('during a nap timer (adaptive reminders)', () => {
    const t = on().analysis.tonight;
    const down = t.bedtime - 45 * MINUTE;
    const napTimer = { start: down - 30 * MINUTE, alarmAt: down + 5 * MINUTE, label: 'Nap' };
    const napping = on({ napTimer });
    expect(screensOff.plan(napping)).toEqual([]);
    expect(rundown.plan(napping)).toEqual([]);
    // Not adaptive: as before.
    expect(screensOff.plan(on({ napTimer }, { adaptiveReminders: false }))).toHaveLength(1);
  });

  it('for steps the guided player has already done', () => {
    const ctx = on({ rundown: setRundownReminder(RUNDOWN_ON, 'tomorrow', true) });
    const t = ctx.analysis.tonight;
    const r = rundownFor(ctx.analysis, ctx.state)!;
    let p = startRundownProgress(r, t.windDownStart - 5 * MINUTE);
    p = markRundownStep(p, 'tomorrow', 'done', t.windDownStart);
    const started = { ...ctx, state: { ...ctx.state, settings: { ...ctx.state.settings, rundownProgress: p } } };
    expect(rundown.plan(started).map((x) => x.id)).toEqual([`${t.wakeDate}-soon`]);
    for (const id of ['todo-list', 'bedroom', 'alarm', 'phone-down']) p = markRundownStep(p, id, 'done', t.windDownStart + 10 * MINUTE);
    const down = { ...ctx, state: { ...ctx.state, settings: { ...ctx.state.settings, rundownProgress: p } } };
    expect(rundown.plan(down)).toEqual([]);
    expect(screensOff.plan(down)).toEqual([]);
    // Last night's progress doesn't count.
    const stale = { ...ctx, state: { ...ctx.state, settings: { ...ctx.state.settings, rundownProgress: { ...p, wakeDate: '2026-10-20' } } } };
    expect(screensOff.plan(stale)).toHaveLength(1);
  });
});

it('a tap opens the wind-down screen', async () => {
  await rundown.onResponse!({ actionId: 'default', data: { route: '/winddown' } }, on().state);
  expect(router.push).toHaveBeenCalledWith('/winddown');
  expect(DEFAULT_RUNDOWN.remind).toEqual([]);
});
