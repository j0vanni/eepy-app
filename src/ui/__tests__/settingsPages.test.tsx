/**
 * Render tests for the Settings pages and the setup screens: every page renders, a choice opens in
 * place and writes its store field, the backup's ways out say what happened on the page, the watch
 * history can be re-read, resetting what eepy learned says what it covers, onboarding sets its
 * fields in three steps, the connect screen offers the next step, and the what's-new sheet shows
 * once to people who update.
 */
// Icons load their font asynchronously, which Jest's asset registry can't serve.
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-notifications', () => ({}));
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    navigate: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));
jest.mock('../confirm', () => ({ confirm: jest.fn(() => Promise.resolve(true)), notify: jest.fn() }));
jest.mock('../../integrations/backup', () => ({ saveBackup: jest.fn(), shareBackup: jest.fn(), pickBackup: jest.fn() }));
jest.mock('../../state/sync', () => ({ runSync: jest.fn(), HOURLY_BACKFILL_MARK: 'sync.hourlyBackfill' }));
jest.mock('../../integrations/healthConnect', () => ({
  healthConnectStatus: jest.fn(() => Promise.resolve('available')),
  getPermissionState: jest.fn(),
  requestHealthPermissions: jest.fn(),
  openHealthSettings: jest.fn(),
}));
jest.mock('../../notifications/channels', () => ({ ensureNotificationPermission: jest.fn(() => Promise.resolve(true)), configureNotifications: jest.fn(() => Promise.resolve()) }));
jest.mock('../../integrations/screen', () => ({
  getScreenBrightness: () => Promise.resolve(undefined),
  dimEepy: () => Promise.resolve(),
  undimEepy: () => Promise.resolve(),
  screenControlsSupported: () => false,
}));

import { act } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createRoot, Root, TestInstance } from 'test-renderer';

import ConnectScreen from '../../app/connect';
import Onboarding from '../../app/onboarding';
import type { CalibrationResult } from '../../engine/calibration';
import { atMinutes } from '../../engine/time';
import { pickBackup, saveBackup, shareBackup } from '../../integrations/backup';
import { getPermissionState, requestHealthPermissions } from '../../integrations/healthConnect';
import { LEARNING_RESET_MARK } from '../../state/learning';
import { selectDataset, useStore } from '../../state/store';
import { runSync } from '../../state/sync';
import { confirm } from '../confirm';
import { DataSourcesSection, YourDataSection } from '../settings/DataSection';
import { LearningSection } from '../settings/LearningSection';
import { SettingsPage } from '../settings/pages';
import { SETTINGS_SECTIONS } from '../settings/sections';
import { WHATS_NEW_ID, WHATS_NEW_MARK, WhatsNewContent, WhatsNewSheet } from '../WhatsNew';

// Monday afternoon.
const NOW = atMinutes('2026-11-02', 14 * 60);
const prevOS = Platform.OS;
let root: Root;

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  useStore.getState().loadDemo(NOW);
  useStore.getState().setProfile({ onboarded: true, workdays: [1, 2, 3, 4, 5], workWakeMin: 7 * 60 });
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
const text = () =>
  root.container
    .queryAll((i) => i.type === 'Text')
    .map((i) => i.children.filter((c) => typeof c === 'string').join(''))
    .join('\n');
const EVENT = { nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined, preventDefault: () => undefined };
const button = (label: string): TestInstance | undefined => {
  let n: TestInstance | null | undefined = root.container.queryAll((i) => i.type === 'Text' && i.children.join('') === label)[0];
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  return n ?? undefined;
};
const press = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`no button "${label}" in\n${text()}`);
  await act(async () => target.props.onClick(EVENT));
  await act(async () => undefined);
};
const settings = () => useStore.getState().settings;

describe('Settings pages', () => {
  it.each(SETTINGS_SECTIONS.map((s) => s.id))('the %s page renders', async (id) => {
    await render(<SettingsPage id={id} />);
    expect(root.container.queryAll((i) => i.type === 'Text').length).toBeGreaterThan(3);
  });

  it('opens a choice in place and writes it to the store', async () => {
    useStore.getState().setSettings({ dataMode: 'live', historyDays: 60 });
    await render(<DataSourcesSection />);
    expect(text()).toContain('60 days');
    expect(button('90 days')).toBeUndefined();
    await press('History length');
    await press('90 days');
    expect(settings().historyDays).toBe(90);
    // Picking closes it again; the row shows the new value.
    expect(button('180 days')).toBeUndefined();
    expect(text()).toContain('90 days');
  });
});

