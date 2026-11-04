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
import { atMinutes } from '../../engine/time';
import { resetWakeAlarmMemo, WAKE_AT_MARK, WAKE_FINAL_SKIP_MARK } from '../../notifications/fullScreenAlarm';
import { selectDataset, useStore } from '../../state/store';
import { EarlyUpCard } from '../today/EarlyUp';

/**
 * "I'm up" before the alarm on Today (state/earlyUp.ts): the offer, the "Up at …" confirmation and Undo.
 */
const MON_EVE = atMinutes('2026-11-02', 21 * 60);
const TUE = '2026-11-03';
const prevOS = Platform.OS;
let root: Root;

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  jest.clearAllMocks();
  resetWakeAlarmMemo();
  jest.spyOn(Date, 'now').mockReturnValue(MON_EVE);
  (Platform as { OS: string }).OS = 'android';
  useStore.getState().loadDemo(MON_EVE);
  useStore.getState().setProfile({ onboarded: true, twoStepMorning: undefined, wakePlan: {} });
  useStore.getState().setNotificationPrefs({ smartAlarm: true });
  useStore.getState().setSettings({ clock: '24h', marks: {}, session: undefined });
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

describe('EarlyUpCard', () => {
  it('woke before the alarm: "I\'m up", then "Up at …" with Undo', async () => {
    const before = analyze(selectDataset(useStore.getState()), atMinutes(TUE, 3 * 60));
    useStore.getState().setSettings({ marks: { [WAKE_AT_MARK]: before.tonight.wake } });
    const now = atMinutes(TUE, 4 * 60 + 45);
    (Date.now as jest.Mock).mockReturnValue(now);
    const a = analyze(selectDataset(useStore.getState()), now);
    await render(<EarlyUpCard a={a} now={now} night />);
    expect(text()).toContain('UP BEFORE YOUR ALARM?');
    expect(text()).toContain("turns off this morning's 07:00 alarm");
    await press("I'm up");
    expect(useStore.getState().settings.marks[WAKE_FINAL_SKIP_MARK]).toBe(TUE);
    expect(text()).toContain('04:45');
    expect(text()).toContain("This morning's alarms are off.");
    await press('Undo');
    expect(useStore.getState().settings.marks[WAKE_FINAL_SKIP_MARK]).toBeUndefined();
    expect(text()).toContain('UP BEFORE YOUR ALARM?');
  });

  it('not offered in the middle of the night or after the alarm', async () => {
    const at3 = atMinutes(TUE, 2 * 60 + 30);
    (Date.now as jest.Mock).mockReturnValue(at3);
    await render(<EarlyUpCard a={analyze(selectDataset(useStore.getState()), at3)} now={at3} night />);
    expect(root.container.children).toHaveLength(0);
    const at8 = atMinutes(TUE, 8 * 60);
    (Date.now as jest.Mock).mockReturnValue(at8);
    await render(<EarlyUpCard a={analyze(selectDataset(useStore.getState()), at8)} now={at8} />);
    expect(root.container.children).toHaveLength(0);
  });
});
