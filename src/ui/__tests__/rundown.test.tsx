/**
 * Render tests for the bedtime rundown: the guided player (start, Done / Skip / Back, the progress
 * bar, resuming, the phone-down hand-off and the final "I'm in bed" starting the sleep session),
 * Today's compact card with "Start my rundown", and the editor in Settings.
 */
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
  clearLastNotificationResponse: jest.fn(),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), navigate: (...a: unknown[]) => mockPush(...a), back: jest.fn(), canGoBack: () => false },
}));
const mockDim = jest.fn((_v: number) => Promise.resolve());
jest.mock('../../integrations/screen', () => ({
  getScreenBrightness: () => Promise.resolve(0.8),
  dimEepy: (v: number) => mockDim(v),
  undimEepy: () => Promise.resolve(),
  screenControlsSupported: () => false,
}));
jest.mock('../confirm', () => ({ confirm: jest.fn(() => Promise.resolve(true)), notify: jest.fn() }));

import { act } from 'react';
import { createRoot, Root, TestInstance } from 'test-renderer';

import { soundPlayer } from '../../audio/player';
import { analyze, Analysis } from '../../engine/analysis';
import { DEFAULT_ORDER, DEFAULT_RUNDOWN } from '../../engine/rundown';
import { formatTime, MINUTE } from '../../engine/time';
import { analyzeOptionsFor } from '../../state/analysisOptions';
import * as inBed from '../../state/inBed';
import { selectDataset, useStore } from '../../state/store';
import { WindDownTimelineCard } from '../cards/WindDownTimeline';
import { RundownPlayer } from '../rundown/Player';
import { RundownSection } from '../settings/RundownSection';

// Monday 2026-11-02 on the demo data (times come from tonight's plan).
const DAY_START = new Date(2026, 10, 2).getTime();
let clock = DAY_START;
let root: Root;

const analysisAt = (now: number): Analysis => {
  const s = useStore.getState();
  return analyze(selectDataset(s), now, analyzeOptionsFor(s, { now }));
};

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
let tonight: Analysis['tonight'];
beforeEach(() => {
  jest.clearAllMocks();
  const st = useStore.getState();
  st.loadDemo(DAY_START + 22 * 60 * MINUTE);
  st.setProfile({ onboarded: true, twoStepMorning: undefined });
  st.setSettings({ session: undefined, tonight: undefined, rundownProgress: undefined, rundown: DEFAULT_RUNDOWN, inBedSounds: false, marks: {}, clock: '24h', eReader: { enabled: false, warmLight: false } });
  tonight = analysisAt(DAY_START + 20 * 60 * MINUTE).tonight;
  clock = tonight.windDownStart;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  soundPlayer.stopNow();
  jest.restoreAllMocks();
});

const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
  await act(async () => undefined);
};
const remount = async (el: React.ReactElement) => {
  await act(async () => root.unmount());
  root = createRoot();
  await render(el);
};
const text = () =>
  root.container
    .queryAll((i) => i.type === 'Text')
    .map((i) => i.children.filter((c) => typeof c === 'string').join(''))
    .join('\n');
const find = (match: (i: TestInstance) => boolean) => root.container.queryAll(match)[0];
const button = (label: string): TestInstance | undefined => {
  let n: TestInstance | null | undefined = find((i) => i.type === 'Text' && i.children.join('') === label);
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  return n ?? undefined;
};
const press = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`no button "${label}" in\n${text()}`);
  await act(async () => target.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined, preventDefault: () => undefined }));
  await act(async () => undefined);
};
const progressValue = () => find((i) => i.props.accessibilityRole === 'progressbar')?.props.accessibilityValue;
const player = () => <RundownPlayer a={analysisAt(clock)} />;

