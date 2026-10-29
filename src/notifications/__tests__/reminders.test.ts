jest.mock('expo-notifications', () => ({ dismissNotificationAsync: jest.fn(() => Promise.resolve()), clearLastNotificationResponse: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

import { router } from 'expo-router';

import { formatTime, MINUTE, startOfDateKey } from '../../engine/time';
import type { SleepDataset } from '../../engine/types';
import { MAX_NAP_SHIFT_MIN } from '../features/dayContext';
import { capPerDay, DAILY_REMINDER_CAP, NAP_NUDGE_MIN_NEED, planReminders, reminders } from '../features/reminders';
import type { PlannedNotification } from '../types';
import { at, scenario, WORKDAY } from './helpers';

const ids = (ps: PlannedNotification[]) => ps.map((p) => p.id).sort();
const byId = (ps: PlannedNotification[], id: string) => ps.find((p) => p.id === id);

const noCaffeineToday = (d: SleepDataset): SleepDataset => ({ ...d, caffeine: d.caffeine.filter((c) => c.time < startOfDateKey(WORKDAY)) });
const withNap = (startH: number, min: number) => (d: SleepDataset): SleepDataset => {
  const start = at(WORKDAY, startH);
  return {
    ...d,
    sessions: [
      ...d.sessions,
      {
        id: 'nap-today',
        source: 'manual',
        kind: 'nap',
        start,
        end: start + min * MINUTE,
        stages: [
          { stage: 'awake', start, end: start + 5 * MINUTE },
          { stage: 'light', start: start + 5 * MINUTE, end: start + min * MINUTE },
        ],
      },
    ],
  };
};

describe('reminders (non-adaptive)', () => {
  it('keeps the classic reminders and copy', () => {
    const ctx = scenario(at(WORKDAY, 8.5), { prefs: { adaptiveReminders: false, liveWindDown: false, caffeine: true }, edit: noCaffeineToday });
    const planned = planReminders(ctx);
    expect(ids(planned)).toEqual(['bedtime', 'caffeine', 'checkin', 'winddown']);
    const a = ctx.analysis;
    expect(byId(planned, 'winddown')).toMatchObject({ at: a.tonight.windDownStart, body: `Dim the lights and put screens away — lights out at ${formatTime(a.tonight.bedtime)}.` });
    expect(byId(planned, 'bedtime')!.at).toBe(a.tonight.bedtime);
    expect(byId(planned, 'bedtime')!.body).toMatch(/^Going to sleep now gets you/);
  });

  it('adds the cycle-timed wake alarm when enabled', () => {
    const planned = planReminders(scenario(at(WORKDAY, 8.5), { prefs: { smartAlarm: true } }));
    expect(byId(planned, 'wake')).toMatchObject({ channel: 'wake', sound: 'wake.wav', alarm: true });
  });
});

describe('adaptive reminders', () => {
  it('nudges at the start of the nap window when nap need is high', () => {
    const ctx = scenario(at(WORKDAY, 8.5));
    const nap = ctx.analysis.nap;
    expect(nap.verdict).toBe('nap-later');
    expect(nap.needScore).toBeGreaterThanOrEqual(NAP_NUDGE_MIN_NEED);
    const p = byId(planReminders(ctx), 'nap');
    expect(p).toMatchObject({ at: nap.window!.start, channel: 'reminders', data: { route: '/nap' } });
    expect(p!.body).toContain(`best before ${formatTime(nap.window!.end)}`);
    // Not without the adaptive setting.
    expect(byId(planReminders(scenario(at(WORKDAY, 8.5), { prefs: { adaptiveReminders: false } })), 'nap')).toBeUndefined();
  });

  it('sends the caffeine last call only on days you logged caffeine', () => {
    const prefs = { caffeine: true };
    const withCoffee = scenario(at(WORKDAY, 8.5), { prefs });
    const p = byId(planReminders(withCoffee), 'caffeine');
    expect(p).toBeDefined();
    expect(p!.body).toMatch(/You've had 95 mg today/);
    expect(byId(planReminders(scenario(at(WORKDAY, 8.5), { prefs, edit: noCaffeineToday })), 'caffeine')).toBeUndefined();
  });

  it('lets the live wind-down card replace the plain wind-down reminder', () => {
    expect(byId(planReminders(scenario(at(WORKDAY, 8.5))), 'winddown')).toBeUndefined();
    expect(byId(planReminders(scenario(at(WORKDAY, 8.5), { prefs: { liveWindDown: false } })), 'winddown')).toBeDefined();
  });

  it('stays quiet while a nap timer runs past wind-down and bedtime', () => {
    const napTimer = { start: at(WORKDAY, 22), alarmAt: at(WORKDAY, 23.5), label: 'Recovery nap' };
    const prefs = { liveWindDown: false };
    const napping = planReminders(scenario(at(WORKDAY, 8.5), { now: at(WORKDAY, 21.9), prefs, settings: { napTimer } }));
    expect(byId(napping, 'winddown')).toBeUndefined();
    expect(byId(napping, 'bedtime')).toBeUndefined();
    const awake = planReminders(scenario(at(WORKDAY, 8.5), { now: at(WORKDAY, 21.9), prefs }));
    expect(byId(awake, 'winddown')).toBeDefined();
    expect(byId(awake, 'bedtime')).toBeDefined();
  });

  it('moves lights-out later after a long nap, and says why', () => {
    const ctx = scenario(at(WORKDAY, 8.5), { now: at(WORKDAY, 17), edit: withNap(14, 60) });
    const bed = byId(planReminders(ctx), 'bedtime')!;
    const bedtime = ctx.analysis.tonight.bedtime;
    expect(bed.at).toBeGreaterThan(bedtime);
    expect(bed.at).toBeLessThanOrEqual(bedtime + MAX_NAP_SHIFT_MIN * MINUTE);
    expect(bed.body).toMatch(/nap pushed sleepiness back/);
    expect(bed.body).toContain(formatTime(bed.at));
    // A short nap barely changes sleep pressure: lights-out stays put.
    const short = scenario(at(WORKDAY, 8.5), { now: at(WORKDAY, 17), edit: withNap(14, 25) });
    expect(byId(planReminders(short), 'bedtime')!.at).toBe(short.analysis.tonight.bedtime);
  });

  it('mentions late caffeine and high debt', () => {
    const late = scenario(at(WORKDAY, 8.5), {
      now: at(WORKDAY, 19),
      edit: (d) => ({ ...d, caffeine: [...d.caffeine, { id: 'late', time: at(WORKDAY, 18), mg: 200, label: 'Energy drink' }] }),
    });
    expect(byId(planReminders(late), 'bedtime')!.body).toMatch(/mg of caffeine is still around/);

    const tired = scenario(at(WORKDAY, 8.5));
    expect(['high', 'severe']).toContain(tired.analysis.debt.category);
    expect(byId(planReminders(tired), 'bedtime')!.body).toMatch(/toward your .* sleep debt/);
  });

  it('caps reminders per day, dropping the least important first', () => {
    const base = { channel: 'reminders' as const, title: '', body: '' };
    const day = at(WORKDAY, 0);
    const list: PlannedNotification[] = ['caffeine', 'checkin', 'nap', 'winddown', 'bedtime', 'extra1', 'extra2'].map((id, i) => ({ ...base, id, at: day + (10 + i) * 3600_000 }));
    const kept = capPerDay(list, DAILY_REMINDER_CAP);
    expect(kept).toHaveLength(DAILY_REMINDER_CAP);
    expect(ids(kept)).toEqual(['bedtime', 'caffeine', 'checkin', 'nap', 'winddown']);
    expect(capPerDay(list, 3).map((p) => p.id)).toEqual(['nap', 'winddown', 'bedtime']);
  });

  it('keeps a normal day within the budget', () => {
    const planned = planReminders(scenario(at(WORKDAY, 8.5), { prefs: { caffeine: true, liveWindDown: false } }));
    const perDay = new Map<string, number>();
    for (const p of planned) {
      const k = new Date(p.at - 4 * 3600_000).toDateString();
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(DAILY_REMINDER_CAP);
  });

  it('routes taps to the right screen', async () => {
    const ctx = scenario(at(WORKDAY, 8.5));
    await reminders.onResponse!({ actionId: 'default', data: { route: '/nap' } }, ctx.state);
    expect(router.push).toHaveBeenLastCalledWith('/nap');
    (router.push as jest.Mock).mockClear();
    await reminders.onResponse!({ actionId: 'default', data: { route: '/somewhere-else' } }, ctx.state);
    expect(router.push).not.toHaveBeenCalled();
  });
});
