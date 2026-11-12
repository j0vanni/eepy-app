/**
 * Render tests for the screens opened from the Plan tab, on the demo data: Adjust tonight (the
 * form and what "Use this" stores), the month view (the month, a past night, planning a coming
 * morning), What if? (presets, a nap, a drink, the folded table) and Jet lag — plus the old /plan
 * route.
 */
// Icons load their font asynchronously, which Jest's asset registry can't serve.
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-notifications', () => ({}));
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockRedirect = jest.fn();
let mockParams: { date?: string } = {};
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    navigate: (...a: unknown[]) => mockPush(...a),
    back: (...a: unknown[]) => mockBack(...a),
    canGoBack: () => true,
    replace: jest.fn(),
    setParams: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
  Redirect: (p: { href: string }) => {
    mockRedirect(p.href);
    return null;
  },
}));

import { act } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createRoot, Root, TestInstance } from 'test-renderer';

import CalendarScreen from '../../app/calendar';
import JetLagScreen from '../../app/jetlag';
import PlanRedirect from '../../app/plan';
import SimulateScreen from '../../app/simulate';
import AdjustTonight from '../../app/tonight';
import { analyze } from '../../engine/analysis';
import { atMinutes, formatTime, HOUR } from '../../engine/time';
import { analyzeOptionsFor } from '../../state/analysisOptions';
import { selectDataset, useStore } from '../../state/store';

// Monday afternoon.
const NOW = atMinutes('2026-11-02', 14 * 60);
const TUE = '2026-11-03';
let root: Root;

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  useStore.getState().loadDemo(NOW);
  useStore.getState().setProfile({ onboarded: true, wakePlan: {}, workdays: [1, 2, 3, 4, 5], workWakeMin: 7 * 60, twoStepMorning: undefined });
  useStore.getState().setSettings({ tonight: undefined, clock: '24h' });
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  jest.restoreAllMocks();
});

const analysis = () => {
  const s = useStore.getState();
  return analyze(selectDataset(s), NOW, analyzeOptionsFor(s, { now: NOW }));
};
const inApp = (el: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 900 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>{el}</SafeAreaProvider>
);
const render = async (el: React.ReactElement) => {
  await act(async () => root.render(inApp(el)));
  await act(async () => undefined);
};
/** A fresh mount: the forms keep their own draft. */
const remount = async (el: React.ReactElement) => {
  await act(async () => root.unmount());
  root = createRoot();
  await render(el);
};
const settle = (ms = 250) => act(async () => new Promise<void>((r) => setTimeout(r, ms)));
const text = () =>
  root.container
    .queryAll((i) => i.type === 'Text')
    .map((i) => i.children.filter((c) => typeof c === 'string').join(''))
    .join('\n');
const EVENT = { nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined, preventDefault: () => undefined };
const clickable = (n: TestInstance | null | undefined) => {
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  return n ?? undefined;
};
const click = async (n: TestInstance | undefined, what: string) => {
  if (!n) throw new Error(`no "${what}" in ${text()}`);
  await act(async () => n.props.onClick(EVENT));
  await act(async () => undefined);
};
const press = (label: string) => click(clickable(root.container.queryAll((i) => i.type === 'Text' && i.children.join('') === label)[0]), label);
const pressLabelled = (label: string) => click(root.container.queryAll((i) => i.props.accessibilityLabel === label && typeof i.props.onClick === 'function')[0], label);

describe('Adjust tonight', () => {
  it('starts on the plan; a later lights-out shows what it costs and "Use this" stores it for tonight only', async () => {
    const a = analysis();
    await render(<AdjustTonight />);
    let t = text();
    for (const part of ['Lights out', 'Wake-up', 'What it means', 'ENERGY TOMORROW', 'DEBT AFTER', 'ALARM']) expect(t).toContain(part);
    expect(t).toContain(`Plan · ${formatTime(a.tonight.bedtime)}`);
    // Nothing changed yet: one button, and it keeps the plan.
    expect(t).toContain('Keep the plan');
    expect(t).not.toContain('Use this');
    expect(t).not.toContain('Back to the plan');

    await press('+1 h');
    t = text();
    expect(t).toContain('+1h 00m vs the plan');
    expect(t).toContain(formatTime(a.tonight.bedtime + HOUR));
    expect(t).toMatch(/−\d+m vs plan|−1h \d\dm vs plan/);
    expect(t).toContain('Back to the plan');
    await press('Use this');
    expect(useStore.getState().settings.tonight).toEqual({ wakeDate: TUE, bedtime: a.tonight.bedtime + HOUR });
    expect(mockBack).toHaveBeenCalled();
    expect(analysis().tonight.bedtime).toBe(a.tonight.bedtime + HOUR);
  });

  it('moves the wake-up too, and "Back to the plan" clears tonight\'s change', async () => {
    const a = analysis();
    await render(<AdjustTonight />);
    await pressLabelled('Increase Workday');
    expect(text()).toContain('+15m vs the plan');
    await press('Use this');
    expect(useStore.getState().settings.tonight).toEqual({ wakeDate: TUE, wake: a.tonight.wake + 15 * 60_000 });

    // Opened again: it starts from tonight's own times, and offers the way back.
    await remount(<AdjustTonight />);
    expect(text()).toContain('+15m vs the plan');
    expect(text()).toContain(`Keep ${formatTime(a.tonight.wake)}`);
    await press('Back to the plan');
    expect(useStore.getState().settings.tonight).toBeUndefined();
    expect(mockBack).toHaveBeenCalledTimes(2);
  });

  it('putting the times back on the plan keeps the plan', async () => {
    const a = analysis();
    useStore.getState().setSettings({ tonight: { wakeDate: TUE, bedtime: a.tonight.bedtime + HOUR } });
    await render(<AdjustTonight />);
    await press(`Plan · ${formatTime(a.tonight.bedtime)}`);
    expect(text()).toContain('Keep the plan');
    await press('Keep the plan');
    expect(useStore.getState().settings.tonight).toBeUndefined();
  });

  it('without data: says there is nothing to adjust', async () => {
    useStore.setState({ sessions: [] });
    await render(<AdjustTonight />);
    expect(text()).toContain('Nothing to adjust yet');
  });
});

