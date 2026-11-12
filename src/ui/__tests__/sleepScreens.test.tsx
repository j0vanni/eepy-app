/**
 * Render tests for the Sleep screens on the demo data: the Sleep tab (last night, the three
 * numbers, Nights / Trends and the `view` param), one night, sleep need, log sleep, the journal,
 * and Reports — where the CSV can be saved to a folder or shared, and says what happened.
 */
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

const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), replace: jest.fn(), setParams: jest.fn() };
let mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
  Redirect: () => null,
}));

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

const mockSave = jest.fn((_name: string, _content: string, _mime: string): Promise<'saved' | 'shared' | 'cancelled'> => Promise.resolve('saved'));
jest.mock('../../integrations/backup', () => ({ saveTextToFolder: (name: string, content: string, mime: string) => mockSave(name, content, mime) }));
const mockShareCsv = jest.fn((_csv: string, _name: string): Promise<string> => Promise.resolve('shared'));
const mockSharePdf = jest.fn((_html: string, _base: string): Promise<string> => Promise.resolve('shared'));
jest.mock('../../reports/share', () => ({
  shareCsv: (csv: string, name: string) => mockShareCsv(csv, name),
  shareReportPdf: (html: string, base: string) => mockSharePdf(html, base),
}));
const mockWriteHc = jest.fn((_s: unknown) => Promise.resolve(true));
jest.mock('../../integrations/healthConnect', () => ({ writeSleepToHealthConnect: (s: unknown) => mockWriteHc(s) }));

import { act } from 'react';
import { Alert, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createRoot, Root, TestInstance } from 'test-renderer';

import SleepScreen from '../../app/(tabs)/sleep';
import ExportScreen from '../../app/export';
import JournalScreen from '../../app/journal';
import LogSleepScreen from '../../app/log-sleep';
import NeedScreen from '../../app/need';
import NightScreen from '../../app/night/[id]';
import { analyze } from '../../engine/analysis';
import { drinkOptions } from '../../engine/caffeineHabits';
import { addDays, atMinutes, formatDuration } from '../../engine/time';
import { selectDataset, useStore } from '../../state/store';

const DAY = '2026-11-06';
const NOW = atMinutes(DAY, 10 * 60);
const prevOS = Platform.OS;
let root: Root;

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  (Platform as { OS: string }).OS = 'android';
  useStore.getState().loadDemo(NOW);
  useStore.getState().setProfile({ onboarded: true });
  useStore.getState().setSettings({ clock: '24h' });
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  (Platform as { OS: string }).OS = prevOS;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const analysis = () => analyze(selectDataset(useStore.getState()), NOW);
const render = async (el: React.ReactElement) => {
  await act(async () =>
    root.render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 900 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>{el}</SafeAreaProvider>),
  );
  await act(async () => undefined);
};
const text = () => JSON.stringify(root.container.toJSON());
const press = async (label: string) => {
  let n: TestInstance | null | undefined = root.container.queryAll((i) => i.type === 'Text' && i.children.some((c) => typeof c === 'string' && c.includes(label)))[0];
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  if (!n) throw new Error(`no button "${label}"`);
  const target = n;
  await act(async () => target.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined, preventDefault: () => undefined }));
  await act(async () => undefined);
};

