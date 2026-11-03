jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { DEFAULT_RUNDOWN } from '../../engine/rundown';
import { AppState, useStore } from '../store';

const merge = (persisted: unknown) => useStore.persist.getOptions().merge!(persisted, useStore.getState()) as AppState;

describe('bedtime rundown settings', () => {
  it('are on with the default steps, also for stores saved before they existed', () => {
    expect(useStore.getState().settings.rundown).toEqual(DEFAULT_RUNDOWN);
    expect(useStore.getState().settings.notifications.phoneDownSoon).toBe(true);
    const old = merge({ settings: { clock: '12h', screensOffMin: 45, notifications: { screensOff: false }, marks: {} } });
    expect(old.settings.rundown).toEqual(DEFAULT_RUNDOWN);
    expect(old.settings.notifications).toMatchObject({ screensOff: false, phoneDownSoon: true });
    expect(old.settings.rundownProgress).toBeUndefined();
  });

  it("keep an old screens-off choice: reading time so phone-down doesn't move", () => {
    expect(merge({ settings: { screensOffMin: 30 } }).settings.rundown.readingMin).toBe(15);
    expect(merge({ settings: { screensOffMin: 60 } }).settings.rundown.readingMin).toBe(45);
    // screensOffMin itself stays (the fallback with the rundown off).
    expect(merge({ settings: { screensOffMin: 60 } }).settings.screensOffMin).toBe(60);
  });

  it('keep what was saved and fill in the rest', () => {
    const saved = merge({ settings: { rundown: { enabled: false, readingMin: 20, off: ['shower'] } } }).settings.rundown;
    expect(saved).toEqual({ ...DEFAULT_RUNDOWN, enabled: false, readingMin: 20, off: ['shower'] });
    const progress = { wakeDate: '2026-11-03', startedAt: 1, since: 2, marks: { tomorrow: { s: 'done', from: 1, to: 2 } } };
    expect(merge({ settings: { rundownProgress: progress } }).settings.rundownProgress).toEqual(progress);
  });
});
