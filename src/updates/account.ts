/**
 * Signing in to GitHub for update checks: runs the device flow / checks a pasted token (protocol
 * in ./githubAuth.ts), stores the token (./token.ts) and the login (`settings.updates.login`).
 * Android and iOS only; on web every entry point refuses politely.
 */
import { create } from 'zustand';

import { useStore } from '../state/store';
import { checkForUpdates } from './check';
import { githubClientId } from './current';
import { checkPastedToken, parseLogin, pollForToken, RELEASES_REPO_ID, REPO_URL, requestDeviceCode, USER_URL } from './githubAuth';
import { describeHttpError, type FetchLike, githubHeaders, RELEASES_REPO } from './releases';
import { useUpdateStatus } from './status';
import { clearGithubToken, setGithubToken, tokenStorageSupported } from './token';

export type SignInState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  /** Show `userCode` big; the user enters it at `verificationUri`. */
  | { phase: 'waiting'; userCode: string; verificationUri: string; expiresAt: number }
  | { phase: 'verifying' }
  | { phase: 'done'; message: string }
  | { phase: 'error'; message: string };

export const useSignIn = create<{ state: SignInState }>(() => ({ state: { phase: 'idle' } }));
const setSignIn = (state: SignInState) => useSignIn.setState({ state });

export interface SignInResult {
  ok: boolean;
  message: string;
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);
const NETWORK = 'Couldn’t reach GitHub — check your connection.';

/** Signing in needs secure storage: the Android (or iOS) app, not the browser. */
export function signInSupported(): boolean {
  return tokenStorageSupported();
}

/** "Sign in with GitHub" also needs the GitHub App's client ID in app.json. */
export function deviceSignInSupported(): boolean {
  return signInSupported() && githubClientId() !== undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
  });
}

/** Who a token belongs to, and whether it can see eepy-app. */
export async function verifyToken(token: string, fetchFn: FetchLike = defaultFetch): Promise<{ ok: true; login: string; canSeeRepo: boolean } | { ok: false; message: string }> {
  try {
    const user = await fetchFn(USER_URL, { headers: githubHeaders(token) });
    if (user.status === 401) return { ok: false, message: 'GitHub didn’t accept that token — it may be mistyped, expired or revoked.' };
    if (!user.ok) return { ok: false, message: describeHttpError(user.status, user.headers, Date.now(), true).message };
    const login = parseLogin(await user.json());
    if (!login) return { ok: false, message: 'GitHub’s answer couldn’t be read.' };
    const repo = await fetchFn(REPO_URL, { headers: githubHeaders(token) });
    // 404/403 = can't see it. Other failures (5xx, rate limit) say nothing about access.
    return { ok: true, login, canSeeRepo: repo.ok || (repo.status !== 404 && repo.status !== 403) };
  } catch {
    return { ok: false, message: NETWORK };
  }
}

async function finishSignIn(token: string, method: 'device' | 'token', fetchFn: FetchLike): Promise<SignInResult> {
  const v = await verifyToken(token, fetchFn);
  if (!v.ok) return v;
  if (!v.canSeeRepo && method === 'token') {
    return {
      ok: false,
      message: `That token belongs to @${v.login} but can’t see ${RELEASES_REPO}. Create it with “Only select repositories → eepy-app” and Contents: Read-only.`,
    };
  }
  await setGithubToken(token);
  useStore.getState().setUpdateSettings({ login: v.login, authMethod: method, authProblem: v.canSeeRepo ? undefined : 'no-access' });
  useUpdateStatus.setState({ error: undefined });
  checkForUpdates('manual').catch(() => undefined);
  return {
    ok: true,
    message: v.canSeeRepo
      ? `Signed in as @${v.login}.`
      : `Signed in as @${v.login}, but GitHub won’t show eepy-app to this sign-in yet. The eepy GitHub App has to be installed on the eepy-app repository.`,
  };
}

/** Option 2: a pasted fine-grained personal access token. Nothing is stored unless it works. */
export async function signInWithToken(raw: string, fetchFn: FetchLike = defaultFetch): Promise<SignInResult> {
  if (!signInSupported()) return { ok: false, message: 'Signing in works in the Android app.' };
  const parsed = checkPastedToken(raw);
  if (!parsed.ok) return parsed;
  const r = await finishSignIn(parsed.token, 'token', fetchFn);
  if (r.ok && parsed.kind === 'classic') {
    r.message += ' Tip: a classic token can read all your repositories — a fine-grained one limited to eepy-app is safer.';
  }
  return r;
}

let flow: AbortController | undefined;

/** Option 1: "Sign in with GitHub" (device flow). Progress is in `useSignIn`. Never throws. */
export async function startDeviceSignIn(
  opts: { fetchFn?: FetchLike; now?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
): Promise<void> {
  const fetchFn = opts.fetchFn ?? defaultFetch;
  const now = opts.now ?? Date.now;
  const clientId = githubClientId();
  if (!clientId || !signInSupported()) {
    setSignIn({ phase: 'error', message: 'Sign in with GitHub isn’t set up in this build — use a token instead.' });
    return;
  }
  flow?.abort();
  const mine = new AbortController();
  flow = mine;
  const current = () => flow === mine && !mine.signal.aborted;
  try {
    setSignIn({ phase: 'starting' });
    const code = await requestDeviceCode(fetchFn, clientId, now());
    if (!current()) return;
    if (!code.ok) {
      setSignIn({ phase: 'error', message: code.error.message });
      return;
    }
    const { userCode, verificationUri, expiresAt } = code.device;
    setSignIn({ phase: 'waiting', userCode, verificationUri, expiresAt });
    const r = await pollForToken({ fetchFn, clientId, device: code.device, sleep: opts.sleep ?? sleep, now, signal: mine.signal, repositoryId: RELEASES_REPO_ID });
    if (!current()) return;
    if (!r.ok) {
      setSignIn(r.error.kind === 'cancelled' ? { phase: 'idle' } : { phase: 'error', message: r.error.message });
      return;
    }
    setSignIn({ phase: 'verifying' });
    const done = await finishSignIn(r.token, 'device', fetchFn);
    if (!current()) return;
    const expiring = r.expiresIn
      ? ' Heads-up: this GitHub App hands out tokens that expire after 8 hours. Turn off “Expire user authorization tokens” in its settings, then sign in again.'
      : '';
    setSignIn(done.ok ? { phase: 'done', message: done.message + expiring } : { phase: 'error', message: done.message });
  } catch (e) {
    if (current()) setSignIn({ phase: 'error', message: e instanceof Error ? e.message : NETWORK });
  } finally {
    if (flow === mine) flow = undefined;
  }
}

export function cancelSignIn(): void {
  flow?.abort();
  flow = undefined;
  setSignIn({ phase: 'idle' });
}

/** Forgets the token on this phone. (Revoking it is done on github.com.) */
export async function signOut(): Promise<void> {
  cancelSignIn();
  await clearGithubToken();
  useStore.getState().setUpdateSettings({ login: undefined, authMethod: undefined, authProblem: undefined });
  useUpdateStatus.setState({ error: undefined });
}
