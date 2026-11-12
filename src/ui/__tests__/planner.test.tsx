/**
 * Render tests for the Plan tab (tonight's hero and details, the week strip, the day panel, the
 * usual week, the tools opened by the `show` param), on the demo data — and for the ways into it
 * from other areas: the feature search, the caffeine settings page and the "What's new" sheet.
 * Those last ones find buttons by what a tap does (where it navigates, what it stores), not by
 * the other area's words.
 */
// Icons load their font asynchronously, which Jest's asset registry can't serve.
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-notifications', () => ({}));
const mockPush = jest.fn();
const mockSetParams = jest.fn();
let mockParams: { show?: string; date?: string } = {};
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    navigate: (...a: unknown[]) => mockPush(...a),
    setParams: (...a: unknown[]) => mockSetParams(...a),
    back: jest.fn(),
    canGoBack: () => false,
    replace: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
}));
// The phone-light tool reads the screen brightness through a native module.
jest.mock('../../integrations/screen', () => ({
  getScreenBrightness: () => Promise.resolve(undefined),
  dimEepy: () => Promise.resolve(),
  undimEepy: () => Promise.resolve(),
  screenControlsSupported: () => false,
}));

import { act } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createRoot, Root, TestInstance } from 'test-renderer';

import { analyze } from '../../engine/analysis';
import { atMinutes, formatTime } from '../../engine/time';
import { analyzeOptionsFor } from '../../state/analysisOptions';
import { selectDataset, useStore } from '../../state/store';
import { FeatureSearch } from '../FeatureSearch';
import PlanScreen from '../../app/(tabs)/planner';
import { DayCard } from '../planner/DayCard';
import { AdjustTonightButton } from '../planner/DayPlan';
import { TonightDetails, TonightHero } from '../planner/TonightPanel';
import { UsualWeekCard } from '../planner/UsualWeek';
import { WeekStrip } from '../planner/WeekStrip';
import { AboutSection } from '../settings/AboutSection';
import { CaffeineSection } from '../settings/CaffeineSection';
import { WHATS_NEW_ID, WHATS_NEW_MARK, WhatsNewSheet } from '../WhatsNew';

// Monday afternoon.
const NOW = atMinutes('2026-11-02', 14 * 60);
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
  useStore.getState().setSettings({ tonight: undefined });
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  jest.restoreAllMocks();
});

const analysis = () => analyze(selectDataset(useStore.getState()), NOW);
const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
  await act(async () => undefined);
};
const text = () => JSON.stringify(root.container.toJSON());
const clickable = (match: (i: TestInstance) => boolean): TestInstance | undefined => {
  let n: TestInstance | null | undefined = root.container.queryAll(match)[0];
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  return n ?? undefined;
};
const press = async (label: string) => {
  const target = clickable((i) => i.type === 'Text' && i.children.some((c) => typeof c === 'string' && c.includes(label)));
  if (!target) throw new Error(`no button "${label}"`);
  await act(async () => target.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined, preventDefault: () => undefined }));
};

const EVENT = { nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined, preventDefault: () => undefined };
/**
 * Taps the things that can be tapped, one at a time, until `done()` holds; `before` sets the screen
 * up again before each tap (a tap may close what was open). False when nothing did it.
 */
const tapUntil = async (done: () => boolean, before?: () => Promise<void>): Promise<boolean> => {
  for (let i = 0; i < 60; i++) {
    if (before) await before();
    const all = root.container.queryAll((n) => typeof n.props.onClick === 'function');
    if (i >= all.length) return false;
    await act(async () => all[i].props.onClick(EVENT));
    if (done()) return true;
  }
  return false;
};
const wentTo = (show: string) => () => mockPush.mock.calls.some(([href]) => href?.pathname === '/planner' && href.params?.show === show);

