import { analyze } from '../../engine/analysis';
import { generateDemoData } from '../../engine/demo';
import { createExperiment, TEMPLATE_BY_ID } from '../../engine/experiments';
import { addDays, atMinutes, formatTime, weekdayOfKey } from '../../engine/time';
import { AppState, useStore } from '../../state/store';
import { experiments as experimentsFeature } from '../features/experiments';
import { weeklyReview } from '../features/weeklyReview';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const push = (jest.requireMock('expo-router') as { router: { push: jest.Mock } }).router.push;

function setup(nowDay: string, hour: number) {
  const now = atMinutes(nowDay, hour * 60);
  useStore.getState().resetAll();
  useStore.getState().loadDemo(now);
  const state = useStore.getState();
  const analysis = analyze(state, now);
  return { now, state, analysis };
}

describe('weekly review notification', () => {
  it('plans Sunday 19:00 and opens the review', () => {
    const { now, state, analysis } = setup('2026-10-24', 10); // Saturday
    const planned = weeklyReview.plan({ analysis, state, now, background: false });
    expect(planned).toHaveLength(1);
    expect(weekdayOfKey(analysis.day)).toBe(6);
    expect(planned[0].at).toBe(atMinutes('2026-10-25', 19 * 60));
    expect(planned[0].title).toMatch(/week in sleep is ready/);
    expect(planned[0].data).toEqual({ week: '2026-10-19' });
    weeklyReview.onResponse!({ actionId: 'default', data: { week: '2026-10-19' } }, state);
    expect(push).toHaveBeenCalledWith({ pathname: '/review', params: { week: '2026-10-19' } });
  });

  it('respects the preference', () => {
    const { now, state, analysis } = setup('2026-10-24', 10);
    const off = { ...state, settings: { ...state.settings, notifications: { ...state.settings.notifications, weeklyReview: false } } } as AppState;
    expect(weeklyReview.plan({ analysis, state: off, now, background: false })).toEqual([]);
  });
});

describe('experiment nudges', () => {
  it('reminds of the rule and asks a morning yes/no for self-report rules', () => {
    const { now, analysis } = setup('2026-10-21', 9);
    const e = createExperiment(TEMPLATE_BY_ID['no-screens'], { startDate: addDays(analysis.day, -1), now, id: 'e1' });
    useStore.getState().upsertExperiment(e);
    const state = useStore.getState();
    const planned = experimentsFeature.plan({ analysis, state, now, background: false });
    const rule = planned.find((p) => p.id === `rule-${analysis.day}`)!;
    expect(rule.body).toMatch(/Screens away/);
    expect(rule.at).toBe(analysis.tonight.bedtime - 40 * 60_000);
    expect(rule.title).toMatch(/day 2 of 7/);
    // Today's behaviour is asked about 40 min after tomorrow's wake-up (yesterday's slot this morning has passed).
    expect(planned.find((p) => p.id === `ask-${addDays(analysis.day, -1)}`)).toBeUndefined();
    const ask = planned.find((p) => p.id === `ask-${analysis.day}`)!;
    expect(ask.categoryId).toBe('experiment-adherence');
    expect(ask.body).toBe('Did you keep screens away for the last 30 minutes before bed?');
    expect(formatTime(ask.at)).toBe(formatTime(analysis.tonight.wake + 40 * 60_000));

    // Answering from the notification stores the adherence.
    experimentsFeature.onResponse!({ actionId: 'yes', data: { experimentId: 'e1', date: analysis.day } }, state);
    expect(useStore.getState().experiments.find((x) => x.id === 'e1')!.adherence[analysis.day]).toBe(true);
    // …and an answered day isn't asked again.
    const again = experimentsFeature.plan({ analysis, state: useStore.getState(), now, background: false });
    expect(again.find((p) => p.id === `ask-${analysis.day}`)).toBeUndefined();
  });

  it('respects the preference', () => {
    const { now, analysis } = setup('2026-10-21', 9);
    useStore.getState().upsertExperiment(createExperiment(TEMPLATE_BY_ID['no-screens'], { startDate: analysis.day, now }));
    useStore.getState().setNotificationPrefs({ experimentNudges: false });
    expect(experimentsFeature.plan({ analysis, state: useStore.getState(), now, background: false })).toEqual([]);
  });
});