describe('Sleep tab', () => {
  it('opens with last night, then need, debt and the 7-night average, then the list of nights', async () => {
    const a = analysis();
    const last = a.lastNight!.main!;
    await render(<SleepScreen />);
    const s = text();
    expect(s).toContain(formatDuration(last.totalSleepMin));
    expect(s).toContain(a.scores[last.id].label);
    expect(s).toContain('SLEEP NEED');
    expect(s).toContain('SLEEP DEBT');
    expect(s).toContain('7-NIGHT AVERAGE');
    expect(s).toContain(formatDuration(a.need.needMin));
    // Nights is the default half; Trends (and its insights) are one tap away.
    expect(s).toContain('Log a night yourself');
    expect(s).not.toContain('What affects your sleep');
    await press('Trends');
    expect(text()).toContain('What affects your sleep');
    expect(text()).not.toContain('Log a night yourself');
    await press('Month calendar');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/calendar', params: { date: last.wakeDate } });
  });

  it('tapping last night opens that night', async () => {
    const last = analysis().lastNight!.main!;
    await render(<SleepScreen />);
    await press(formatDuration(last.totalSleepMin));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/night/[id]', params: { id: last.id } });
  });

  it('honours the view param: trends opens Trends, calendar opens the month calendar', async () => {
    jest.useFakeTimers({ doNotFake: ['Date'] });
    mockParams = { view: 'trends' };
    await render(<SleepScreen />);
    expect(text()).toContain('What affects your sleep');
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(mockRouter.setParams).toHaveBeenCalledWith({ view: undefined });
    expect(mockRouter.push).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    root = createRoot();
    mockParams = { view: 'calendar' };
    await render(<SleepScreen />);
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/calendar', params: { date: analysis().lastNight!.wakeDate } });
  });
});

