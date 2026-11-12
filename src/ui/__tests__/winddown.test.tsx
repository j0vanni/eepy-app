/**
 * Render tests for the wind-down screen: the countdown at the top, one main action at a time (the
 * rundown until lights-out, then "I'm in bed"), tonight's steps, the helpers that open in place,
 * and — with the rundown off — the plain timeline and its checklist.
 */
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
  clearLastNotificationResponse: jest.fn(),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), navigate: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('../../integrations/screen', () => ({
  getScreenBrightness: () => Promise.resolve(undefined),
  canSetPhoneBrightness: () => Promise.resolve(false),
  dimEepy: () => Promise.resolve(),
  undimEepy: () => Promise.resolve(),
  screenControlsSupported: () => false,
}));
const mockSensor = { available: false, remove: jest.fn() };
jest.mock('expo-sensors', () => ({
  LightSensor: {
    isAvailableAsync: () => Promise.resolve(mockSensor.available),
    setUpdateInterval: jest.fn(),
    addListener: (fn: (e: { illuminance: number }) => void) => {
      fn({ illuminance: 12 });
      return { remove: mockSensor.remove };
    },
  },
}));
// The breathing pacer animates with reanimated, which Jest can't load; the screen only needs it to mount.
jest.mock('../../audio/ui/Breathing', () => ({ Breathing: () => null }));

import { act } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createRoot, Root, TestInstance } from 'test-renderer';

import { soundPlayer } from '../../audio/player';
import { analyze, Analysis } from '../../engine/analysis';
import { DEFAULT_RUNDOWN } from '../../engine/rundown';
import { formatTime, MINUTE } from '../../engine/time';
import { analyzeOptionsFor } from '../../state/analysisOptions';
import { selectDataset, useStore } from '../../state/store';
import WindDownScreen from '../../app/winddown';
import { colors } from '../theme';

// Monday 2026-11-02 on the demo data (times come from tonight's plan).
const DAY_START = new Date(2026, 10, 2).getTime();
const prevOS = Platform.OS;
let clock = DAY_START;
let tonight: Analysis['tonight'];
let root: Root;

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockSensor.available = false;
  const st = useStore.getState();
  st.loadDemo(DAY_START + 22 * 60 * MINUTE);
  st.setProfile({ onboarded: true, twoStepMorning: undefined });
  st.setSettings({ session: undefined, tonight: undefined, rundownProgress: undefined, rundown: DEFAULT_RUNDOWN, inBedSounds: false, marks: {}, clock: '24h', eReader: { enabled: false, warmLight: false } });
  const s = useStore.getState();
  tonight = analyze(selectDataset(s), DAY_START + 20 * 60 * MINUTE, analyzeOptionsFor(s, { now: DAY_START + 20 * 60 * MINUTE })).tonight;
  clock = tonight.windDownStart + 10 * MINUTE;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  soundPlayer.stopNow();
  (Platform as { OS: string }).OS = prevOS;
  jest.restoreAllMocks();
});

const render = async () => {
  await act(async () =>
    root.render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 900 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <WindDownScreen />
      </SafeAreaProvider>,
    ),
  );
  await act(async () => undefined);
};
const text = () =>
  root.container
    .queryAll((i) => i.type === 'Text')
    .map((i) => i.children.filter((c) => typeof c === 'string').join(''))
    .join('\n');
const button = (label: string): TestInstance | undefined => {
  let n: TestInstance | null | undefined = root.container.queryAll((i) => i.type === 'Text' && i.children.join('') === label)[0];
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  return n ?? undefined;
};
const press = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`no button "${label}" in\n${text()}`);
  await act(async () => target.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined, preventDefault: () => undefined }));
  await act(async () => undefined);
};
/** A button's background colour: amber for the screen's one main action. */
const background = (label: string): unknown => Object.assign({}, ...[button(label)!.props.style].flat(Infinity).filter(Boolean)).backgroundColor;

