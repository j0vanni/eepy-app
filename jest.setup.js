// Native modules that tests reach indirectly (the persisted store) get their official mocks.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
// The sleep-sound player (src/audio/player.ts) is reached through the sleep session (src/state/inBed.ts);
// expo-audio has no Jest mock of its own, so a silent player. src/audio/__tests__/player.test.ts mocks it in detail.
jest.mock('expo-audio', () => ({
  setAudioModeAsync: () => Promise.resolve(),
  createAudioPlayer: () => ({
    loop: false,
    volume: 1,
    play() {},
    pause() {},
    remove() {},
    addListener: () => ({ remove() {} }),
    setActiveForLockScreen() {},
    clearLockScreenControls() {},
    updateLockScreenMetadata() {},
  }),
}));
