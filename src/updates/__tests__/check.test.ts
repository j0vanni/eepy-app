jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../notifications/channels', () => ({ configureNotifications: jest.fn(() => Promise.resolve()) }));
jest.mock('../current', () => ({
  installedBuild: jest.fn(() => ({ version: '0.2.0', build: 14 })),
  appInForeground: jest.fn(() => false),
  appPackageName: () => 'com.j0vanni.eepy',
  githubClientId: () => undefined,
}));
jest.mock('../token', () => ({ getGithubToken: jest.fn(() => Promise.resolve(undefined)), TOKEN_UNREADABLE: 'unreadable' }));

import type { FetchLike } from '../releases';

const HOUR = 3600_000;
const MIN = 60_000;
const NOW = Date.parse('2026-10-30T18:00:00Z');
const TOKEN = 'github_pat_11AAAAAAA0bbbbbbbbbbbb_cccccccccccccccccccccccccccccccccccccccccccccccccccc';

function release(build: number) {
  return {
    tag_name: `build-${build}`,
    draft: false,
    prerelease: true,
    published_at: '2026-10-30T12:00:00Z',
    html_url: `https://github.com/j0vanni/eepy-app/releases/tag/build-${build}`,
    body: `## What's new\n\n- Change in build ${build}\n- Another fix\n\nAndroid APK built from \`main\` @ abcdef0123456789abcdef0123456789abcdef01.`,
    assets: [{ id: 1000 + build, name: `eepy-0.2.0-build${build}.apk`, size: 1000, state: 'uploaded' }],
  };
}

type MockFetch = jest.Mock<ReturnType<FetchLike>, Parameters<FetchLike>>;
const ok = (builds: number[]): MockFetch =>
  jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => builds.map(release) }));
const failing = (status: number, h: Record<string, string> = {}): MockFetch =>
  jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => ({ ok: false, status, headers: { get: (n: string) => h[n.toLowerCase()] ?? null }, json: async () => ({}) }));

/**
 * Fresh modules (store, status, the once-per-session memory) for every test. Waits for the new
 * store to hydrate, so the hydration can't overwrite what a test sets up afterwards.
 */
async function load(opts: { installed?: number | null; foreground?: boolean; token?: string | Error; persisted?: unknown } = {}) {
  let storage!: { setItem(k: string, v: string): Promise<void> };
  let m!: {
    checkForUpdates: typeof import('../check').checkForUpdates;
    useStore: typeof import('../../state/store').useStore;
    useUpdateStatus: typeof import('../status').useUpdateStatus;
    Notifications: { getPermissionsAsync: jest.Mock; scheduleNotificationAsync: jest.Mock; dismissNotificationAsync: jest.Mock };
  };
  jest.isolateModules(() => {
    const current = require('../current');
    current.installedBuild.mockReturnValue({ version: '0.2.0', build: opts.installed === null ? undefined : (opts.installed ?? 14) });
    current.appInForeground.mockReturnValue(opts.foreground ?? false);
    const getToken = require('../token').getGithubToken;
    if (opts.token instanceof Error) getToken.mockRejectedValue(opts.token);
    else getToken.mockResolvedValue(opts.token);
    storage = require('@react-native-async-storage/async-storage');
    m = {
      checkForUpdates: require('../check').checkForUpdates,
      useStore: require('../../state/store').useStore,
      useUpdateStatus: require('../status').useUpdateStatus,
      Notifications: require('expo-notifications'),
    };
  });
  if (opts.persisted !== undefined) await storage.setItem('eepy-store-v1', JSON.stringify(opts.persisted));
  await m.useStore.persist.rehydrate();
  return m;
}

