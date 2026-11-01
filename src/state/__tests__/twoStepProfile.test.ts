jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { DEFAULT_TWO_STEP } from '../../engine/twoStep';
import { AppState, useStore } from '../store';

const merge = (persisted: unknown) => useStore.persist.getOptions().merge!(persisted, useStore.getState()) as AppState;

describe('two-step morning setting in the stored profile', () => {
  it('is off for profiles saved before it existed', () => {
    expect(useStore.getState().profile.twoStepMorning).toBeUndefined();
    const old = merge({ profile: { workWakeMin: 365, workdays: [1, 2, 3, 4, 5], onboarded: true } });
    expect(old.profile.twoStepMorning).toBeUndefined();
    expect(old.profile.workWakeMin).toBe(365);
    expect(old.profile.windDownMin).toBe(60);
  });

  it('keeps what was saved and fills in missing fields', () => {
    const saved = merge({ profile: { twoStepMorning: { enabled: true, firstWakeMin: 290 } } });
    expect(saved.profile.twoStepMorning).toEqual({ ...DEFAULT_TWO_STEP, enabled: true, firstWakeMin: 290 });
  });
});
