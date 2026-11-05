/**
 * eepy's own screen in the evening (ui/EveningScreen.tsx, state/screenDim.ts): auto-dimmed but never
 * too dark to read, and always adjustable — the Brightness button opens eepy's own slider, with
 * "Auto-dim" and "Use phone brightness"; setting it yourself pauses the auto-dimming until noon.
 */
// Icons load their font asynchronously, which Jest's asset registry can't serve.
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-notifications', () => ({}));
const mockScreen = {
  getScreenBrightness: jest.fn(() => Promise.resolve(0.8 as number | undefined)),
  dimEepy: jest.fn((_v: number) => Promise.resolve()),
  undimEepy: jest.fn(() => Promise.resolve()),
  setEepyBrightness: jest.fn((_v: number) => Promise.resolve()),
};
jest.mock('../../integrations/screen', () =>
  new Proxy({}, { get: (_t, key: string) => (key === '__esModule' ? false : (mockScreen as Record<string, unknown>)[key]) }),
);

import { act } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createRoot, Root, TestInstance } from 'test-renderer';

import { EEPY_DIM, EEPY_MIN_SLIDER, sliderToLinear } from '../../engine/screenLight';
import { atMinutes } from '../../engine/time';
import { AUTO_BRIGHTNESS, brighterUntil, eepyDimOn, eepyWindowMode, manualBrightness } from '../../state/screenDim';
import { useStore } from '../../state/store';
import { EveningScreen } from '../EveningScreen';

const MON = '2026-11-02';
const prevOS = Platform.OS;
let root: Root;

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  jest.clearAllMocks();
  (Platform as { OS: string }).OS = 'android';
  const eve = atMinutes(MON, 18 * 60);
  jest.spyOn(Date, 'now').mockReturnValue(eve);
  useStore.getState().loadDemo(eve);
  useStore.getState().setProfile({ onboarded: true });
  useStore.getState().setSettings({ screenDim: true, ...AUTO_BRIGHTNESS });
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  (Platform as { OS: string }).OS = prevOS;
  jest.restoreAllMocks();
});

const render = async () => {
  await act(async () =>
    root.render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 900 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <EveningScreen />
      </SafeAreaProvider>,
    ),
  );
  await act(async () => undefined);
};
const text = () => JSON.stringify(root.container.toJSON());
const press = async (label: string) => {
  let n: TestInstance | null | undefined = root.container.queryAll((i) => i.type === 'Text' && i.children.join('').includes(label))[0];
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  if (!n) throw new Error(`no button "${label}"`);
  const target = n;
  await act(async () => target.props.onClick({ nativeEvent: {}, stopPropagation: () => undefined }));
};

describe('eepy brightness — the rules', () => {
  it('auto-dims to a readable level, set by you, or the phone\'s', () => {
    expect(EEPY_DIM.night).toBeGreaterThanOrEqual(EEPY_MIN_SLIDER);
    // Was 0.15 (under 1% of full brightness): unreadable.
    expect(sliderToLinear(EEPY_DIM.night)).toBeGreaterThan(0.04);
    const now = atMinutes(MON, 23 * 60);
    const s = { screenDim: true, screenDimPausedUntil: undefined, eepyBrightness: undefined };
    expect(eepyWindowMode(s, now, 0.4)).toEqual({ kind: 'auto', slider: 0.4 });
    expect(eepyWindowMode(s, now, undefined)).toEqual({ kind: 'phone' });
    const mine = { ...s, ...manualBrightness(now, 0.7) };
    expect(mine.screenDimPausedUntil).toBe(atMinutes('2026-11-03', 12 * 60));
    expect(eepyWindowMode(mine, now, 0.4)).toEqual({ kind: 'manual', slider: 0.7 });
    expect(eepyDimOn(mine, now)).toBe(false);
    expect(eepyWindowMode({ ...s, ...manualBrightness(now) }, now, 0.4)).toEqual({ kind: 'phone' });
    // Tomorrow noon it's back to auto.
    expect(eepyWindowMode(mine, atMinutes('2026-11-03', 12 * 60 + 1), 0.4)).toEqual({ kind: 'auto', slider: 0.4 });
    expect(brighterUntil(atMinutes(MON, 9 * 60))).toBe(atMinutes(MON, 12 * 60));
  });
});

describe('EveningScreen', () => {
  it('daytime: nothing on screen, eepy follows the phone', async () => {
    (Date.now as jest.Mock).mockReturnValue(atMinutes(MON, 14 * 60));
    await render();
    expect(text()).not.toContain('Brightness');
  });

  it('late at night: dimmed (readably), with a Brightness button that opens eepy\'s own slider', async () => {
    const late = atMinutes('2026-11-03', 1 * 60);
    (Date.now as jest.Mock).mockReturnValue(late);
    useStore.getState().loadDemo(late);
    await render();
    expect(text()).toContain('Brightness');
    expect(mockScreen.dimEepy).toHaveBeenCalledWith(EEPY_DIM.night);
    await press('Brightness');
    expect(text()).toContain("eepy's brightness");
    expect(text()).toContain('Drag to set it yourself');
    await press('Use phone brightness');
    expect(useStore.getState().settings.screenDimPausedUntil).toBe(atMinutes('2026-11-03', 12 * 60));
    expect(useStore.getState().settings.eepyBrightness).toBeUndefined();
    expect(mockScreen.undimEepy).toHaveBeenCalled();
    expect(text()).not.toContain('Brightness');
  });

  it('a brightness you set sticks for the night, and "Auto-dim" goes back', async () => {
    const late = atMinutes('2026-11-03', 1 * 60);
    (Date.now as jest.Mock).mockReturnValue(late);
    useStore.getState().loadDemo(late);
    useStore.getState().setSettings(manualBrightness(late, 0.8));
    await render();
    expect(mockScreen.setEepyBrightness).toHaveBeenCalledWith(0.8);
    expect(mockScreen.dimEepy).not.toHaveBeenCalled();
    await press('Brightness');
    expect(text()).toContain('Set by you until');
    await press('Auto-dim');
    expect(useStore.getState().settings.screenDimPausedUntil).toBeUndefined();
    expect(mockScreen.dimEepy).toHaveBeenCalledWith(EEPY_DIM.night);
  });
});