describe('Week strip', () => {
  it('shows seven mornings, tonight first, each with its plan in words', async () => {
    const a = analysis();
    const onSelect = jest.fn();
    await render(<WeekStrip nights={a.upcoming.slice(0, 7)} selected="" onSelect={onSelect} />);
    const tiles = root.container.queryAll((i) => typeof i.props.accessibilityLabel === 'string' && i.props.accessibilityLabel.includes('lights out'));
    expect(tiles).toHaveLength(7);
    expect(tiles[0].props.accessibilityLabel).toMatch(/^Tonight\. Tuesday: lights out \d\d:\d\d → alarm \d\d:\d\d · \dh \d\dm sleep$/);
    expect(text()).toContain('tonight');
    await act(async () => tiles[3].props.onClick({ nativeEvent: {}, preventDefault: () => undefined }));
    expect(onSelect).toHaveBeenCalledWith(a.upcoming[3].wakeDate);
  });

  it('marks a skipped alarm and a free day', async () => {
    const a = analysis();
    const free = { ...a.upcoming[2], noAlarm: true, custom: true };
    await render(<WeekStrip nights={[a.upcoming[0], a.upcoming[1], free]} selected="" onSelect={() => undefined} skippedDate={a.upcoming[1].wakeDate} />);
    expect(text()).toContain('"off"');
    expect(text()).toContain('"free"');
  });
});

describe('Day panel', () => {
  it('plans a free day and a set time for one morning', async () => {
    const a = analysis();
    const night = a.upcoming[3];
    await render(<DayCard night={night} needMin={a.need.needMin} isTonight={false} />);
    expect(text()).toContain('Lights out');
    expect(text()).toContain('Wake-up that morning');
    await press('Free day');
    expect(useStore.getState().profile.wakePlan?.[night.wakeDate]).toEqual({ free: true });
    expect(text()).toContain('No alarm that morning');
    await press('Set a time');
    expect(useStore.getState().profile.wakePlan?.[night.wakeDate]).toEqual({ wakeMin: 7 * 60 });
    await press('Usual · ');
    expect(useStore.getState().profile.wakePlan?.[night.wakeDate]).toBeUndefined();
  });

  it('switches the routine alarm on or off for one morning', async () => {
    const a = analysis();
    // Tuesday and Thursday are two-step mornings; Wednesday isn't.
    useStore.getState().setProfile({ workWakeMin: 6 * 60, twoStepMorning: { enabled: true, firstWakeMin: 5 * 60, routineMin: 20, days: [2, 4] } });
    const tue = a.upcoming.find((n) => n.wakeDate === '2026-11-03')!;
    await render(<DayCard night={tue} needMin={a.need.needMin} isTonight />);
    expect(text()).toContain('Routine alarm this morning');
    expect(text()).toContain('as usual for Tuesdays');
    await press('Routine alarm this morning');
    expect(useStore.getState().profile.wakePlan?.['2026-11-03']).toEqual({ twoStep: false });
    expect(text()).toContain('just this morning');
    // Changing the wake-up keeps the choice; back to the weekly setting forgets it.
    await press('Set a time');
    expect(useStore.getState().profile.wakePlan?.['2026-11-03']).toEqual({ twoStep: false, wakeMin: 6 * 60 });
    await press('Usual · ');
    await press('Routine alarm this morning');
    expect(useStore.getState().profile.wakePlan?.['2026-11-03']).toBeUndefined();

    const wed = a.upcoming.find((n) => n.wakeDate === '2026-11-04')!;
    await render(<DayCard night={wed} needMin={a.need.needMin} isTonight={false} />);
    await press('Routine alarm this morning');
    expect(useStore.getState().profile.wakePlan?.['2026-11-04']).toEqual({ twoStep: true });
    expect(analysis().upcoming.find((n) => n.wakeDate === '2026-11-04')?.twoStep).toBeDefined();
    // A free day has no alarms, so no routine either.
    await press('Free day');
    expect(useStore.getState().profile.wakePlan?.['2026-11-04']).toEqual({ free: true });
    expect(text()).not.toContain('Routine alarm this morning');
  });

  it('offers to skip the routine on a short night', async () => {
    const a = analysis();
    const n = a.upcoming[2];
    const t = n.wake - 60 * 60_000;
    const twoStep = { firstWake: t, firstAlarm: t, routineEnd: t + 20 * 60_000, backToSleep: t + 30 * 60_000, routineMin: 20, fallBackAsleepMin: 10, awakeMin: 30, backToSleepMin: 27 };
    const short = { ...n, heldBack: true, sleepMin: a.need.needMin - 120, twoStep };
    await render(<DayCard night={short} needMin={a.need.needMin} isTonight={false} />);
    expect(text()).toContain("Your body clock isn't ready");
    await press('Skip the routine that morning');
    expect(useStore.getState().profile.wakePlan?.[n.wakeDate]).toEqual({ twoStep: false });
    expect(text()).not.toContain('Skip the routine that morning');
  });

  it("offers Adjust tonight on tonight's panel only", async () => {
    const a = analysis();
    await render(<DayCard night={a.upcoming[2]} needMin={a.need.needMin} isTonight={false} />);
    expect(text()).not.toContain('Adjust tonight');
    await render(<DayCard night={a.upcoming[0]} needMin={a.need.needMin} isTonight />);
    await press('Adjust tonight');
    expect(mockPush).toHaveBeenCalledWith('/tonight');
  });
});

