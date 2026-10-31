// The native module: present (a mock) or absent (undefined, like iOS / web / Expo Go / older APKs).
const mockNative = {
  setShortcuts: jest.fn((_json: string) => Promise.resolve(true)),
  requestAddCoffeeTile: jest.fn(() => Promise.resolve(true)),
};
const mockModule: { available: boolean } = { available: true };
jest.mock('../../../modules/eepy-alarm', () => ({
  __esModule: true,
  get default() {
    return mockModule.available ? mockNative : undefined;
  },
}));

import { Platform } from 'react-native';

import { canRequestCoffeeTile, hasAppShortcuts, refreshAppShortcuts, requestCoffeeTile, resetShortcutsMemo } from '../appShortcuts';
import { APP_SHORTCUTS } from '../quickActions';

// Platform.Version is a getter on the iOS default Jest platform; redefine it per test.
const prevOS = Platform.OS;
const versionDescriptor = Object.getOwnPropertyDescriptor(Platform, 'Version');
function setPlatform(os: string, version: number) {
  (Platform as { OS: string }).OS = os;
  Object.defineProperty(Platform, 'Version', { value: version, configurable: true, writable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockModule.available = true;
  mockNative.setShortcuts.mockImplementation(() => Promise.resolve(true));
  setPlatform('android', 35);
  resetShortcutsMemo();
});

afterAll(() => {
  (Platform as { OS: string }).OS = prevOS;
  if (versionDescriptor) Object.defineProperty(Platform, 'Version', versionDescriptor);
});

describe('app-icon shortcuts', () => {
  it('publishes the four shortcuts once per app start', async () => {
    expect(await refreshAppShortcuts()).toBe(true);
    await refreshAppShortcuts();
    expect(mockNative.setShortcuts).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(mockNative.setShortcuts.mock.calls[0][0]);
    expect(sent).toEqual(APP_SHORTCUTS);
    for (const s of sent) expect(s.link).toMatch(/^eepy:\/\/quick\/(coffee|nap|late|checkin)$/);
  });

  it('tries again next time when Android refused (rate limit) or the call failed', async () => {
    mockNative.setShortcuts.mockImplementationOnce(() => Promise.resolve(false));
    expect(await refreshAppShortcuts()).toBe(false);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockNative.setShortcuts.mockImplementationOnce(() => Promise.reject(new Error('locked')));
    expect(await refreshAppShortcuts()).toBe(false);
    warn.mockRestore();
    expect(await refreshAppShortcuts()).toBe(true);
    expect(mockNative.setShortcuts).toHaveBeenCalledTimes(3);
  });

  it('is a no-op off Android and without the native module', async () => {
    setPlatform('ios', 35);
    expect(hasAppShortcuts()).toBe(false);
    expect(await refreshAppShortcuts()).toBe(false);
    setPlatform('android', 35);
    mockModule.available = false;
    expect(await refreshAppShortcuts()).toBe(false);
    expect(mockNative.setShortcuts).not.toHaveBeenCalled();
  });
});

describe('Quick Settings tile', () => {
  it('asks Android 13+ to add it in one tap', async () => {
    expect(canRequestCoffeeTile()).toBe(true);
    expect(await requestCoffeeTile()).toBe(true);
    expect(mockNative.requestAddCoffeeTile).toHaveBeenCalledTimes(1);
  });

  it('leaves older Android to the Quick Settings editor', async () => {
    setPlatform('android', 32);
    expect(canRequestCoffeeTile()).toBe(false);
    expect(await requestCoffeeTile()).toBe(false);
    expect(mockNative.requestAddCoffeeTile).not.toHaveBeenCalled();
  });
});