describe('Watch and data', () => {
  it('syncs, and re-reads the whole history, saying what happened on the page', async () => {
    useStore.getState().setSettings({ dataMode: 'live', lastSyncError: undefined });
    (runSync as jest.Mock).mockResolvedValue({ ok: true, message: 'Synced 61 sleep sessions and 9,000 heart-rate readings.' });
    await render(<DataSourcesSection />);
    await press('Sync now');
    expect(runSync).toHaveBeenLastCalledWith({ full: false });
    await press('Re-read my whole history');
    expect(runSync).toHaveBeenLastCalledWith({ full: true });
    expect(text()).toContain('Synced 61 sleep sessions');

    (runSync as jest.Mock).mockResolvedValue({ ok: false, code: 'unsupported', message: 'Health Connect is only available on Android.' });
    await press('Sync now');
    expect(text()).toContain('Health Connect is only available on Android.');
    await press('Connection and permissions');
    expect(mockPush).toHaveBeenLastCalledWith('/connect');
  });

  it('offers no sync while the demo data is loaded, and shows the last sync problem', async () => {
    useStore.getState().setSettings({ dataMode: 'demo', lastSyncError: 'Allow eepy to read sleep data in Health Connect.' });
    await render(<DataSourcesSection />);
    expect(button('Sync now')).toBeUndefined();
    expect(button('Re-read my whole history')).toBeUndefined();
    expect(text()).toContain('Allow eepy to read sleep data in Health Connect.');
    expect(text()).toContain('demo data');
  });

  it('saves the backup to a folder, shares it, and says how each went', async () => {
    (Platform as { OS: string }).OS = 'android';
    await render(<YourDataSection />);
    (saveBackup as jest.Mock).mockResolvedValueOnce('saved');
    await press('Save backup to a folder');
    expect(saveBackup).toHaveBeenCalledWith(selectDataset(useStore.getState()));
    expect(text()).toContain('Backup saved to the folder you picked.');

    (saveBackup as jest.Mock).mockResolvedValueOnce('cancelled');
    await press('Save backup to a folder');
    expect(text()).toContain('Cancelled. Nothing was saved.');
    expect(text()).not.toContain('Backup saved');

    (saveBackup as jest.Mock).mockRejectedValueOnce(new Error('The folder is read-only.'));
    await press('Save backup to a folder');
    expect(text()).toContain("Couldn't save the backup. The folder is read-only.");

    (shareBackup as jest.Mock).mockResolvedValueOnce('shared');
    await press('Share backup');
    expect(shareBackup).toHaveBeenCalledTimes(1);
    expect(text()).toContain('The share sheet was opened');

    (shareBackup as jest.Mock).mockRejectedValueOnce(new Error('Sharing is not available on this device.'));
    await press('Share backup');
    expect(text()).toContain("Couldn't share the backup. Sharing is not available on this device.");
  });

  it('restores a backup after asking, and keeps reports, demo data and erase', async () => {
    const data = selectDataset(useStore.getState());
    const kept = { ...data, sessions: data.sessions.slice(0, 5) };
    (pickBackup as jest.Mock).mockResolvedValueOnce(kept);
    await render(<YourDataSection />);
    await press('Restore a backup');
    expect(confirm).toHaveBeenCalledWith('Restore backup?', expect.stringContaining('5 sessions'), 'Restore', true);
    expect(useStore.getState().sessions).toHaveLength(5);
    expect(text()).toContain('Restored 5 sessions');

    (pickBackup as jest.Mock).mockRejectedValueOnce(new Error('That file is not an eepy backup.'));
    await press('Restore a backup');
    expect(text()).toContain("Couldn't restore. That file is not an eepy backup.");

    await press('Reports');
    expect(mockPush).toHaveBeenLastCalledWith('/export');
    await press('Erase everything');
    expect(mockReplace).toHaveBeenCalledWith('/onboarding');
    expect(useStore.getState().profile.onboarded).toBe(false);
    expect(button('Load demo data')).toBeDefined();
  });
});

describe('Energy check-ins', () => {
  it('leads to Energy, sets the reminders, and resets what eepy learned', async () => {
    useStore.getState().setNotificationPrefs({ pings: true, pingsPerDay: 3 });
    useStore.getState().setCalibration({ n: 12, fittedAt: NOW, applied: false } as unknown as CalibrationResult);
    await render(<LearningSection />);
    await press('Energy');
    expect(mockPush).toHaveBeenLastCalledWith('/energy');

    await press('How many a day');
    await press('2 a day');
    expect(settings().notifications.pingsPerDay).toBe(2);
    await press('Check-in reminders');
    expect(settings().notifications.pings).toBe(false);
    expect(button('How many a day')).toBeUndefined();
    const asked = settings().notifications.naturalWakePrompt;
    await press('Natural-wake question');
    expect(settings().notifications.naturalWakePrompt).toBe(!asked);

    await press('Reset what eepy learned');
    expect(confirm).toHaveBeenCalledWith('Reset what eepy learned?', expect.stringContaining('watch signal'), 'Reset', true);
    expect(useStore.getState().calibration).toBeUndefined();
    expect(settings().marks[LEARNING_RESET_MARK]).toBe(NOW);
  });
});

