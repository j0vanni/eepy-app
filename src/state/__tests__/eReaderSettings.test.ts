jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { AppState, useStore } from '../store';

const merge = (persisted: unknown) => useStore.persist.getOptions().merge!(persisted, useStore.getState()) as AppState;

describe('e-ink reader settings', () => {
  it('default to off, without a warm light — also for stores saved before they existed', () => {
    expect(useStore.getState().settings.eReader).toEqual({ enabled: false, warmLight: false });
    const old = merge({ settings: { clock: '12h', screensOffMin: 30, marks: {} } });
    expect(old.settings.eReader).toEqual({ enabled: false, warmLight: false });
    expect(old.settings.screensOffMin).toBe(30);
  });

  it('keep what was saved and fill in new fields', () => {
    expect(merge({ settings: { eReader: { enabled: true } } }).settings.eReader).toEqual({ enabled: true, warmLight: false });
    expect(merge({ settings: { eReader: { enabled: true, warmLight: true } } }).settings.eReader).toEqual({ enabled: true, warmLight: true });
  });

  it('are saved through setSettings', () => {
    const { setSettings } = useStore.getState();
    setSettings({ eReader: { ...useStore.getState().settings.eReader, enabled: true } });
    setSettings({ eReader: { ...useStore.getState().settings.eReader, warmLight: true } });
    expect(useStore.getState().settings.eReader).toEqual({ enabled: true, warmLight: true });
    expect(useStore.getState().settings.sleepMode.enabled).toBe(false);
  });
});