describe('Your usual week', () => {
  it('toggles workdays and moves wake-up times', async () => {
    await render(<UsualWeekCard />);
    await press('Sat');
    expect(useStore.getState().profile.workdays).toEqual([1, 2, 3, 4, 5, 6]);
    const plus = clickable((i) => i.props.accessibilityLabel === 'Increase Workday wake-up');
    await act(async () => plus!.props.onClick({ nativeEvent: {}, preventDefault: () => undefined }));
    expect(useStore.getState().profile.workWakeMin).toBe(7 * 60 + 15);
    expect(text()).toContain('Automatic: 1 h after workdays');
  });
});

describe('Tonight', () => {
  it('shows lights-out as the big number, with wind-down and the alarm under it', async () => {
    const a = analysis();
    await render(<TonightHero a={a} />);
    const t = text();
    expect(t).toContain('Lights out tonight');
    expect(t).toContain(`"${formatTime(a.tonight.bedtime)}"`);
    expect(t).toContain(`"${formatTime(a.tonight.windDownStart)}"`);
    expect(t).toContain(`"${formatTime(a.alarm.alarm)}"`);
    expect(t).toContain('Tuesday · workday');
  });

  it('shows the routine alarm and the final wake-up on a two-step morning', async () => {
    useStore.getState().setProfile({ workWakeMin: 6 * 60, twoStepMorning: { enabled: true, firstWakeMin: 5 * 60, routineMin: 20, days: [2, 4] } });
    const a = analysis();
    expect(a.tonight.twoStep).toBeDefined();
    await render(<TonightHero a={a} />);
    const t = text();
    expect(t).toContain('ROUTINE ALARM');
    expect(t).toContain(`"${formatTime(a.alarm.alarm)}"`);
    expect(t).toContain(`"${formatTime(a.tonight.wake)}"`);
  });

  it('says when tonight was changed, and what the plan was', async () => {
    const before = analysis();
    useStore.getState().setSettings({ tonight: { wakeDate: before.tonight.wakeDate, bedtime: before.tonight.bedtime + 60 * 60_000 } });
    // With the app's own options, so tonight's override counts.
    const st = useStore.getState();
    const a = analyze(selectDataset(st), NOW, analyzeOptionsFor(st, { now: NOW }));
    expect(a.tonight.bedtime).toBe(before.tonight.bedtime + 60 * 60_000);
    await render(
      <>
        <TonightHero a={a} />
        <AdjustTonightButton primary />
      </>,
    );
    expect(text()).toContain(`Changed for tonight only. The plan was lights out ${formatTime(before.tonight.bedtime)}`);
    expect(text()).toContain('Change tonight’s times');
  });

  it('says which of the options is in use', async () => {
    const before = analysis();
    useStore.getState().setSettings({ tonight: { wakeDate: before.tonight.wakeDate, choice: { id: 'catch-up', title: 'Full catch-up' } } });
    await render(<TonightHero a={analysis()} />);
    expect(text()).toContain('Using “Full catch-up” tonight.');
  });

  it('has one main action, "Adjust tonight"', async () => {
    await render(<AdjustTonightButton primary />);
    await press('Adjust tonight');
    expect(mockPush).toHaveBeenCalledWith('/tonight');
  });

  it('folds why these times away, and leads to the wind-down and the alarm settings', async () => {
    const a = analysis();
    await render(<TonightDetails a={a} />);
    expect(text()).not.toContain('Time in bed');
    await press('Why these times?');
    expect(text()).toContain('Time in bed');
    await press('Wind-down');
    expect(mockPush).toHaveBeenCalledWith('/winddown');
    await press('Alarm settings');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/settings/[section]', params: { section: 'alarms' } });
  });
});