describe('the wind-down screen', () => {
  it('opens with the countdown, the rundown as the one main action, then tonight\'s steps', async () => {
    await render();
    const t = text();
    expect(t).toContain('Winding down · lights out in');
    expect(t).toContain('50m');
    expect(t).toContain(`At ${formatTime(tonight.bedtime)} · wake ${formatTime(tonight.wake)}`);
    // One amber button: the rundown. "I'm in bed" is there, but quiet.
    expect(background('Start my rundown')).toBe(colors.accent);
    expect(background("I'm in bed")).not.toBe(colors.accent);
    expect(t).toContain('Your bedtime rundown');
    // Ten minutes in: the step happening now comes first, what's behind you is folded away.
    expect(t).toContain('Bedroom ready');
    expect(t).toContain('3m left');
    expect(t).not.toContain('Set up tomorrow');
    expect(button('9 earlier steps')).toBeDefined();
    expect(t).not.toContain("mutes tonight's reminders");
    // No checklist: the rundown has those steps.
    expect(t).not.toContain('Before lights-out');
    await press('Start my rundown');
    expect(useStore.getState().settings.rundownProgress?.wakeDate).toBe(tonight.wakeDate);
    expect(mockPush).toHaveBeenCalledWith('/rundown');
    await render();
    expect(button('Resume · step 1 of 9')).toBeDefined();
  });

  it('before wind-down: the same countdown, saying when wind-down starts', async () => {
    clock = tonight.windDownStart - 30 * MINUTE;
    await render();
    expect(text()).toContain('Lights out in');
    expect(text()).toContain(`wind-down starts ${formatTime(tonight.windDownStart)}, in 30m`);
  });

  it('past lights-out "I\'m in bed" is the main action, and the session takes its place', async () => {
    clock = tonight.bedtime + 5 * MINUTE;
    await render();
    expect(text()).toContain('Time to sleep');
    expect(background("I'm in bed")).toBe(colors.accent);
    expect(background('Start my rundown')).not.toBe(colors.accent);
    await press("I'm in bed");
    expect(useStore.getState().settings.session).toMatchObject({ inBedAt: clock });
    await render();
    expect(text()).toContain(`In bed since ${formatTime(clock)}`);
    expect(button("I'm in bed")).toBeUndefined();
    expect(button('Start my rundown')).toBeUndefined();
  });

  it('the helpers open in place: sleep sounds start right here, the light check only with a sensor', async () => {
    await render();
    expect(text()).toContain('Help falling asleep');
    expect(text()).toContain('Breathe');
    expect(text()).toContain('Phone light');
    expect(text()).not.toContain('Light check');
    expect(button('Play brown noise')).toBeUndefined();
    await press('Sleep sounds');
    await press('Play brown noise');
    expect(soundPlayer.getState().status).toBe('playing');
    expect(button('Stop')).toBeDefined();
    await press('Phone light');
    expect(text()).toContain('THIS EVENING');

    // A phone with a light sensor: the check reads it only while it is open.
    (Platform as { OS: string }).OS = 'android';
    mockSensor.available = true;
    await act(async () => root.unmount());
    root = createRoot();
    await render();
    expect(text()).toContain('Light check');
    expect(text()).not.toContain('lux');
    await press('Light check');
    expect(text()).toContain('12');
    expect(text()).toContain('lux');
    await press('Light check');
    expect(mockSensor.remove).toHaveBeenCalled();
  });

  it('with the rundown off: the plain timeline and a checklist that keeps its ticks tonight', async () => {
    useStore.getState().setSettings({ rundown: { ...DEFAULT_RUNDOWN, enabled: false } });
    await render();
    expect(text()).toContain("Tonight's wind-down");
    expect(text()).not.toContain('Your bedtime rundown');
    expect(button('Start my rundown')).toBeUndefined();
    // Nothing else to start, so "I'm in bed" is the main action.
    expect(background("I'm in bed")).toBe(colors.accent);
    expect(text()).toContain('0 of 4');
    const tick = root.container.queryAll((i) => i.props.accessibilityRole === 'checkbox' && typeof i.props.onClick === 'function')[0];
    await act(async () => tick.props.onClick({ nativeEvent: {} }));
    expect(text()).toContain('1 of 4');
    // Leave and come back.
    await act(async () => root.unmount());
    root = createRoot();
    await render();
    expect(text()).toContain('1 of 4');
  });
});
