jest.mock('../token', () => ({
  tokenStorageSupported: jest.fn(() => true),
  setGithubToken: jest.fn(() => Promise.resolve()),
  clearGithubToken: jest.fn(() => Promise.resolve()),
  getGithubToken: jest.fn(() => Promise.resolve(undefined)),
}));
jest.mock('../current', () => ({ githubClientId: jest.fn(() => 'Iv23liEXAMPLE0000000'), installedBuild: () => ({ version: '0.2.0', build: 14 }) }));
jest.mock('../check', () => ({ checkForUpdates: jest.fn(() => Promise.resolve({ status: 'up-to-date' })) }));

import { useStore } from '../../state/store';
import { cancelSignIn, signInWithToken, signOut, startDeviceSignIn, useSignIn, type SignInState } from '../account';
import { checkForUpdates } from '../check';
import { githubClientId } from '../current';
import type { FetchLike } from '../releases';
import { clearGithubToken, setGithubToken } from '../token';

const FINE = `github_pat_11ABCDEFG0${'x'.repeat(70)}`;

/** A fake GitHub: answers by URL; `tokenAnswers` are handed out one per poll. */
function github(o: { user?: number; repo?: number; tokenAnswers?: unknown[] } = {}) {
  const calls: Parameters<FetchLike>[] = [];
  const tokenAnswers = [...(o.tokenAnswers ?? [{ access_token: 'ghu_device_token' }])];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push([url, init]);
    const reply = (status: number, body: unknown) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body });
    if (url.startsWith('https://github.com/login/device/code')) {
      return reply(200, { device_code: 'd'.repeat(40), user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    }
    if (url.startsWith('https://github.com/login/oauth/access_token')) return reply(200, tokenAnswers.shift());
    if (url === 'https://api.github.com/user') return reply(o.user ?? 200, { login: 'j0vanni' });
    if (url === 'https://api.github.com/repos/j0vanni/eepy-app') return reply(o.repo ?? 200, { full_name: 'j0vanni/eepy-app', private: true });
    return reply(404, { message: 'Not Found' });
  };
  return { fetchFn, calls };
}

const updates = () => useStore.getState().settings.updates;
const instant = () => Promise.resolve();

beforeAll(async () => {
  await useStore.persist.rehydrate();
});

beforeEach(() => {
  jest.clearAllMocks();
  useStore.setState((s) => ({ settings: { ...s.settings, updates: { autoCheck: true } } }));
  useSignIn.setState({ state: { phase: 'idle' } });
});

describe('signInWithToken', () => {
  it('checks the token with GitHub, then stores it securely and remembers the login', async () => {
    const gh = github();
    const r = await signInWithToken(`  ${FINE}  `, gh.fetchFn);
    expect(r).toEqual({ ok: true, message: 'Signed in as @j0vanni.' });
    expect(gh.calls.map(([url, init]) => [url, init.headers.Authorization])).toEqual([
      ['https://api.github.com/user', `Bearer ${FINE}`],
      ['https://api.github.com/repos/j0vanni/eepy-app', `Bearer ${FINE}`],
    ]);
    expect(setGithubToken).toHaveBeenCalledWith(FINE);
    expect(updates()).toEqual({ autoCheck: true, login: 'j0vanni', authMethod: 'token', authProblem: undefined });
    // The token never lands in the persisted store.
    expect(JSON.stringify(useStore.getState().settings)).not.toContain('github_pat_');
    expect(checkForUpdates).toHaveBeenCalledWith('manual');
  });

  it('stores nothing when the token is malformed, refused, or can’t see eepy-app', async () => {
    const gh = github();
    expect((await signInWithToken('hunter2', gh.fetchFn)).ok).toBe(false);
    expect(gh.calls).toHaveLength(0);
    await expect(signInWithToken(FINE, github({ user: 401 }).fetchFn)).resolves.toMatchObject({ ok: false, message: expect.stringMatching(/didn’t accept/) });
    await expect(signInWithToken(FINE, github({ repo: 404 }).fetchFn)).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(/@j0vanni but can’t see j0vanni\/eepy-app/),
    });
    expect(setGithubToken).not.toHaveBeenCalled();
    expect(updates().login).toBeUndefined();
  });
});