describe('the guided player', () => {
  it('starts, goes step by step with Done / Skip / Back and a progress bar, and resumes', async () => {
    await render(player());
    expect(text()).toContain('TONIGHT');
    expect(text()).toContain(`Phone down ${formatTime(tonight.bedtime - 45 * MINUTE)} · read 30 min · lights out ${formatTime(tonight.bedtime)}`);
    await press('Start my rundown');
    expect(useStore.getState().settings.rundownProgress).toMatchObject({ wakeDate: tonight.wakeDate, startedAt: clock, marks: {} });

    await render(player());
    expect(text()).toContain('STEP 1 OF 9 · WIND-DOWN');
    expect(text()).toContain('Set up tomorrow');
    expect(text()).toContain('TIME LEFT');
    expect(text()).toContain('5:00');
    expect(progressValue()).toEqual({ min: 0, max: 9, now: 0 });
    // eepy's own screen goes dim while the player is open — but stays readable.
    expect(mockDim).toHaveBeenCalledWith(0.5);

    clock += 3 * MINUTE;
    await press('Done');
    expect(text()).toContain('STEP 2 OF 9');
    expect(text()).toContain('To-do list for tomorrow');
    expect(progressValue()).toMatchObject({ now: 1 });
    await press('Skip');
    expect(text()).toContain('Bedroom ready');
    expect(useStore.getState().settings.rundownProgress!.marks).toMatchObject({ tomorrow: { s: 'done' }, 'todo-list': { s: 'skipped' } });
    await press('Back');
    expect(text()).toContain('To-do list for tomorrow');
    expect(progressValue()).toMatchObject({ now: 1 });

    // Leave and come back: same step.
    await remount(player());
    expect(text()).toContain('STEP 2 OF 9');
    expect(text()).toContain('To-do list for tomorrow');
  });

  it('hands over at phone-down, then the screen-free steps move on by the clock to "I\'m in bed"', async () => {
    const start = jest.spyOn(inBed, 'startInBedSession');
    await render(player());
    await press('Start my rundown');
    await render(player());
    for (const step of ['Set up tomorrow', 'To-do list for tomorrow', 'Bedroom ready', 'Alarm & last messages']) {
      expect(text()).toContain(step);
      await press('Done');
    }
    expect(text()).toContain('PHONE DOWN');
    expect(text()).toContain('eepy keeps time from here');
    expect(mockDim).toHaveBeenLastCalledWith(0.4);
    await press('Phone is down');
    expect(text()).toContain('Teeth & skin care');

    // Twenty minutes later nobody has touched the phone: it's reading time.
    clock = tonight.bedtime - 20 * MINUTE;
    await remount(player());
    expect(text()).toContain('Read a paper book');
    expect(text()).toContain('LIGHTS OUT IN');
    expect(text()).toContain('20m');
    expect(text()).toContain('Start sleep sounds');

    clock = tonight.bedtime;
    await remount(player());
    expect(text()).toContain('LIGHTS OUT');
    expect(button('Done')).toBeUndefined();
    await press("I'm in bed");
    expect(start).toHaveBeenCalledTimes(1);
    expect(useStore.getState().settings.session).toMatchObject({ inBedAt: clock, wakeDate: tonight.wakeDate });
    await render(player());
    expect(text()).toContain('Rundown done — sleep well.');
  });

  it('a late start says what was shortened and why', async () => {
    clock = tonight.bedtime - 35 * MINUTE;
    await render(player());
    expect(text()).toContain('Pick up from now (earlier steps skipped)');
    await press('Start my rundown');
    await render(player());
    expect(text()).toMatch(/Only 35m left before lights-out, so reading is 10 min instead of 30 and setting up tomorrow, the to-do list and relaxing in bed are shorter\./);
    expect(text()).toContain('Set up tomorrow');
    expect(text()).toContain('3 min (set: 5)');
  });

  it('"Pick up from now" starts at the step happening now', async () => {
    clock = tonight.bedtime - 20 * MINUTE;
    await render(player());
    await press('Pick up from now (earlier steps skipped)');
    await render(player());
    expect(text()).toContain('Read a paper book');
    expect(progressValue()).toMatchObject({ now: 6 });
  });
});