describe('Month view', () => {
  const cells = () => root.container.queryAll((i) => i.props.accessibilityRole === 'button' && typeof i.props.accessibilityLabel === 'string' && typeof i.props.onClick === 'function' && typeof i.props.accessibilityState?.selected === 'boolean');

  it('opens on this month with tonight selected, and plans that morning', async () => {
    await render(<CalendarScreen />);
    const t = text();
    expect(t).toContain('November 2026 · average sleep');
    expect(t).toMatch(/Enough sleep on \d+ of \d+ nights?/);
    // Tonight's morning is selected: its wake-up choice and the night before.
    expect(t).toContain('Wake-up that morning');
    expect(t).toContain('Tonight');
    expect(t).toContain('WIND DOWN');
    expect(t).toContain('Adjust tonight');
    await press('Free day');
    expect(useStore.getState().profile.wakePlan?.[TUE]).toEqual({ free: true });
    expect(text()).toContain('No alarm that morning');
    await press('Adjust tonight');
    expect(mockPush).toHaveBeenCalledWith('/tonight');
  });

  it('shows a past night, and leads to its details', async () => {
    await render(<CalendarScreen />);
    const past = cells().find((c) => c.props.accessibilityLabel.includes('slept'));
    await click(past, 'a past night');
    const t = text();
    expect(t).toContain('SLEEP DEBT');
    expect(t).toContain('SCORE');
    expect(t).not.toContain('Wake-up that morning');
    await press('SLEEP DEBT');
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/night/[id]' }));
  });

  it('changes month, and selects the day in the date param', async () => {
    mockParams = { date: '2026-11-06' };
    await render(<CalendarScreen />);
    expect(cells().find((c) => c.props.accessibilityState.selected)?.props.accessibilityLabel).toContain('Fri 6 Nov');
    await pressLabelled('Previous month');
    expect(text()).toContain('October 2026');
    await pressLabelled('Next month');
    await pressLabelled('Next month');
    // No nights in a month still to come.
    expect(text()).toContain('December 2026');
    expect(text()).toContain('No nights');
  });

  it('without data: points to the usual week on the Plan tab', async () => {
    useStore.setState({ sessions: [] });
    await render(<CalendarScreen />);
    await press('Set your usual week');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/planner', params: { show: 'week' } });
  });
});

describe('What if?', () => {
  it('redraws tomorrow for a late night, and resets', async () => {
    await render(<SimulateScreen />);
    expect(text()).toContain('Tomorrow’s energy');
    expect(text()).toContain('±0 vs plan');
    await press('Late night (+2h)');
    await settle();
    expect(text()).toContain('2h 00m later than plan');
    expect(text()).not.toContain('±0 vs plan');
    await press('Reset');
    await settle();
    expect(text()).toContain('±0 vs plan');
    expect(text()).not.toContain('later than plan');
  });

  it('adds a nap and a drink, and removes the drink', async () => {
    await render(<SimulateScreen />);
    expect(text()).not.toContain('Lie down at');
    await press('Add a nap');
    expect(text()).toContain('Lie down at');
    expect(text()).toContain('Alarm after');
    await press('Add a drink');
    expect(text()).toContain('Drink 1 · 95 mg');
    await pressLabelled('Remove drink 1');
    expect(text()).not.toContain('Drink 1');
  });

  it('keeps every number and how it works folded', async () => {
    await render(<SimulateScreen />);
    expect(text()).not.toContain('Falling asleep');
    await press('Every number, side by side');
    expect(text()).toContain('Falling asleep');
    expect(text()).toContain('Energy in the dip');
    expect(text()).not.toContain('It’s a model, not a promise');
    await press('How the simulator works');
    expect(text()).toContain('It’s a model, not a promise');
  });

  it('without data: says so', async () => {
    useStore.setState({ sessions: [] });
    await render(<SimulateScreen />);
    expect(text()).toContain('No sleep data yet');
  });
});

describe('Jet lag', () => {
  it('plans six hours east day by day, and drops the days before when you start on the day', async () => {
    await render(<JetLagScreen />);
    let t = text();
    expect(t).toContain('6 h east · adjusting takes about');
    expect(t).toContain('Day by day');
    expect(t).toContain('2 days before');
    expect(t).toContain('Travel day');
    expect(t).toMatch(/Bright light \d\d:\d\d–\d\d:\d\d/);
    await press('No');
    t = text();
    expect(t).not.toContain('days before');
    expect(t).toContain('Travel day');
  });

  it('needs no plan for under an hour', async () => {
    await render(<JetLagScreen />);
    for (let i = 0; i < 12; i++) await pressLabelled('Decrease Destination');
    expect(text()).toContain('No plan needed');
    expect(text()).not.toContain('Day by day');
  });
});

describe('The old /plan route', () => {
  it('lands on the Plan tab', async () => {
    await render(<PlanRedirect />);
    expect(mockRedirect).toHaveBeenCalledWith('/planner');
  });
});
