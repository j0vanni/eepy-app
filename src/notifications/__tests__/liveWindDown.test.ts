jest.mock('expo-notifications', () => ({ dismissNotificationAsync: jest.fn(() => Promise.resolve()), clearLastNotificationResponse: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { formatTime, MINUTE } from '../../engine/time';
import {
  LIVE_ID,
  LIVE_NOTIFICATION_IDENTIFIER,
  liveWindDown,
  liveWindDownPhase,
  planLiveWindDown,
  shouldDismissLiveWindDown,
} from '../features/liveWindDown';
import { planReminders } from '../features/reminders';
import { dismissPlanned } from '../scheduler';
import { at, scenario, WORKDAY } from './helpers';

const dismiss = Notifications.dismissNotificationAsync as jest.Mock;

describe('live wind-down card', () => {
  beforeEach(() => dismiss.mockClear());

  it('pins a sticky checklist card at wind-down start', () => {
    const ctx = scenario(at(WORKDAY, 8.5));
    const t = ctx.analysis.tonight;
    expect(liveWindDownPhase(ctx.analysis, ctx.state, ctx.now)).toBe('before');
    const [p, ...rest] = planLiveWindDown(ctx);
    expect(rest).toHaveLength(0);
    expect(p).toMatchObject({ id: LIVE_ID, at: t.windDownStart, sticky: true, channel: 'reminders', data: { route: '/winddown' } });
    expect(p.title).toBe(`Wind-down · lights out at ${formatTime(t.bedtime)}`);
    expect(p.body).toContain('☐ Dim the lights');
    expect(p.body).toContain(`Wake-up ${formatTime(t.wake)}`);
  });

  it('is silent (live channel) when the plain wind-down reminder is off', () => {
    const [p] = planLiveWindDown(scenario(at(WORKDAY, 8.5), { prefs: { windDown: false } }));
    expect(p.channel).toBe('live');
  });

  it('during wind-down, schedules its replacement for lights-out instead of the bedtime reminder', () => {
    const ctx = scenario(at(WORKDAY, 8.5), { now: at(WORKDAY, 22.6) });
    const t = ctx.analysis.tonight;
    expect(ctx.now).toBeGreaterThan(t.windDownStart);
    expect(liveWindDownPhase(ctx.analysis, ctx.state, ctx.now)).toBe('during');
    const [p] = planLiveWindDown(ctx);
    // Same id → same Android notification: the pinned card turns into a swipeable "Lights out".
    expect(p).toMatchObject({ id: LIVE_ID, at: t.bedtime, channel: 'reminders', title: `Lights out · ${formatTime(t.bedtime)}` });
    expect(p.sticky).toBeFalsy();
    expect(planReminders(ctx).find((r) => r.id === 'bedtime')).toBeUndefined();
    expect(shouldDismissLiveWindDown(ctx.analysis, ctx.state, ctx.now)).toBe(false);
  });

  it('clears a leftover card after lights-out, when switched off, and before the next wind-down', () => {
    const base = scenario(at(WORKDAY, 8.5));
    const bed = base.analysis.tonight.bedtime;
    const justAfter = scenario(at(WORKDAY, 8.5), { now: bed + 5 * MINUTE });
    expect(planLiveWindDown(justAfter)).toEqual([]);
    expect(shouldDismissLiveWindDown(justAfter.analysis, justAfter.state, justAfter.now)).toBe(false);
    const later = scenario(at(WORKDAY, 8.5), { now: bed + 30 * MINUTE });
    expect(shouldDismissLiveWindDown(later.analysis, later.state, later.now)).toBe(true);

    const off = scenario(at(WORKDAY, 8.5), { now: at(WORKDAY, 22.6), prefs: { liveWindDown: false } });
    expect(planLiveWindDown(off)).toEqual([]);
    liveWindDown.plan(off);
    expect(dismiss).toHaveBeenCalledWith(LIVE_NOTIFICATION_IDENTIFIER);

    dismiss.mockClear();
    liveWindDown.plan(base); // morning: last night's card must not linger
    expect(dismiss).toHaveBeenCalledWith(LIVE_NOTIFICATION_IDENTIFIER);
  });

  it('uses the same identifier as the scheduler', async () => {
    await dismissPlanned('liveWindDown', LIVE_ID);
    expect(dismiss).toHaveBeenCalledWith(LIVE_NOTIFICATION_IDENTIFIER);
  });

  it('skips the card when a nap timer runs through the start of wind-down', () => {
    const napTimer = { start: at(WORKDAY, 21.5), alarmAt: at(WORKDAY, 23), label: 'Recovery nap' };
    const ctx = scenario(at(WORKDAY, 8.5), { now: at(WORKDAY, 21.6), settings: { napTimer } });
    expect(liveWindDownPhase(ctx.analysis, ctx.state, ctx.now)).toBe('off');
    expect(planLiveWindDown(ctx)).toEqual([]);
  });

  it('opens the wind-down screen when tapped', async () => {
    const ctx = scenario(at(WORKDAY, 8.5));
    await liveWindDown.onResponse!({ actionId: 'default', data: { route: '/winddown' } }, ctx.state);
    expect(router.push).toHaveBeenCalledWith('/winddown');
  });
});