describe("Today's compact rundown", () => {
  it('shows tonight at a glance, the next steps and "Start my rundown" in the evening', async () => {
    clock = tonight.windDownStart - 30 * MINUTE;
    await render(<WindDownTimelineCard a={analysisAt(clock)} compact />);
    expect(text()).toContain("Tonight's rundown");
    expect(text()).toContain(`Phone down ${formatTime(tonight.bedtime - 45 * MINUTE)} · read 30 min`);
    expect(text()).toContain('Set up tomorrow');
    await press('Start my rundown');
    expect(useStore.getState().settings.rundownProgress?.wakeDate).toBe(tonight.wakeDate);
    expect(mockPush).toHaveBeenCalledWith('/rundown');
    await render(<WindDownTimelineCard a={analysisAt(clock)} compact />);
    expect(text()).toContain('Resume · step 1 of 9');
  });

  it('expands a step for what to do and why, and falls back to the plain timeline when off', async () => {
    clock = tonight.windDownStart - 30 * MINUTE;
    await render(<WindDownTimelineCard a={analysisAt(clock)} />);
    expect(text()).toContain('Your bedtime rundown');
    expect(text()).toContain(`PHONE DOWN · ${formatTime(tonight.bedtime - 45 * MINUTE)}`);
    expect(text()).not.toContain('Scullin');
    await press('To-do list for tomorrow');
    expect(text()).toContain('Scullin et al., 2018');
    await act(async () => useStore.getState().setSettings({ rundown: { ...DEFAULT_RUNDOWN, enabled: false } }));
    await render(<WindDownTimelineCard a={analysisAt(clock)} />);
    expect(text()).toContain("Tonight's wind-down");
    expect(text()).not.toContain('Your bedtime rundown');
  });
});

describe('the editor (Settings → Your bedtime rundown)', () => {
  const rundown = () => useStore.getState().settings.rundown;

  it('sets reading time, minutes and order', async () => {
    await render(<RundownSection />);
    expect(text()).toContain('READING TIME');
    expect(text()).toContain('1h 00m from wind-down to lights-out (45 min screen-free)');
    await press('15 min');
    expect(rundown().readingMin).toBe(15);
    // A step that needs the phone can't go after phone-down.
    await press('Alarm & last messages');
    expect(button('Later')!.props.accessibilityState).toMatchObject({ disabled: true });
    expect(text()).toContain('Uses a screen, so it stays before phone-down.');
    await press('Teeth & skin care');
    await act(async () => find((i) => i.props.accessibilityLabel === 'Increase Minutes' && typeof i.props.onClick === 'function').props.onClick({ nativeEvent: {} }));
    expect(rundown().minutes.teeth).toBe(15);
    await press('Earlier');
    expect(rundown().order.indexOf('teeth')).toBeLessThan(rundown().order.indexOf('phone-down'));
  });

  it('switches a step off, adds and removes your own, and resets', async () => {
    await render(<RundownSection />);
    const shower = find((i) => i.props.accessibilityRole === 'switch' && i.props.accessibilityLabel === 'Warm shower or bath' && typeof i.props.onChange === 'function');
    await act(async () => shower.props.onChange({ nativeEvent: { value: false } }));
    expect(rundown().off).toContain('shower');

    const input = find((i) => i.props.accessibilityLabel === 'New step' && typeof i.props.onChangeText === 'function');
    await act(async () => input.props.onChangeText('Stretch'));
    await press('Add "Stretch"');
    expect(rundown().custom).toEqual([expect.objectContaining({ title: 'Stretch', min: 5, screenFree: true })]);
    expect(text()).toContain('Stretch');
    await press('Stretch');
    await press('Remove');
    expect(rundown().custom).toEqual([]);

    await press('Reset to the default steps');
    expect(rundown()).toEqual(DEFAULT_RUNDOWN);
    expect(rundown().order).toEqual(DEFAULT_ORDER);
  });

  it('offers a longer wind-down when the rundown is longer, and switches off', async () => {
    await render(<RundownSection />);
    await press('60 min');
    expect(text()).toContain("That's longer than your wind-down");
    await press('Make wind-down 1h 30m');
    expect(useStore.getState().profile.windDownMin).toBe(90);
    const toggle = find((i) => i.props.accessibilityRole === 'switch' && i.props.accessibilityLabel === 'Bedtime rundown' && typeof i.props.onClick === 'function');
    await act(async () => toggle.props.onClick({ nativeEvent: {} }));
    expect(rundown().enabled).toBe(false);
    expect(text()).not.toContain('READING TIME');
  });
});