describe('startDeviceSignIn', () => {
  it('shows the user code, polls until GitHub hands out a token, and signs in', async () => {
    const phases: SignInState[] = [];
    const unsub = useSignIn.subscribe((s) => phases.push(s.state));
    const gh = github({ tokenAnswers: [{ error: 'authorization_pending' }, { access_token: 'ghu_device_token' }] });
    await startDeviceSignIn({ fetchFn: gh.fetchFn, sleep: instant });
    unsub();
    expect(phases.map((p) => p.phase)).toEqual(['starting', 'waiting', 'verifying', 'done']);
    expect(phases[1]).toMatchObject({ userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device' });
    expect(setGithubToken).toHaveBeenCalledWith('ghu_device_token');
    expect(updates()).toMatchObject({ login: 'j0vanni', authMethod: 'device' });
    // The token is limited to eepy-app.
    expect(gh.calls.find(([url]) => url.includes('access_token'))?.[0]).toContain('repository_id=1437486542');
  });

  it('signs in but flags it when the GitHub App isn’t installed on eepy-app yet', async () => {
    await startDeviceSignIn({ fetchFn: github({ repo: 404 }).fetchFn, sleep: instant });
    expect(useSignIn.getState().state).toMatchObject({ phase: 'done', message: expect.stringMatching(/installed on the eepy-app repository/) });
    expect(updates()).toMatchObject({ login: 'j0vanni', authProblem: 'no-access' });
  });

  it('warns about expiring tokens (they can’t be refreshed without a client secret)', async () => {
    await startDeviceSignIn({ fetchFn: github({ tokenAnswers: [{ access_token: 'ghu_x', expires_in: 28800, refresh_token: 'ghr_x' }] }).fetchFn, sleep: instant });
    expect(useSignIn.getState().state).toMatchObject({ phase: 'done', message: expect.stringMatching(/Expire user authorization tokens/) });
  });

  it('reports GitHub’s refusal and is unavailable without a client id', async () => {
    await startDeviceSignIn({ fetchFn: github({ tokenAnswers: [{ error: 'access_denied' }] }).fetchFn, sleep: instant });
    expect(useSignIn.getState().state).toEqual({ phase: 'error', message: 'Sign-in was cancelled on GitHub.' });
    (githubClientId as jest.Mock).mockReturnValueOnce(undefined);
    const gh = github();
    await startDeviceSignIn({ fetchFn: gh.fetchFn, sleep: instant });
    expect(useSignIn.getState().state).toMatchObject({ phase: 'error' });
    expect(gh.calls).toHaveLength(0);
    expect(setGithubToken).not.toHaveBeenCalled();
  });

  it('can be cancelled while waiting for the code', async () => {
    const gh = github({ tokenAnswers: [{ access_token: 'ghu_never' }] });
    const sleep = async () => {
      cancelSignIn();
    };
    await startDeviceSignIn({ fetchFn: gh.fetchFn, sleep });
    expect(useSignIn.getState().state).toEqual({ phase: 'idle' });
    expect(gh.calls.some(([url]) => url.includes('access_token'))).toBe(false);
    expect(setGithubToken).not.toHaveBeenCalled();
  });
});

describe('signOut', () => {
  it('deletes the token and forgets the account', async () => {
    useStore.getState().setUpdateSettings({ login: 'j0vanni', authMethod: 'device', authProblem: 'auth' });
    await signOut();
    expect(clearGithubToken).toHaveBeenCalled();
    expect(updates()).toEqual({ autoCheck: true, login: undefined, authMethod: undefined, authProblem: undefined });
  });
});
