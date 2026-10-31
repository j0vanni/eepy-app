/**
 * Render tests for the Phone light card's Android-only parts (the web preview can't read the
 * phone's brightness): the permission prompt, the brightness slider and "Set to target".
 */
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
const mockScreen = {
  getScreenBrightness: jest.fn(() => Promise.resolve(0.8 as number | undefined)),
  canSetPhoneBrightness: jest.fn(() => Promise.resolve(false)),
  askPhoneBrightnessPermission: jest.fn(() => Promise.resolve(true)),
  setPhoneBrightness: jest.fn((_v: number) => Promise.resolve(true)),
  getAutoBrightness: jest.fn(() => Promise.resolve(true as boolean | undefined)),
  setAutoBrightness: jest.fn((_on: boolean) => Promise.resolve(true)),
  dimEepy: jest.fn(() => Promise.resolve()),
  openNightLightSettings: jest.fn(() => Promise.resolve(true)),
  openExtraDimSettings: jest.fn(() => Promise.resolve(true)),
  screenControlsSupported: () => true,
};
// Imports are hoisted above `mockScreen`, so the module delegates to it lazily.
jest.mock('../../integrations/screen', () =>
  new Proxy({}, { get: (_t, key: string) => (key === '__esModule' ? false : (mockScreen as Record<string, unknown>)[key]) }),
);

import { act } from 'react';
import { createRoot, Root, TestInstance } from 'test-renderer';

import { analyze } from '../../engine/analysis';
import { generateDemoData } from '../../engine/demo';
import { atMinutes } from '../../engine/time';
import { ScreenLightCard } from '../cards/ScreenLightCard';

const NOW = atMinutes('2026-10-29', 21 * 60); // evening: target ≤ 50%
let root: Root;
beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  jest.clearAllMocks();
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  jest.useRealTimers();
});

const a = analyze(generateDemoData(NOW), NOW);
const render = async () => {
  await act(async () => root.render(<ScreenLightCard a={a} />));
  await act(async () => {
    await Promise.resolve();
  });
};
const text = () => JSON.stringify(root.container.toJSON());
const pressable = (label: string): TestInstance | undefined => {
  let n: TestInstance | null | undefined = root.container.queryAll((i) => i.type === 'Text' && i.children.includes(label))[0];
  while (n && !n.props.onClick && !n.props.onPress) n = n.parent;
  return n ?? undefined;
};
const press = async (label: string) => {
  const p = pressable(label);
  if (!p) throw new Error(`no button "${label}" in ${text()}`);
  await act(async () => (p.props.onPress ?? p.props.onClick)());
};

describe('Phone light card on Android', () => {
  it('asks once for "Modify system settings" before the slider works', async () => {
    await render();
    expect(text()).toContain('Phone brightness');
    expect(text()).toContain('Screen at 80%');
    await press('Allow brightness control');
    expect(mockScreen.askPhoneBrightnessPermission).toHaveBeenCalled();
  });

  it('sets the phone to the target in one tap', async () => {
    mockScreen.canSetPhoneBrightness.mockResolvedValue(true);
    await render();
    await press('Set to 50%');
    expect(mockScreen.setPhoneBrightness).toHaveBeenCalledWith(0.5);
  });

  it('hides the slider where brightness can’t be read', async () => {
    mockScreen.getScreenBrightness.mockResolvedValue(undefined);
    await render();
    expect(text()).not.toContain('Phone brightness');
  });
});
