/**
 * Render tests for the Planner (week strip, day card, usual week, tonight), the feature search
 * and the one-time "What's new" sheet, on the demo data.
 */
// Icons load their font asynchronously, which Jest's asset registry can't serve.
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-notifications', () => ({}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), navigate: (...a: unknown[]) => mockPush(...a), back: jest.fn(), canGoBack: () => false, replace: jest.fn() },
}));

import { act } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createRoot, Root, TestInstance } from 'test-renderer';

import { analyze } from '../../engine/analysis';
import { atMinutes } from '../../engine/time';
import { selectDataset, useStore } from '../../state/store';
import { FeatureSearch } from '../FeatureSearch';
import { DayCard } from '../planner/DayCard';
import { TonightPanel } from '../planner/TonightPanel';
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
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  useStore.getState().loadDemo(NOW);
  useStore.getState().setProfile({ onboarded: true, wakePlan: {}, workdays: [1, 2, 3, 4, 5] });
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

describe('Planner week strip', () => {
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

describe('Planner day card', () => {
  it('plans a free day and a set time for one morning', async () => {
    const a = analysis();
    const night = a.upcoming[3];
    await render(<DayCard night={night} needMin={a.need.needMin} isTonight={false} />);
    expect(text()).toContain('Lights out');
    expect(text()).toContain('WAKE-UP THAT MORNING');
    await press('Free day');
    expect(useStore.getState().profile.wakePlan?.[night.wakeDate]).toEqual({ free: true });
    expect(text()).toContain('No alarm that morning');
    await press('Set a time');
    expect(useStore.getState().profile.wakePlan?.[night.wakeDate]).toEqual({ wakeMin: 7 * 60 });
    await press('Usual · ');
    expect(useStore.getState().profile.wakePlan?.[night.wakeDate]).toBeUndefined();
  });

  it("offers Adjust tonight on tonight's card", async () => {
    const a = analysis();
    await render(<DayCard night={a.upcoming[0]} needMin={a.need.needMin} isTonight />);
    expect(text()).toContain('TONIGHT’S PLAN');
    await press('Can’t make it? Adjust tonight');
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
  it('shows lights-out big with one clear "Can\'t make it?" button', async () => {
    const a = analysis();
    await render(<TonightPanel a={a} />);
    expect(text()).toContain('Lights out');
    expect(text()).toContain('Can’t make it? Adjust tonight');
    await press('Why these times?');
    expect(text()).toContain('Time in bed');
  });
});

describe('Feature search', () => {
  it('lists matches with where they live, and opens one', async () => {
    const onSearching = jest.fn();
    await render(<FeatureSearch onSearchingChange={onSearching} />);
    const input = root.container.queryAll((i) => i.type === 'TextInput')[0] ?? root.container.queryAll((i) => i.props.placeholder === 'Find a feature or setting…')[0];
    await act(async () => (input.props.onChangeText ? input.props.onChangeText('wake time') : input.props.onChange({ nativeEvent: { text: 'wake time' }, target: { value: 'wake time' } })));
    expect(onSearching).toHaveBeenLastCalledWith(true);
    expect(text()).toContain('Planner › Your usual week');
    await press('Workdays & wake-up times');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/planner', params: { show: 'week' } });
  });
});

describe('Settings pages', () => {
  it('renders the caffeine and about pages', async () => {
    await render(<CaffeineSection />);
    expect(text()).toContain('Caffeine half-life');
    await render(<AboutSection />);
    expect(text()).toContain('not a medical device');
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
    expect(text()).toContain('WHERE THINGS MOVED');
    await press('Got it');
    expect(useStore.getState().settings.marks[WHATS_NEW_MARK]).toBe(WHATS_NEW_ID);
    expect(text()).not.toContain('WHERE THINGS MOVED');
  });
});
