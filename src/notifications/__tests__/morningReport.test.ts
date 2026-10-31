jest.mock('expo-notifications', () => ({ dismissNotificationAsync: jest.fn(() => Promise.resolve()), clearLastNotificationResponse: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

import { router } from 'expo-router';
import { AppState as RNAppState } from 'react-native';

import { formatTime } from '../../engine/time';
import { morningReport, planMorningReport, REPORT_MARK, reportDeadline } from '../features/morningReport';
import { at, scenario, WORKDAY } from './helpers';

describe('morning report', () => {
  it('reports last night once it has synced, between wake-up and noon', () => {
    const ctx = scenario(at(WORKDAY, 8.5));
    const a = ctx.analysis;
    expect(a.lastNightIsCurrent).toBe(true);
    const [p, ...rest] = planMorningReport(ctx);
    expect(rest).toHaveLength(0);
    expect(p).toMatchObject({ id: `report-${WORKDAY}`, immediate: true, channel: 'reports', data: { nightId: a.lastNight!.main!.id, wakeDate: WORKDAY } });
    // "Last night: 5h 51m · score 61 · debt 6h ▲"
    expect(p.title).toMatch(/^Last night: \d+h \d\dm · score \d+ · (no debt|debt [\d.]+[hm]( [▲▼])?)$/);
    expect(p.title).toContain(`score ${a.scores[a.lastNight!.main!.id].total}`);
    // The night story's one-liner first, then today's plan.
    const [storyLine, today] = p.body.split('\n');
    expect(storyLine).toBe(a.lastNightStory!.oneLiner);
    expect(today).toMatch(/^Today: /);
    expect(p.body).toContain(`lights out ${formatTime(a.tonight.bedtime)}`);
    expect(a.nap.verdict).toBe('nap-later');
    expect(p.body).toContain(`Nap window ${formatTime(a.nap.window!.start)}–${formatTime(a.nap.window!.end)}`);
  });

  it('is sent only once per night', () => {
    const ctx = scenario(at(WORKDAY, 8.5), { settings: { marks: { [REPORT_MARK]: WORKDAY } } });
    expect(planMorningReport(ctx)).toEqual([]);
  });

  it('respects the setting', () => {
    expect(planMorningReport(scenario(at(WORKDAY, 8.5), { prefs: { morningReport: false } }))).toEqual([]);
  });

  it('stays quiet after noon and when last night is missing', () => {
    expect(planMorningReport(scenario(at(WORKDAY, 8.5), { now: at(WORKDAY, 12.5) }))).toEqual([]);
    // Saturday 09:00: the demo free-day night hasn't ended yet.
    const missing = scenario(at('2026-10-24', 9));
    expect(missing.analysis.lastNightIsCurrent).toBe(false);
    expect(planMorningReport(missing)).toEqual([]);
  });

  it('gives late risers two hours after waking', () => {
    expect(reportDeadline(WORKDAY, at(WORKDAY, 7))).toBe(at(WORKDAY, 12));
    expect(reportDeadline(WORKDAY, at(WORKDAY, 11.5))).toBe(at(WORKDAY, 13.5));
  });

  it('marks the night as reported when it plans the notification', () => {
    const ctx = scenario(at(WORKDAY, 8.5), { background: true });
    const planned = morningReport.plan(ctx);
    expect(planned).toHaveLength(1);
    expect(ctx.state.setMark).toHaveBeenCalledWith(REPORT_MARK, WORKDAY);
    // A second, overlapping re-plan in the same JS context (stale state snapshot) doesn't resend.
    expect(morningReport.plan(scenario(at(WORKDAY, 8.5), { background: true }))).toEqual([]);
  });

  it("doesn't notify while eepy is open on screen, but still marks the night", () => {
    const day = '2026-10-22';
    const prev = RNAppState.currentState;
    (RNAppState as { currentState: unknown }).currentState = 'active';
    try {
      const ctx = scenario(at(day, 8.5), { background: false });
      expect(planMorningReport(ctx)).toHaveLength(1);
      expect(morningReport.plan(ctx)).toEqual([]);
      expect(ctx.state.setMark).toHaveBeenCalledWith(REPORT_MARK, day);
    } finally {
      (RNAppState as { currentState: unknown }).currentState = prev;
    }
  });

  it('opens the night details when tapped', async () => {
    const ctx = scenario(at(WORKDAY, 8.5));
    await morningReport.onResponse!({ actionId: 'default', data: { nightId: 'demo-x', wakeDate: WORKDAY } }, ctx.state);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/night/[id]', params: { id: 'demo-x' } });
  });
});
