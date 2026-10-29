jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(() => Promise.resolve(false)),
  getTaskOptionsAsync: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  getStatusAsync: jest.fn(() => Promise.resolve(2)),
  registerTaskAsync: jest.fn(() => Promise.resolve()),
  unregisterTaskAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../state/sync', () => ({ runSync: jest.fn() }));
jest.mock('../../notifications/scheduler', () => ({ replanNotifications: jest.fn(() => Promise.resolve()) }));

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { generateDemoData } from '../../engine/demo';
import { atMinutes } from '../../engine/time';
import { replanNotifications } from '../../notifications/scheduler';
import { useStore } from '../../state/store';
import { runSync } from '../../state/sync';
import { BACKGROUND_INTERVAL_MIN, BACKGROUND_SYNC_TASK, registerBackgroundSync, runBackgroundSync } from '../task';

const NOW = atMinutes('2026-10-21', 8 * 60 + 30);
const sync = runSync as jest.Mock;
const replan = replanNotifications as jest.Mock;
const { Success, Failed } = BackgroundTask.BackgroundTaskResult;

// Captured at import: the task must be defined at module scope for headless runs.
const defineCall = (TaskManager.defineTask as jest.Mock).mock.calls[0];

function setup(settings: Partial<ReturnType<typeof useStore.getState>['settings']> = {}) {
  const demo = generateDemoData(NOW);
  const cur = useStore.getState();
  useStore.setState({
    ...demo,
    profile: { ...demo.profile, onboarded: true },
    settings: { ...cur.settings, dataMode: 'live', lastSync: NOW - 3 * 3600_000, background: { enabled: true }, marks: {}, ...settings },
  });
}

beforeAll(async () => {
  await useStore.persist.rehydrate();
});

beforeEach(() => {
  jest.clearAllMocks();
  sync.mockResolvedValue({ ok: true, message: 'ok', newSessions: 1 });
});

describe('background sync task', () => {
  it('is defined at module scope with the expo-task-manager API', async () => {
    expect(defineCall[0]).toBe(BACKGROUND_SYNC_TASK);
    setup();
    await expect(defineCall[1]({ data: null, error: null, executionInfo: { eventId: '1', taskName: BACKGROUND_SYNC_TASK } })).resolves.toBe(Success);
  });

  it('syncs in background mode, re-plans notifications and records the run', async () => {
    setup();
    const out = await runBackgroundSync(NOW);
    expect(out).toEqual({ result: Success, summary: 'Synced · 1 new sleep' });
    expect(sync).toHaveBeenCalledWith({ background: true });
    expect(replan).toHaveBeenCalledTimes(1);
    const [analysis, state, opts] = replan.mock.calls[0];
    expect(analysis.now).toBe(NOW);
    expect(analysis.lastNightIsCurrent).toBe(true);
    expect(state.settings.dataMode).toBe('live');
    expect(opts).toEqual({ background: true, now: NOW });
    expect(useStore.getState().settings.background).toMatchObject({ enabled: true, lastRun: NOW, lastResult: 'Synced · 1 new sleep' });
  });

  it('still re-plans when Health Connect refuses background reads, and says why', async () => {
    setup();
    sync.mockResolvedValue({ ok: false, code: 'no-background-permission', message: 'Health Connect background access is off.' });
    const out = await runBackgroundSync(NOW);
    expect(out).toEqual({ result: Failed, summary: 'Needs Health Connect background access' });
    expect(replan).toHaveBeenCalledTimes(1);
    expect(useStore.getState().settings.background.lastResult).toBe('Needs Health Connect background access');
  });

  it('skips the sync (but re-plans) right after the open app synced', async () => {
    setup({ lastSync: NOW - 2 * 60_000 });
    expect((await runBackgroundSync(NOW)).summary).toBe('Up to date');
    expect(sync).not.toHaveBeenCalled();
    expect(replan).toHaveBeenCalledTimes(1);
  });

  it('does nothing in demo mode, before onboarding, or when switched off', async () => {
    setup({ dataMode: 'demo' });
    expect((await runBackgroundSync(NOW)).summary).toBe('Skipped — demo data');
    useStore.setState((s) => ({ settings: { ...s.settings, dataMode: 'live' }, profile: { ...s.profile, onboarded: false } }));
    expect((await runBackgroundSync(NOW)).summary).toMatch(/^Skipped/);
    setup({ background: { enabled: false } });
    expect(await runBackgroundSync(NOW)).toEqual({ result: Success, summary: 'Off' });
    expect(useStore.getState().settings.background.lastRun).toBeUndefined();
    expect(sync).not.toHaveBeenCalled();
    expect(replan).not.toHaveBeenCalled();
  });

  it('never throws out of the task', async () => {
    setup();
    sync.mockRejectedValue(new Error('boom'));
    replan.mockRejectedValueOnce(new Error('scheduler down'));
    const out = await runBackgroundSync(NOW);
    expect(out.result).toBe(Failed);
    expect(out.summary).toBe('Error: scheduler down');
    expect(useStore.getState().settings.background.lastResult).toBe('Error: scheduler down');
  });
});

describe('registerBackgroundSync', () => {
  const isRegistered = TaskManager.isTaskRegisteredAsync as jest.Mock;
  const options = TaskManager.getTaskOptionsAsync as jest.Mock;

  it('registers with a ~30 min minimum interval', async () => {
    isRegistered.mockResolvedValue(false);
    await registerBackgroundSync(true);
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(BACKGROUND_SYNC_TASK, { minimumInterval: BACKGROUND_INTERVAL_MIN });
    expect(BACKGROUND_INTERVAL_MIN).toBe(30);
  });

  it('leaves an identical registration alone and replaces one with another interval', async () => {
    isRegistered.mockResolvedValue(true);
    options.mockResolvedValue({ minimumInterval: BACKGROUND_INTERVAL_MIN });
    await registerBackgroundSync(true);
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
    options.mockResolvedValue({ minimumInterval: 720 });
    await registerBackgroundSync(true);
    expect(BackgroundTask.unregisterTaskAsync).toHaveBeenCalledWith(BACKGROUND_SYNC_TASK);
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledTimes(1);
  });

  it('unregisters when switched off and skips registration where background tasks are restricted', async () => {
    isRegistered.mockResolvedValue(true);
    await registerBackgroundSync(false);
    expect(BackgroundTask.unregisterTaskAsync).toHaveBeenCalledWith(BACKGROUND_SYNC_TASK);
    isRegistered.mockResolvedValue(false);
    (BackgroundTask.getStatusAsync as jest.Mock).mockResolvedValueOnce(1);
    await registerBackgroundSync(true);
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });
});
