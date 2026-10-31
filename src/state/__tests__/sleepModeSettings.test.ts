jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { AppState, useStore } from '../store';

const merge = (persisted: unknown) => useStore.persist.getOptions().merge!(persisted, useStore.getState()) as AppState;

describe('bedtime autopilot settings', () => {
  it('default to off, at lights-out, offering sleep sounds — also for stores saved before they existed', () => {
    expect(useStore.getState().settings.sleepMode).toEqual({ enabled: false, startAt: 'lightsout', offerSounds: true });
    const old = merge({ settings: { clock: '12h', marks: {} } });
    expect(old.settings.sleepMode).toEqual({ enabled: false, startAt: 'lightsout', offerSounds: true });
    expect(old.settings.clock).toBe('12h');
  });

  it('keep what was saved and fill in new fields', () => {
    const saved = merge({ settings: { sleepMode: { enabled: true, startAt: 'winddown' } } });
    expect(saved.settings.sleepMode).toEqual({ enabled: true, startAt: 'winddown', offerSounds: true });
  });

  it('are patched by setSleepModeSettings', () => {
    useStore.getState().setSleepModeSettings({ enabled: true });
    useStore.getState().setSleepModeSettings({ offerSounds: false });
    expect(useStore.getState().settings.sleepMode).toEqual({ enabled: true, startAt: 'lightsout', offerSounds: false });
  });
});
