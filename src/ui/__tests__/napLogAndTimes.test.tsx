// Icons load their font asynchronously, which Jest's asset registry can't serve.
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2, MAX: 5 },
  AndroidAudioUsage: { ALARM: 4 },
  AndroidAudioContentType: { SONIFICATION: 4 },
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  setNotificationCategoryAsync: jest.fn(() => Promise.resolve()),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const mockNative = {
  scheduleAlarm: jest.fn((..._args: unknown[]) => Promise.resolve(true)),
  cancelAlarm: jest.fn((_id: string) => Promise.resolve()),
  canUseFullScreenIntent: jest.fn(() => Promise.resolve(true)),
  openFullScreenIntentSettings: jest.fn(() => Promise.resolve()),
};
jest.mock('../../../modules/eepy-alarm', () => ({
  __esModule: true,
  get default() {
    return mockNative;
  },
}));

import { act } from 'react';
import { Platform } from 'react-native';
import { createRoot, Root, TestInstance } from 'test-renderer';

import { analyze } from '../../engine/analysis';
import { atMinutes, MINUTE } from '../../engine/time';
import { napsOn } from '../../state/napLog';
import { selectDataset, useStore } from '../../state/store';
import { NapLogCard } from '../NapLog';
import { WakeCheck } from '../WakeCheck';

/** Logging a nap taken without the timer, and adjusting last night's times from Today. */
const DAY = '2026-11-06';
const prevOS = Platform.OS;
let root: Root;

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  jest.clearAllMocks();
  const now = atMinutes(DAY, 16 * 60);
  jest.spyOn(Date, 'now').mockReturnValue(now);
  (Platform as { OS: string }).OS = 'android';
  useStore.getState().loadDemo(now);
  useStore.getState().setProfile({ onboarded: true });
  useStore.getState().setSettings({ clock: '24h' });
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  (Platform as { OS: string }).OS = prevOS;
  jest.restoreAllMocks();
});

const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
  await act(async () => undefined);
};
const text = () => JSON.stringify(root.container.toJSON());
const find = (test: (i: TestInstance) => boolean) => root.container.queryAll(test)[0];
const press = async (label: string) => {
  let n: TestInstance | null | undefined = find((i) => i.type === 'Text' && i.children.join('').includes(label));
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  if (!n) throw new Error(`no button "${label}"`);
  const target = n;
  await act(async () => target.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined }));
};

describe('NapLogCard', () => {
  it('logs a nap you took (lay down at, how long), lists it, and Undo removes it', async () => {
    await render(<NapLogCard />);
    expect(text()).toContain('Took a nap? Log it');
    await press('Log a nap');
    await press('30 min');
    await press('Log nap');
    const naps = napsOn(useStore.getState().sessions, DAY).filter((n) => n.manual);
    expect(naps).toHaveLength(1);
    expect(naps[0].minutes).toBe(30);
    expect(naps[0].end).toBeLessThanOrEqual(Date.now());
    expect(text()).toContain('Log another nap');
    await press('Undo');
    expect(napsOn(useStore.getState().sessions, DAY).filter((n) => n.manual)).toHaveLength(0);
  });
});

describe('Adjust sleep & wake times (Today)', () => {
  it('always offers fell asleep / woke up / got up, not only when eepy asks', async () => {
    const now = atMinutes(DAY, 9 * 60);
    (Date.now as jest.Mock).mockReturnValue(now);
    const a = analyze(selectDataset(useStore.getState()), now);
    const m = a.lastNight!.main!;
    const t = { ...a.timelines[m.id], confirmed: true };
    await render(<WakeCheck m={m} t={t} />);
    await press('Adjust sleep & wake times');
    expect(text()).toContain('Fell asleep');
    expect(text()).toContain('Woke up');
    expect(text()).toContain('Got up');
    const minus = find((i) => i.props.accessibilityLabel === 'Decrease Woke up' && typeof i.props.onClick === 'function');
    await act(async () => minus!.props.onClick({ nativeEvent: {}, stopPropagation: () => undefined }));
    await press('Save');
    const fix = useStore.getState().wakeLog.fixes[m.id];
    expect(fix?.wake).toBe(t.woke.time - 5 * MINUTE);
  });
});
