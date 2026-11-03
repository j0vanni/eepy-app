/**
 * The sleep session in notifications: "I'm in bed" on the wind-down / lights-out notifications opens
 * eepy at the one-tap sheet, the planners keep tonight's evening reminders quiet while you're in
 * bed, and the watch buzz's "I'm up" hands over to the check-in, which ends the session.
 */
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  clearLastNotificationResponse: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { closeInBed, InBedSession } from '../../engine/inBed';
import { HOUR, MINUTE } from '../../engine/time';
import type { AppState } from '../../state/store';
import { liveWindDown, liveWindDownPhase, planLiveWindDown, shouldDismissLiveWindDown } from '../features/liveWindDown';
import { planReminders, reminders, WRIST_WAKE_KIND } from '../features/reminders';
import { screenLight } from '../features/screenLight';
import { screensOff } from '../features/screensOff';
import { eveningNotificationIds, IN_BED_ACTION, IN_BED_LINK, plannedId, RUNNING_LATE_ACTION, RUNNING_LATE_CATEGORY } from '../ids';
import { handleNotificationResponse } from '../scheduler';
import { at, scenario, WORKDAY } from './helpers';

const push = router.push as jest.Mock;

/** The same context with a sleep session in the settings. */
function withSession<T extends { state: AppState }>(ctx: T, session: InBedSession | undefined): T {
  return { ...ctx, state: { ...ctx.state, settings: { ...ctx.state.settings, session } } };
}

beforeEach(() => push.mockClear());

describe('"I\'m in bed" on the wind-down and lights-out notifications', () => {
  it('is a button next to "Running late" (wind-down, lights-out and the live card share it)', () => {
    const cat = reminders.categories!.find((c) => c.id === RUNNING_LATE_CATEGORY)!;
    expect(cat.actions.map((x) => [x.id, x.title])).toEqual([
      [IN_BED_ACTION, "I'm in bed"],
      [RUNNING_LATE_ACTION, 'Running late'],
    ]);
    const ctx = scenario(at(WORKDAY, 8.5), { prefs: { liveWindDown: false } });
    for (const p of planReminders(ctx).filter((x) => x.id === 'winddown' || x.id === 'bedtime')) expect(p.categoryId).toBe(RUNNING_LATE_CATEGORY);
    expect(planLiveWindDown(scenario(at(WORKDAY, 8.5)))[0].categoryId).toBe(RUNNING_LATE_CATEGORY);
  });

  it('opens eepy and starts the session there (the one-tap sheet), from either feature', async () => {
    const { state } = scenario(at(WORKDAY, 22));
    await reminders.onResponse!({ actionId: IN_BED_ACTION, data: {} }, state);
    expect(push).toHaveBeenLastCalledWith(IN_BED_LINK);
    await liveWindDown.onResponse!({ actionId: IN_BED_ACTION, data: { route: '/winddown' } }, state);
    expect(push).toHaveBeenLastCalledWith(IN_BED_LINK);
    expect(IN_BED_LINK).toBe('/quick/inbed');
    // "Running late" still opens Adjust tonight.
    await liveWindDown.onResponse!({ actionId: RUNNING_LATE_ACTION, data: {} }, state);
    expect(push).toHaveBeenLastCalledWith('/tonight');
  });

  it('is routed to the feature that posted it', async () => {
    const { state } = scenario(at(WORKDAY, 22));
    const response = (feature: string) =>
      ({ actionIdentifier: IN_BED_ACTION, notification: { request: { content: { data: { feature } } } } }) as unknown as Notifications.NotificationResponse;
    await handleNotificationResponse(response('liveWindDown'), state);
    expect(push).toHaveBeenLastCalledWith(IN_BED_LINK);
    push.mockClear();
    await handleNotificationResponse(response('reminders'), state);
    expect(push).toHaveBeenCalledWith(IN_BED_LINK);
  });
});

describe('while you are in bed', () => {
  const evening = scenario(at(WORKDAY, 21.5), { prefs: { liveWindDown: false, screensOff: true, screenLight: true } });
  const t = evening.analysis.tonight;
  const session: InBedSession = { inBedAt: t.windDownStart + 5 * MINUTE, wakeDate: t.wakeDate, wakeAt: t.wake, retimed: false };
  const ids = (ctx: typeof evening) => planReminders(ctx).map((p) => p.id);

  it("tonight's wind-down, lights-out, screens-off and phone-light reminders stay quiet", () => {
    expect(ids(evening)).toEqual(expect.arrayContaining(['winddown', 'bedtime']));
    const inBed = withSession(evening, session);
    expect(ids(inBed)).not.toContain('winddown');
    expect(ids(inBed)).not.toContain('bedtime');
    // The morning ones stay.
    expect(ids(inBed)).toContain('checkin');
    expect(screensOff.plan(inBed)).toEqual([]);
    expect(screenLight.plan(inBed)).toEqual([]);
    expect(screensOff.plan(evening).length + screenLight.plan(evening).length).toBeGreaterThan(0);
  });

  it('the live card goes (and a pinned one is cleared), during wind-down too', () => {
    const live = scenario(t.windDownStart + 10 * MINUTE);
    expect(liveWindDownPhase(live.analysis, live.state, live.now)).toBe('during');
    const inBed = withSession(live, { ...session, wakeDate: live.analysis.tonight.wakeDate });
    expect(liveWindDownPhase(inBed.analysis, inBed.state, inBed.now)).toBe('off');
    expect(planLiveWindDown(inBed)).toEqual([]);
    expect(shouldDismissLiveWindDown(inBed.analysis, inBed.state, inBed.now)).toBe(true);
    // …and nothing else steps in for the "Lights out" it carried.
    expect(planReminders(inBed).map((p) => p.id)).not.toContain('bedtime');
  });

  it("only for that night's open session", () => {
    expect(ids(withSession(evening, { ...session, wakeDate: '2026-10-30' }))).toContain('bedtime');
    expect(ids(withSession(evening, closeInBed(session, session.inBedAt + HOUR, 'up')))).toContain('bedtime');
  });

  it('the notifications already on screen are the ones "I\'m in bed" clears', () => {
    expect(eveningNotificationIds(t.wakeDate)).toEqual([
      plannedId('liveWindDown', 'live'),
      plannedId('reminders', 'winddown'),
      plannedId('reminders', 'bedtime'),
      plannedId('screensOff', t.wakeDate),
      plannedId('screenLight', t.wakeDate),
      plannedId('rundown', `${t.wakeDate}-soon`),
    ]);
    // …and the bedtime rundown's step reminders you switched on.
    expect(eveningNotificationIds(t.wakeDate, ['shower'])).toContain(plannedId('rundown', `${t.wakeDate}-shower`));
  });
});

describe('"I\'m up" on the watch buzz', () => {
  it('opens the check-in, which ends the session; the routine buzz opens Today', async () => {
    const { state } = scenario(at(WORKDAY, 7));
    const base = Date.now() - 5 * MINUTE;
    await reminders.onResponse!({ actionId: 'wrist-up', data: { kind: WRIST_WAKE_KIND, base } }, state);
    expect(push).toHaveBeenLastCalledWith({ pathname: '/checkin', params: { up: 'watch' } });
    await reminders.onResponse!({ actionId: 'wrist-up', data: { kind: WRIST_WAKE_KIND, base, routine: true } }, state);
    expect(push).toHaveBeenLastCalledWith('/');
  });
});
