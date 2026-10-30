jest.mock('expo-notifications', () => ({}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// channels.ts imports every feature; a feature importing back into channels (directly or through
// alarms.ts) would leave FEATURES with `undefined` entries depending on which module loads first.
const ENTRY_POINTS = [
  '../alarms',
  '../napTimer',
  '../fullScreenAlarm',
  '../channels',
  '../scheduler',
  '../features/reminders',
  '../features/liveWindDown',
  '../features/morningReport',
  '../features/missingNight',
  '../features/appUpdates',
];

describe('notification module graph', () => {
  it.each(ENTRY_POINTS)('FEATURES is fully initialised when %s loads first', (entry) => {
    jest.isolateModules(() => {
      require(entry);
      const { FEATURES } = require('../features');
      expect(FEATURES.length).toBeGreaterThan(0);
      for (const f of FEATURES) expect(typeof f?.plan).toBe('function');
    });
  });
});
