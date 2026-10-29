jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../../integrations/healthConnect', () => ({
  healthConnectStatus: jest.fn(() => Promise.resolve('available')),
  getPermissionState: jest.fn(),
  syncHealthConnect: jest.fn(),
}));

import { Platform } from 'react-native';

import { DAY, HOUR } from '../../engine/time';
import type { SleepSession } from '../../engine/types';
import { getPermissionState, SyncResult, syncHealthConnect } from '../../integrations/healthConnect';
import { useStore } from '../store';
import { runSync } from '../sync';

const perms = getPermissionState as jest.Mock;
const read = syncHealthConnect as jest.Mock;
const NOW = Date.now();

function session(id: string, end: number): SleepSession {
  return { id, source: 'health-connect', origin: 'com.nothing.smartcenter', start: end - 8 * HOUR, end, stages: [{ stage: 'light', start: end - 8 * HOUR, end }] };
}

function result(sessions: SleepSession[]): SyncResult {
  return { from: NOW - 2 * DAY, to: NOW, sessions, vitals: {}, daily: {}, workouts: [], counts: { sessions: sessions.length, heartRate: 0, hrv: 0, spo2: 0, steps: 0, workouts: 0 } };
}

const prevOS = Platform.OS;
beforeAll(() => {
  (Platform as { OS: string }).OS = 'android';
});
afterAll(() => {
  (Platform as { OS: string }).OS = prevOS;
});

beforeEach(() => {
  jest.clearAllMocks();
  const s = useStore.getState();
  useStore.setState({
    sessions: [session('hc:old', NOW - 30 * HOUR)],
    settings: { ...s.settings, dataMode: 'live', lastSync: NOW - 4 * HOUR, lastSyncError: undefined, preferredOrigins: ['com.nothing.smartcenter'] },
  });
});

describe('runSync', () => {
  it('needs Health Connect background access when running in the background', async () => {
    perms.mockResolvedValue({ sleep: true, background: false });
    const out = await runSync({ background: true });
    expect(out).toMatchObject({ ok: false, code: 'no-background-permission' });
    expect(read).not.toHaveBeenCalled();
    // Background hiccups don't show up as foreground sync errors.
    expect(useStore.getState().settings.lastSyncError).toBeUndefined();
  });

  it('syncs in the foreground without background access and counts new sleeps', async () => {
    perms.mockResolvedValue({ sleep: true, background: false });
    read.mockResolvedValue(result([session('hc:old', NOW - 30 * HOUR), session('hc:new', NOW - 6 * HOUR)]));
    const out = await runSync();
    expect(out).toMatchObject({ ok: true, newSessions: 1 });
    expect(useStore.getState().sessions.map((s) => s.id)).toEqual(['hc:old', 'hc:new']);
  });

  it('refuses to wipe stored nights when a background read comes back empty', async () => {
    perms.mockResolvedValue({ sleep: true, background: true });
    read.mockResolvedValue(result([]));
    const out = await runSync({ background: true });
    expect(out).toMatchObject({ ok: false, code: 'suspicious-empty' });
    expect(useStore.getState().sessions.map((s) => s.id)).toEqual(['hc:old']);
  });

  it('records foreground failures as before', async () => {
    perms.mockResolvedValue({ sleep: false, background: false });
    const out = await runSync();
    expect(out).toMatchObject({ ok: false, code: 'no-permission' });
    expect(useStore.getState().settings.lastSyncError).toMatch(/Allow eepy/);
  });

  it('turns a thrown Health Connect error into an outcome', async () => {
    perms.mockResolvedValue({ sleep: true, background: true });
    read.mockRejectedValue(new Error('SecurityException: background read'));
    const out = await runSync({ background: true });
    expect(out).toEqual({ ok: false, code: 'error', message: 'SecurityException: background read' });
    expect(useStore.getState().settings.lastSyncError).toBeUndefined();
  });
});