describe('checkForUpdates', () => {
  it('posts one "tap to update" notification for a newer build from the background and records the check', async () => {
    const { checkForUpdates, useStore, useUpdateStatus, Notifications } = await load();
    const out = await checkForUpdates('background', NOW, ok([13, 15]));
    expect(out).toMatchObject({ status: 'update-available', notified: true, latest: { build: 15 } });
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: 'eepy-update-15',
      content: {
        title: 'eepy build 15 is ready — tap to update',
        body: 'Change in build 15 (+1 more)',
        data: { feature: 'appUpdates', build: 15 },
      },
      trigger: { channelId: 'reports' },
    });
    expect(useStore.getState().settings.updates).toEqual({ autoCheck: true, lastCheck: NOW, latestBuild: 15, notifiedBuild: 15 });
    expect(useUpdateStatus.getState()).toMatchObject({ checking: false, error: undefined, latest: { build: 15, apk: { url: 'https://api.github.com/repos/j0vanni/eepy-app/releases/assets/1015' } } });
  });

  it('never announces a build twice; a newer build replaces the older notification', async () => {
    const { checkForUpdates, Notifications } = await load();
    await checkForUpdates('background', NOW, ok([15]));
    expect((await checkForUpdates('background', NOW + 7 * HOUR, ok([15]))).notified).toBe(false);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    await checkForUpdates('background', NOW + 14 * HOUR, ok([16, 15]));
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('eepy-update-15');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenLastCalledWith(expect.objectContaining({ identifier: 'eepy-update-16' }));

    // After a restart the persisted notifiedBuild still counts.
    const fresh = await load();
    fresh.useStore.setState((s) => ({ settings: { ...s.settings, updates: { autoCheck: true, notifiedBuild: 16 } } }));
    expect((await fresh.checkForUpdates('background', NOW + 21 * HOUR, ok([16]))).notified).toBe(false);
    expect(fresh.Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('runs automatic checks at most every 6 h (manual ones always) and only when switched on', async () => {
    const { checkForUpdates, useStore } = await load();
    useStore.setState((s) => ({ settings: { ...s.settings, updates: { autoCheck: true, lastCheck: NOW - HOUR } } }));
    const fetchFn = ok([14]);
    await expect(checkForUpdates('open', NOW, fetchFn)).resolves.toEqual({ status: 'skipped' });
    await expect(checkForUpdates('background', NOW, fetchFn)).resolves.toEqual({ status: 'skipped' });
    expect(fetchFn).not.toHaveBeenCalled();
    await expect(checkForUpdates('manual', NOW, fetchFn)).resolves.toMatchObject({ status: 'up-to-date' });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    useStore.setState((s) => ({ settings: { ...s.settings, updates: { autoCheck: false } } }));
    await expect(checkForUpdates('background', NOW + 7 * HOUR, fetchFn)).resolves.toEqual({ status: 'skipped' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('never checks automatically or prompts on a development build, but Check now works', async () => {
    const { checkForUpdates, useStore, Notifications } = await load({ installed: null });
    const fetchFn = ok([15]);
    await expect(checkForUpdates('background', NOW, fetchFn)).resolves.toEqual({ status: 'skipped' });
    expect(fetchFn).not.toHaveBeenCalled();
    await expect(checkForUpdates('manual', NOW, fetchFn)).resolves.toMatchObject({ status: 'unknown-build', latest: { build: 15 }, notified: false });
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(useStore.getState().settings.updates).toEqual({ autoCheck: true, lastCheck: NOW, latestBuild: 15 });
  });

  it('lets the in-app banner announce it while eepy is on screen', async () => {
    const { checkForUpdates, useStore, Notifications } = await load({ foreground: true });
    await expect(checkForUpdates('open', NOW, ok([15]))).resolves.toMatchObject({ status: 'update-available', notified: false });
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(useStore.getState().settings.updates.notifiedBuild).toBe(15);
  });

  it('posts nothing without notification permission, and does not keep trying', async () => {
    const { checkForUpdates, useStore, Notifications } = await load();
    Notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: false });
    await expect(checkForUpdates('background', NOW, ok([15]))).resolves.toMatchObject({ notified: false });
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(useStore.getState().settings.updates.notifiedBuild).toBe(15);
  });

  it('keeps failures for the UI and backs off: 15 min after an error, until a rate limit resets', async () => {
    const { checkForUpdates, useStore, useUpdateStatus } = await load();
    await expect(checkForUpdates('background', NOW, failing(502))).resolves.toMatchObject({ status: 'error', error: { kind: 'http' } });
    expect(useUpdateStatus.getState().error?.message).toMatch(/HTTP 502/);
    expect(useStore.getState().settings.updates.lastCheck).toBeUndefined();
    const retry = ok([14]);
    await expect(checkForUpdates('open', NOW + 5 * MIN, retry)).resolves.toEqual({ status: 'skipped' });
    await expect(checkForUpdates('open', NOW + 16 * MIN, retry)).resolves.toMatchObject({ status: 'up-to-date' });
    expect(useUpdateStatus.getState().error).toBeUndefined();

    const reset = String(Math.round((NOW + 7 * HOUR + 40 * MIN) / 1000));
    const limited = failing(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset });
    await expect(checkForUpdates('background', NOW + 7 * HOUR, limited)).resolves.toMatchObject({ error: { kind: 'rate-limit' } });
    await expect(checkForUpdates('background', NOW + 7 * HOUR + 30 * MIN, retry)).resolves.toEqual({ status: 'skipped' });
    await expect(checkForUpdates('background', NOW + 7 * HOUR + 41 * MIN, retry)).resolves.toMatchObject({ status: 'up-to-date' });
  });

  it('shares one request between overlapping checks', async () => {
    const { checkForUpdates } = await load();
    const fetchFn = ok([15]);
    const [a, b] = await Promise.all([checkForUpdates('background', NOW, fetchFn), checkForUpdates('manual', NOW, fetchFn)]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
});

describe('checkForUpdates with a private repository', () => {
  it('sends the stored token as a bearer token', async () => {
    const { checkForUpdates } = await load({ token: TOKEN });
    const fetchFn = ok([15]);
    await checkForUpdates('background', NOW, fetchFn);
    expect(fetchFn.mock.calls[0][1].headers).toEqual({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${TOKEN}` });
  });

  it('stays silent on sign-in problems, remembers them for Settings and throttles as usual', async () => {
    const signedOut = await load();
    await expect(signedOut.checkForUpdates('background', NOW, failing(404))).resolves.toMatchObject({ status: 'error', error: { kind: 'private' } });
    expect(signedOut.useStore.getState().settings.updates).toMatchObject({ authProblem: 'private', lastCheck: NOW });
    expect(signedOut.Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    // Not retried every 15 minutes: it won't fix itself.
    const fetchFn = ok([15]);
    await expect(signedOut.checkForUpdates('background', NOW + HOUR, fetchFn)).resolves.toEqual({ status: 'skipped' });
    expect(fetchFn).not.toHaveBeenCalled();

    const revoked = await load({ token: TOKEN });
    await expect(revoked.checkForUpdates('background', NOW, failing(401))).resolves.toMatchObject({ error: { kind: 'auth' } });
    expect(revoked.useStore.getState().settings.updates.authProblem).toBe('auth');

    const wrongRepo = await load({ token: TOKEN });
    await expect(wrongRepo.checkForUpdates('manual', NOW, failing(404))).resolves.toMatchObject({ error: { kind: 'no-access' } });
    expect(wrongRepo.useStore.getState().settings.updates.authProblem).toBe('no-access');
    // A check that works again clears it.
    await wrongRepo.checkForUpdates('manual', NOW + MIN, ok([14]));
    expect(wrongRepo.useStore.getState().settings.updates.authProblem).toBeUndefined();
  });

  it('keeps the login (and asks nothing) when secure storage can’t be read', async () => {
    const { checkForUpdates, useStore } = await load({ token: new Error('keystore') });
    useStore.setState((s) => ({ settings: { ...s.settings, updates: { autoCheck: true, login: 'j0vanni', authMethod: 'device' } } }));
    const fetchFn = ok([15]);
    await expect(checkForUpdates('manual', NOW, fetchFn)).resolves.toMatchObject({ status: 'error', error: { message: 'unreadable' } });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(useStore.getState().settings.updates).toMatchObject({ login: 'j0vanni', authMethod: 'device' });
  });

  it('forgets a login whose token is gone (e.g. restored from a backup)', async () => {
    const { checkForUpdates, useStore } = await load({ token: undefined });
    useStore.setState((s) => ({ settings: { ...s.settings, updates: { autoCheck: true, login: 'j0vanni', authMethod: 'device' } } }));
    await checkForUpdates('manual', NOW, ok([14]));
    expect(useStore.getState().settings.updates.login).toBeUndefined();
    expect(useStore.getState().settings.updates.authMethod).toBeUndefined();
  });
});

describe('persisted update settings', () => {
  it('fills in the defaults for settings stored before updates existed', async () => {
    const { useStore } = await load({ persisted: { state: { settings: { dataMode: 'live', marks: {} } }, version: 1 } });
    expect(useStore.getState().settings.updates).toEqual({ autoCheck: true });
    useStore.getState().setUpdateSettings({ latestBuild: 15 });
    expect(useStore.getState().settings.updates).toEqual({ autoCheck: true, latestBuild: 15 });
  });
});