describe('Onboarding', () => {
  it('takes three steps and keeps every field: workdays, wake-up time, birth year', async () => {
    useStore.getState().setProfile({ onboarded: false, birthYear: 1990 });
    useStore.getState().setMark(WHATS_NEW_MARK, undefined);
    await render(<Onboarding />);
    expect(text()).toContain('Welcome to eepy');
    await press('Get started');
    expect(text()).toContain('Step 2 of 3');
    await press('Sat');
    expect(useStore.getState().profile.workdays).toEqual([1, 2, 3, 4, 5, 6]);
    const tap = async (label: string) => {
      const b = root.container.queryAll((i) => i.props.accessibilityLabel === label && typeof i.props.onClick === 'function')[0];
      await act(async () => b.props.onClick(EVENT));
    };
    await tap('Decrease Wake-up on those days');
    expect(useStore.getState().profile.workWakeMin).toBe(6 * 60 + 45);
    await tap('Decrease Birth year');
    expect(useStore.getState().profile.birthYear).toBe(1989);
    await press('Back');
    expect(text()).toContain('Welcome to eepy');
    await press('Get started');
    await press('Next');
    expect(text()).toContain('Step 3 of 3');

    await press('Log sleep by hand');
    expect(useStore.getState().profile.onboarded).toBe(true);
    // New here: the what's-new sheet has nothing to say.
    expect(settings().marks[WHATS_NEW_MARK]).toBe(WHATS_NEW_ID);
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockPush).toHaveBeenLastCalledWith('/log-sleep');
  });

  it('offers the watch on Android, and demo data everywhere', async () => {
    (Platform as { OS: string }).OS = 'android';
    useStore.getState().setProfile({ onboarded: false });
    await render(<Onboarding />);
    await press('Get started');
    await press('Next');
    await press('Connect my watch');
    expect(mockPush).toHaveBeenLastCalledWith('/connect');
    expect(button('Look around with demo data')).toBeDefined();
    expect(button('Skip for now')).toBeDefined();
  });
});

describe('Connect', () => {
  const perms = (over: Record<string, boolean> = {}) => ({ sleep: false, heartRate: false, all: false, background: false, granted: [], ...over });
  beforeEach(() => {
    (getPermissionState as jest.Mock).mockResolvedValue(perms());
  });

  it('says Android only elsewhere', async () => {
    (Platform as { OS: string }).OS = 'ios';
    await render(<ConnectScreen />);
    expect(text()).toContain('Android only');
  });

  it('offers the next step: allow reading, then import, then Today', async () => {
    (Platform as { OS: string }).OS = 'android';
    (getPermissionState as jest.Mock).mockResolvedValue(perms());
    (requestHealthPermissions as jest.Mock).mockResolvedValue(perms({ sleep: true, heartRate: true }));
    (runSync as jest.Mock).mockImplementation(async () => {
      useStore.getState().setSettings({ lastSync: NOW });
      return { ok: true, message: 'Synced 61 sleep sessions and 9,000 heart-rate readings.' };
    });
    await render(<ConnectScreen />);
    expect(text()).toContain('Not connected');
    // The sharing the watch needs, and why heart rate and steps matter in the daytime too.
    expect(text()).toContain('Sleep, Heart rate, Heart rate variability, Blood oxygen, Respiratory rate and Steps');
    expect(text()).toContain('during the day too');
    expect(button('Import my nights')).toBeUndefined();

    await press('Let eepy read your data');
    expect(requestHealthPermissions).toHaveBeenCalled();
    expect(button('Allow the rest')).toBeDefined();
    await press('Import my nights');
    expect(runSync).toHaveBeenCalledWith({ full: true });
    // Importing leaves the demo data behind.
    expect(settings().dataMode).toBe('live');
    expect(text()).toContain('Connected');
    expect(text()).toContain('Synced 61 sleep sessions');
    await press('Go to Today');
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('shows a failed sync as a banner and keeps the step', async () => {
    (Platform as { OS: string }).OS = 'android';
    (getPermissionState as jest.Mock).mockResolvedValue(perms({ sleep: true, heartRate: true, all: true }));
    (runSync as jest.Mock).mockResolvedValue({ ok: false, code: 'error', message: 'Health Connect did not answer.' });
    await render(<ConnectScreen />);
    await press('Import my nights');
    expect(text()).toContain('Health Connect did not answer.');
    expect(button('Import my nights')).toBeDefined();
  });
});

describe("What's new", () => {
  const sheet = (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 900 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <WhatsNewSheet />
    </SafeAreaProvider>
  );

  it('tells about this release', async () => {
    await render(<WhatsNewContent />);
    for (const words of ['Four tabs: Today, Sleep, Plan, More', 'one thing at a time', 'Energy now uses your watch', 'reaction test', 'saved straight to a folder', 'Re-read my whole history']) {
      expect(text()).toContain(words);
    }
    expect(text()).not.toContain('Planner');
  });

  it('shows once to someone who saw the previous one, and leads to Watch and data', async () => {
    useStore.getState().setMark(WHATS_NEW_MARK, 'navigation-2026-11');
    await render(sheet);
    expect(text()).toContain('A new, simpler look');
    await press('Open Watch and data');
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/settings/[section]', params: { section: 'data' } });
    expect(settings().marks[WHATS_NEW_MARK]).toBe(WHATS_NEW_ID);
    expect(text()).toBe('');
  });

  it('stays away before onboarding', async () => {
    useStore.getState().setProfile({ onboarded: false });
    useStore.getState().setMark(WHATS_NEW_MARK, undefined);
    await render(sheet);
    expect(text()).toBe('');
  });
});