describe('Night', () => {
  it('shows time asleep and the score, the times in order with a way to correct them, stages and the journal', async () => {
    const a = analysis();
    const last = a.lastNight!.main!;
    mockParams = { id: last.id };
    await render(<NightScreen />);
    const s = text();
    expect(s).toContain(formatDuration(last.totalSleepMin));
    expect(s).toContain(a.scores[last.id].label);
    for (const label of ['Times', 'In bed', 'Fell asleep', 'Woke up', 'Out of bed', 'Stages', 'Fell asleep in', 'Awake in the night', 'Your journal']) expect(s).toContain(label);
    // A watch night can't be deleted.
    expect(s).not.toContain('Delete this entry');
    await press('The evening before');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/journal', params: { date: addDays(last.wakeDate, -1) } });
  });

  it('a night you logged by hand can be deleted', async () => {
    const start = atMinutes('2026-11-05', 13 * 60);
    const id = `manual-${start}`;
    useStore.getState().addManualSession({ id, source: 'manual', start, end: start + 30 * 60_000, kind: 'nap', stages: [{ stage: 'asleep', start, end: start + 30 * 60_000 }] });
    mockParams = { id };
    await render(<NightScreen />);
    expect(text()).toContain('Logged by you');
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      const buttons = args[2] as { text: string; onPress?: () => void }[];
      buttons.find((b) => b.text === 'Delete')?.onPress?.();
    });
    await press('Delete this entry');
    expect(useStore.getState().sessions.find((x) => x.id === id)).toBeUndefined();
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('Sleep need', () => {
  it('opens with the need, then the debt and how to pay it back, then the evidence', async () => {
    const a = analysis();
    await render(<NeedScreen />);
    const s = text();
    expect(s).toContain('You need about');
    expect(s).toContain(formatDuration(a.need.needMin));
    expect(s).toContain('You owe');
    if (a.debt.payoff) expect(s).toContain('To pay it back');
    expect(s).toContain(a.need.evidence[0].label);
    // The long explanation is folded away until asked for.
    expect(s).not.toContain('Genes make a real difference');
    await press('How eepy works this out');
    expect(text()).toContain('Genes make a real difference');
    await press('Set it yourself');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/settings/[section]', params: { section: 'you' } });
  });
});

describe('Log sleep', () => {
  it('saves a night with its rating and how you woke up, and goes back', async () => {
    const before = useStore.getState().sessions.filter((x) => x.source === 'manual').length;
    mockParams = { date: '2026-11-04' };
    await render(<LogSleepScreen />);
    expect(text()).toContain('Went to bed');
    await press('Yes');
    const face = root.container.queryAll((i) => i.props.accessibilityLabel === 'Rate 4 of 5' && typeof i.props.onClick === 'function')[0];
    await act(async () => face.props.onClick({ nativeEvent: {}, stopPropagation: () => undefined }));
    await press('Save night');
    const manual = useStore.getState().sessions.filter((x) => x.source === 'manual');
    expect(manual).toHaveLength(before + 1);
    expect(useStore.getState().dayLogs['2026-11-04']).toMatchObject({ sleepRating: 4, wokeNaturally: true });
    expect(mockWriteHc).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('a nap has no morning questions', async () => {
    await render(<LogSleepScreen />);
    await press('A nap');
    expect(text()).toContain('Lay down at');
    expect(text()).not.toContain('How did you sleep?');
    await press('Save nap');
    expect(useStore.getState().sessions.some((x) => x.source === 'manual' && x.kind === 'nap')).toBe(true);
  });
});

describe('Journal', () => {
  it('opens the day from the date param and saves as you tap', async () => {
    mockParams = { date: '2026-11-03' };
    await render(<JournalScreen />);
    expect(text()).toContain('Tue 3 Nov');
    const face = root.container.queryAll((i) => i.props.accessibilityLabel === 'Rate 2 of 5' && typeof i.props.onClick === 'function')[0];
    await act(async () => face.props.onClick({ nativeEvent: {}, stopPropagation: () => undefined }));
    await press('No, alarm or woken');
    await press('4 · Good');
    expect(useStore.getState().dayLogs['2026-11-03']).toMatchObject({ sleepRating: 2, wokeNaturally: false, energy: 4 });
    const drinks = useStore.getState().caffeine.length;
    const drink = drinkOptions(useStore.getState().settings.customDrinks)[0];
    await press(`${drink.label} · ${drink.mg} mg`);
    expect(useStore.getState().caffeine).toHaveLength(drinks + 1);
    await press('Log sleep or a nap yourself');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/log-sleep', params: { date: '2026-11-03' } });
  });
});

describe('Reports', () => {
  it('"Save to a folder" writes the CSV where you choose and says so', async () => {
    await render(<ExportScreen />);
    expect(text()).toContain('Save to a folder');
    await press('Save to a folder');
    expect(mockSave).toHaveBeenCalledTimes(1);
    const [name, content, mime] = mockSave.mock.calls[0];
    expect(name).toBe('eepy-nights-2026-11-06.csv');
    expect(mime).toBe('text/csv');
    // UTF-8 byte-order mark, then the header row.
    expect(content.charCodeAt(0)).toBe(0xfeff);
    expect(content.slice(1, 5)).toBe('date');
    expect(text()).toContain('Saved eepy-nights-2026-11-06.csv to the folder you picked.');
    expect(mockShareCsv).not.toHaveBeenCalled();
  });

  it('says when the folder picker was cancelled, and shows an error instead of failing silently', async () => {
    await render(<ExportScreen />);
    mockSave.mockResolvedValueOnce('cancelled');
    await press('Save to a folder');
    expect(text()).toContain('Cancelled. Nothing was saved.');
    mockSave.mockRejectedValueOnce(new Error('No write access to that folder.'));
    await press('Save to a folder');
    expect(text()).toContain('No write access to that folder.');
    expect(text()).not.toContain('Cancelled. Nothing was saved.');
  });

  it('"Share" still uses the share sheet, and its errors are shown too', async () => {
    await render(<ExportScreen />);
    await press('Share');
    expect(mockShareCsv).toHaveBeenCalledTimes(1);
    expect(mockShareCsv.mock.calls[0][1]).toBe('eepy-nights-2026-11-06.csv');
    expect(text()).toContain('The share sheet was opened.');
    mockShareCsv.mockRejectedValueOnce(new Error('Sharing is not available on this device.'));
    await press('Share');
    expect(text()).toContain('Sharing is not available on this device.');
  });

  it('the PDF goes to the share sheet and a failure is shown on the screen', async () => {
    await render(<ExportScreen />);
    await press('Create and share PDF');
    expect(mockSharePdf).toHaveBeenCalledTimes(1);
    expect(mockSharePdf.mock.calls[0][0]).toContain('<html');
    expect(text()).toContain('the share sheet opened');
    mockSharePdf.mockRejectedValueOnce(new Error('Printing failed.'));
    await press('Create and share PDF');
    expect(text()).toContain('Printing failed.');
  });
});
