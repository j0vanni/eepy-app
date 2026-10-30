/**
 * Render smoke tests for Settings → App updates, including the Android-only states (sign-in,
 * device code, download progress) that the web preview can't show.
 */
// Icons load their font asynchronously, which Jest's asset registry can't serve.
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../updates/token', () => ({
  tokenStorageSupported: () => true,
  getGithubToken: jest.fn(() => Promise.resolve(undefined)),
  setGithubToken: jest.fn(() => Promise.resolve()),
  clearGithubToken: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../updates/current', () => ({
  installedBuild: () => ({ version: '0.2.0', build: 14 }),
  githubClientId: jest.fn(() => undefined),
  appInForeground: () => true,
  appPackageName: () => 'com.j0vanni.eepy',
}));
jest.mock('../../updates/check', () => ({ checkForUpdates: jest.fn(() => Promise.resolve({ status: 'skipped' })) }));
jest.mock('../../updates/install', () => ({
  canInstallUpdates: () => true,
  downloadAndInstall: jest.fn(() => Promise.resolve()),
  openInstallPermissionSettings: jest.fn(() => Promise.resolve()),
}));

import * as Clipboard from 'expo-clipboard';
import { act } from 'react';
import { Linking } from 'react-native';
import { createRoot, Root, TestInstance } from 'test-renderer';

import { useStore } from '../../state/store';
import { useSignIn } from '../../updates/account';
import { githubClientId } from '../../updates/current';
import { parseReleases } from '../../updates/releases';
import { useUpdateStatus } from '../../updates/status';
import { GitHubAccount } from '../settings/GitHubAccount';
import { UpdatesSection } from '../settings/UpdatesSection';

let root: Root;
beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  root = createRoot();
  useStore.setState((s) => ({ settings: { ...s.settings, updates: { autoCheck: true } } }));
  useSignIn.setState({ state: { phase: 'idle' } });
  useUpdateStatus.setState({ checking: false, latest: undefined, error: undefined, lastAttempt: 1, download: { phase: 'idle' } });
});
afterEach(async () => {
  await act(async () => root.unmount());
});

const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
};
const text = () => JSON.stringify(root.container.toJSON());
/** The pressable around a button's label (Pressability puts `onClick` on the host View). */
const button = (label: string): TestInstance | undefined => {
  let n: TestInstance | null | undefined = root.container.queryAll((i) => i.type === 'Text' && i.children.includes(label))[0];
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  return n ?? undefined;
};
const press = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`no button "${label}"`);
  // A non-pointer click on the pressable itself (target === currentTarget) runs onPress.
  await act(async () => target.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined }));
};

describe('GitHubAccount', () => {
  it('offers a token until the GitHub App client id is configured', async () => {
    await render(<GitHubAccount />);
    expect(button('Paste a GitHub token')).toBeDefined();
    expect(button('Sign in with GitHub')).toBeUndefined();
    expect(text()).toContain('expo.extra.githubClientId');
  });

  it('offers "Sign in with GitHub" with a client id, and shows the code to enter', async () => {
    (githubClientId as jest.Mock).mockReturnValue('Iv23liEXAMPLE0000000');
    await render(<GitHubAccount />);
    expect(button('Sign in with GitHub')).toBeDefined();
    expect(button('Use a token instead')).toBeDefined();

    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await act(async () => useSignIn.setState({ state: { phase: 'waiting', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresAt: Date.now() + 600_000 } }));
    expect(text()).toContain('WDJB-MJHT');
    await press('Copy code & open github.com/login/device');
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('WDJB-MJHT');
    expect(openURL).toHaveBeenCalledWith('https://github.com/login/device');
    (githubClientId as jest.Mock).mockReturnValue(undefined);
  });

  it('shows the token steps and the pre-filled link', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<GitHubAccount />);
    await press('Paste a GitHub token');
    expect(text()).toContain('Only select repositories');
    await press('Create the token on GitHub');
    expect(openURL.mock.lastCall?.[0]).toMatch(/^https:\/\/github\.com\/settings\/personal-access-tokens\/new\?name=eepy/);
  });

  it('shows who is signed in, and asks to sign in again when the token stopped working', async () => {
    useStore.getState().setUpdateSettings({ login: 'j0vanni', authMethod: 'device', authProblem: 'auth' });
    await render(<GitHubAccount />);
    expect(text()).toContain('j0vanni');
    expect(button('Sign out')).toBeDefined();
    expect(button('Sign in again')).toBeDefined();
    expect(text()).toContain('github.com/settings/applications');
  });
});

describe('UpdatesSection', () => {
  const [latest] = parseReleases([
    {
      tag_name: 'build-15',
      draft: false,
      published_at: new Date().toISOString(),
      body: "## What's new\n\n- Faster sync\n- Fix the nap alarm",
      assets: [{ id: 7, name: 'eepy-0.2.0-build15.apk', size: 51_771_954, state: 'uploaded' }],
    },
  ])!;

  it('offers the newer build with its changelog, then shows download progress', async () => {
    useStore.getState().setUpdateSettings({ login: 'j0vanni', authMethod: 'token', latestBuild: 15, lastCheck: Date.now() });
    useUpdateStatus.setState({ latest });
    await render(<UpdatesSection />);
    expect(text()).toContain('Build 15 is ready');
    expect(text()).toContain('Fix the nap alarm');
    expect(button('Update to build 15 (49.4 MB)')).toBeDefined();
    expect(button('Allow installs from eepy')).toBeDefined();
    await act(async () => useUpdateStatus.setState({ download: { phase: 'downloading', build: 15, written: 23_000_000, total: 51_771_954 } }));
    expect(text()).toContain('Downloading… 44%');
    await act(async () => useUpdateStatus.setState({ download: { phase: 'installing', build: 15 } }));
    expect(text()).toContain('installer is open');
  });

  it('explains a private repo without repeating the error', async () => {
    useStore.getState().setUpdateSettings({ authProblem: 'private', lastCheck: Date.now() });
    useUpdateStatus.setState({ error: { kind: 'private', message: 'eepy-app is private — sign in with GitHub to check for updates.' } });
    await render(<UpdatesSection />);
    expect(text().split('eepy-app is private — sign in').length - 1).toBe(1);
  });
});