describe('Plan tab', () => {
  const screen = (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 900 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <PlanScreen />
    </SafeAreaProvider>
  );
  const settle = () => act(async () => new Promise<void>((r) => setTimeout(r, 200)));

  it('opens with tonight, then the week, the usual week and the tools folded', async () => {
    await render(screen);
    const t = text();
    for (const part of ['Lights out tonight', 'Adjust tonight', 'Tonight in detail', 'The week ahead', 'Your usual week', 'Tools']) expect(t).toContain(part);
    // Tonight comes first; the tools are closed.
    expect(t.indexOf('Lights out tonight')).toBeLessThan(t.indexOf('The week ahead'));
    expect(t.indexOf('The week ahead')).toBeLessThan(t.indexOf('Your usual week'));
    expect(t).toContain('Bedtime calculator');
    expect(t).not.toContain('I need to wake at');
    await press('Bedtime calculator');
    expect(text()).toContain('I need to wake at');
    await press('Month view');
    expect(mockPush).toHaveBeenCalledWith('/calendar');
  });

  it('opens a day from the week strip', async () => {
    const a = analysis();
    await render(screen);
    expect(text()).toContain('Tap a day');
    const tiles = root.container.queryAll((i) => typeof i.props.accessibilityLabel === 'string' && i.props.accessibilityLabel.includes('lights out') && typeof i.props.onClick === 'function');
    await act(async () => tiles[3].props.onClick({ nativeEvent: {}, preventDefault: () => undefined }));
    expect(text()).toContain('Wake-up that morning');
    expect(text()).not.toContain('Tap a day');
    await press('Free day');
    expect(useStore.getState().profile.wakePlan?.[a.upcoming[3].wakeDate]).toEqual({ free: true });
  });

  it('honours the show param: opens that tool and clears the param', async () => {
    mockParams = { show: 'caffeine' };
    await render(screen);
    expect(text()).toContain('Active now');
    expect(text()).not.toContain('I need to wake at');
    await settle();
    expect(mockSetParams).toHaveBeenCalledWith({ show: undefined, date: undefined });
  });

  it('honours the date param: selects that morning', async () => {
    const a = analysis();
    mockParams = { date: a.upcoming[2].wakeDate };
    await render(screen);
    expect(text()).toContain('Wake-up that morning');
    await settle();
    expect(mockSetParams).toHaveBeenCalled();
  });

  it('without data: says so and still lets you set the usual week', async () => {
    useStore.setState({ sessions: [] });
    await render(screen);
    expect(text()).toContain('Your plan appears after the first night');
    expect(text()).toContain('Workday wake-up');
    expect(text()).not.toContain('Lights out tonight');
  });
});

describe('Feature search', () => {
  it('finds the usual week and opens the Plan tab there', async () => {
    const onSearching = jest.fn();
    await render(<FeatureSearch onSearchingChange={onSearching} />);
    const type = async (q: string) => {
      const input = root.container.queryAll((i) => i.type === 'TextInput')[0] ?? root.container.queryAll((i) => typeof i.props.placeholder === 'string')[0];
      await act(async () => (input.props.onChangeText ? input.props.onChangeText(q) : input.props.onChange({ nativeEvent: { text: q }, target: { value: q } })));
    };
    await type('wake time');
    expect(onSearching).toHaveBeenLastCalledWith(true);
    expect(await tapUntil(wentTo('week'), () => type('wake time'))).toBe(true);
  });
});

describe('Settings pages', () => {
  it('the caffeine page leads to the caffeine tool on the Plan tab; the about page renders', async () => {
    await render(<CaffeineSection />);
    expect(await tapUntil(wentTo('caffeine'))).toBe(true);
    await render(<AboutSection />);
    expect(root.container.queryAll((i) => i.type === 'Text').length).toBeGreaterThan(0);
  });
});

describe("What's new", () => {
  it('shows once for people who used eepy before, then never again', async () => {
    useStore.getState().setMark(WHATS_NEW_MARK, undefined);
    await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 900 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <WhatsNewSheet />
      </SafeAreaProvider>,
    );
    const words = () => root.container.queryAll((i) => i.type === 'Text').length;
    expect(words()).toBeGreaterThan(0);
    // Closing it (any of its ways out) records that it was seen.
    expect(await tapUntil(() => useStore.getState().settings.marks[WHATS_NEW_MARK] === WHATS_NEW_ID)).toBe(true);
    expect(words()).toBe(0);
  });
});
