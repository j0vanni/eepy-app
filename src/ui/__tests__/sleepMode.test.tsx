/**
 * Render smoke tests for bedtime autopilot (Settings card and Today's countdown line) in the
 * Android states the web preview can't show: no access yet, scheduled, on now, older Android.
 */
// Icons load their font asynchronously, which Jest's asset registry can't serve.
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-notifications', () => ({}));

const mockStatus: { current: Record<string, unknown> } = { current: {} };
const mockNative = {
  getSleepModeStatus: jest.fn(() => Promise.resolve(mockStatus.current)),
  scheduleSleepMode: jest.fn(() => Promise.resolve(mockStatus.current)),
  cancelSleepMode: jest.fn(() => Promise.resolve()),
  startSleepModeNow: jest.fn((_night: string, _off: number) => Promise.resolve(true)),
  stopSleepModeNow: jest.fn((_night: string) => Promise.resolve(true)),
  dismissSleepModePrompt: jest.fn(() => Promise.resolve()),
  openSleepModeAccessSettings: jest.fn(() => Promise.resolve(true)),
  openSleepModeSettings: jest.fn(() => Promise.resolve(true)),
};
jest.mock('../../../modules/eepy-alarm', () => ({
  __esModule: true,
  // Lazy: the factory runs before this file's consts are initialised.
  get default() {
    return mockNative;
  },
}));

import { act } from 'react';
import { Platform } from 'react-native';
import { createRoot, Root, TestInstance } from 'test-renderer';

import { analyze } from '../../engine/analysis';
import { atMinutes } from '../../engine/time';
import { sleepModeWindow } from '../../notifications/sleepMode';
import { selectDataset, useStore } from '../../state/store';
import { SleepModeLine } from '../cards/SleepModeLine';
import { SleepModeSection } from '../settings/SleepModeSection';

// An evening: 21:40, an hour or so before the demo plan's lights-out.
const NOW = atMinutes('2026-10-30', 21 * 60 + 40);
const prevOS = Platform.OS;
let root: Root;

function status(over: Record<string, unknown> = {}) {
  const s = useStore.getState();
  const a = analyze(selectDataset(s), NOW);
  const w = sleepModeWindow(a, s.settings, NOW)!;
  return {
    sdk: 35,
    supported: true,
    deviceEffects: true,
    access: true,
    ruleId: 'rule-1',
    active: false,
    userManaged: true,
    exactAlarms: true,
    windows: [{ night: w.night, onAt: w.on, offAt: w.off, sounds: null }],
    appliedNight: null,
    stoppedNight: null,
    lastError: null,
    ...over,
  };
}

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  (Platform as { OS: string }).OS = 'android';
  useStore.getState().loadDemo(NOW);
  useStore.getState().setProfile({ onboarded: true });
  useStore.getState().setSleepModeSettings({ enabled: true, startAt: 'lightsout', offerSounds: true });
  mockStatus.current = status();
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  (Platform as { OS: string }).OS = prevOS;
  jest.restoreAllMocks();
});

const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
  // Let the status read resolve.
  await act(async () => undefined);
};
const text = () => JSON.stringify(root.container.toJSON());
const button = (label: string): TestInstance | undefined => {
  let n: TestInstance | null | undefined = root.container.queryAll((i) => i.type === 'Text' && i.children.includes(label))[0];
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  return n ?? undefined;
};
const press = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`no button "${label}"`);
  await act(async () => target.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined }));
};

describe('Settings → Bedtime autopilot', () => {
  it('asks for Do Not Disturb (Modes) access first', async () => {
    mockStatus.current = status({ access: false, ruleId: null, active: null });
    await render(<SleepModeSection />);
    expect(text()).toContain('grayscale screen, dimmed wallpaper, dark theme');
    expect(text()).toContain("eepy can't switch sleep mode yet");
    expect(button('Allow access')).toBeDefined();
    expect(button('Start now')).toBeUndefined();
    expect(button('Customise the mode')).toBeUndefined();
  });

  it("shows tonight's times, and Start now / Customise once allowed", async () => {
    await render(<SleepModeSection />);
    expect(text()).toContain('Tonight: on');
    expect(text()).toContain('Scheduled');
    expect(button('Customise the mode')).toBeDefined();
    await press('Start now');
    const w = (mockStatus.current.windows as { night: string; offAt: number }[])[0];
    expect(mockNative.startSleepModeNow).toHaveBeenCalledWith(w.night, w.offAt);
    await press('Customise the mode');
    expect(mockNative.openSleepModeSettings).toHaveBeenCalled();
  });

  it('offers Stop now while it is on', async () => {
    const s = status({ active: true });
    const w = (s.windows as { night: string; onAt: number; offAt: number }[])[0];
    // Started early: the native window began now.
    mockStatus.current = { ...s, windows: [{ ...w, onAt: NOW - 60_000 }], appliedNight: w.night };
    await render(<SleepModeSection />);
    expect(text()).toContain('On now');
    await press('Stop now');
    expect(mockNative.stopSleepModeNow).toHaveBeenCalledWith(w.night);
  });

  it('says older Android only silences notifications', async () => {
    mockStatus.current = status({ sdk: 33, deviceEffects: false });
    await render(<SleepModeSection />);
    expect(text()).toContain('On Android 13 this only silences notifications');
    expect(button('Do Not Disturb settings')).toBeDefined();
  });

  it('hides the controls while autopilot is off', async () => {
    useStore.getState().setSleepModeSettings({ enabled: false });
    await render(<SleepModeSection />);
    expect(text()).toContain('Bedtime autopilot');
    expect(button('Start now')).toBeUndefined();
    expect(text()).not.toContain('Tonight: on');
  });
});

describe("Today's countdown line", () => {
  it('shows when sleep mode switches on and off, with Start now in the evening', async () => {
    const a = analyze(selectDataset(useStore.getState()), NOW);
    await render(<SleepModeLine a={a} />);
    expect(text()).toContain('Sleep mode');
    expect(text()).toContain('Switches by itself');
    expect(button('Start now')).toBeDefined();
  });

  it('nudges to set it up when autopilot is off, and is absent off Android', async () => {
    useStore.getState().setSleepModeSettings({ enabled: false });
    const a = analyze(selectDataset(useStore.getState()), NOW);
    await render(<SleepModeLine a={a} />);
    expect(button('Set up')).toBeDefined();
    (Platform as { OS: string }).OS = 'ios';
    await render(<SleepModeLine a={a} />);
    expect(button('Set up')).toBeUndefined();
    expect(text()).not.toContain('sleep mode');
  });
});
