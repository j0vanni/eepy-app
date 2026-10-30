/**
 * Signing in to GitHub so eepy can read releases of the private eepy-app repository: the pure
 * part (no React or native imports, unit-tested). Two ways in:
 *
 * 1. "Sign in with GitHub": the OAuth device flow of a GitHub App (RFC 8628). eepy asks
 *    github.com for a user code, the user types it at github.com/login/device, and eepy polls for
 *    the token. No client secret is involved, so the app's "Expire user authorization tokens"
 *    must be off (refreshing an expiring token needs the secret).
 * 2. Paste a fine-grained personal access token with read-only Contents on eepy-app.
 *
 * The token itself is stored by ./token.ts (expo-secure-store); only the login name is kept in
 * the persisted store.
 */
import { RELEASES_REPO, type FetchLike } from './releases';

export const DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
export const DEVICE_VERIFICATION_URL = 'https://github.com/login/device';
export const USER_URL = 'https://api.github.com/user';
export const REPO_URL = `https://api.github.com/repos/${RELEASES_REPO}`;
/** j0vanni/eepy-app. Passed as `repository_id` so a device-flow token can only see that repo. */
export const RELEASES_REPO_ID = 1437486542;
export const AUTHORIZED_APPS_URL = 'https://github.com/settings/applications';
export const TOKENS_URL = 'https://github.com/settings/personal-access-tokens';

const SECOND = 1000;
/** GitHub's documented defaults when a response leaves them out. */
const DEFAULT_INTERVAL_S = 5;
const DEFAULT_EXPIRES_S = 900;
/** Consecutive network failures while polling before giving up. */
const MAX_POLL_FAILURES = 4;

export type SignInErrorKind = 'expired' | 'denied' | 'disabled' | 'bad-client' | 'network' | 'cancelled' | 'rejected' | 'unknown';

export interface SignInError {
  kind: SignInErrorKind;
  message: string;
}

export interface DeviceCode {
  deviceCode: string;
  /** "WDJB-MJHT": shown big for the user to type at verificationUri. */
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  /** Seconds between token polls. */
  interval: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);

const OAUTH_ERRORS: Record<string, SignInError> = {
  expired_token: { kind: 'expired', message: 'The code expired before it was entered. Start again for a new one.' },
  token_expired: { kind: 'expired', message: 'The code expired before it was entered. Start again for a new one.' },
  incorrect_device_code: { kind: 'expired', message: 'GitHub no longer recognises that code. Start again for a new one.' },
  bad_verification_code: { kind: 'expired', message: 'GitHub no longer recognises that code. Start again for a new one.' },
  access_denied: { kind: 'denied', message: 'Sign-in was cancelled on GitHub.' },
  device_flow_disabled: { kind: 'disabled', message: 'Device sign-in is turned off for the eepy GitHub App (enable "Device Flow" in its settings).' },
  incorrect_client_credentials: { kind: 'bad-client', message: 'GitHub doesn’t know the client ID in app.json (extra.githubClientId).' },
  unsupported_grant_type: { kind: 'unknown', message: 'GitHub refused the sign-in request (unsupported grant type).' },
};

function oauthError(json: Record<string, unknown>): SignInError {
  const code = typeof json.error === 'string' ? json.error : '';
  const known = OAUTH_ERRORS[code];
  if (known) return known;
  const detail = typeof json.error_description === 'string' ? json.error_description : code || 'no details';
  return { kind: 'unknown', message: `GitHub sign-in failed: ${detail}.` };
}

/** The answer to `POST /login/device/code`. */
export function parseDeviceCodeResponse(json: unknown, now: number): { ok: true; device: DeviceCode } | { ok: false; error: SignInError } {
  if (!isObject(json)) return { ok: false, error: { kind: 'unknown', message: 'GitHub’s answer couldn’t be read.' } };
  if (json.error !== undefined) return { ok: false, error: oauthError(json) };
  const { device_code, user_code, verification_uri } = json;
  if (typeof device_code !== 'string' || typeof user_code !== 'string' || !device_code || !user_code) {
    // e.g. {"message":"Not Found"} for an unknown client ID.
    return { ok: false, error: { kind: 'bad-client', message: 'GitHub didn’t hand out a sign-in code. Check the client ID in app.json (extra.githubClientId).' } };
  }
  return {
    ok: true,
    device: {
      deviceCode: device_code,
      userCode: user_code,
      // Only ever send people to github.com.
      verificationUri: typeof verification_uri === 'string' && verification_uri.startsWith('https://github.com/') ? verification_uri : DEVICE_VERIFICATION_URL,
      expiresAt: now + positive(json.expires_in, DEFAULT_EXPIRES_S) * SECOND,
      interval: positive(json.interval, DEFAULT_INTERVAL_S),
    },
  };
}

export type PollStep =
  | { type: 'token'; token: string; /** Seconds until it expires (only when the app issues expiring tokens). */ expiresIn?: number }
  | { type: 'pending'; interval: number }
  | { type: 'slow-down'; interval: number }
  | { type: 'failed'; error: SignInError };

/** One answer from polling `POST /login/oauth/access_token`. GitHub sends errors with HTTP 200. */
export function interpretTokenResponse(json: unknown, interval: number): PollStep {
  if (!isObject(json)) return { type: 'failed', error: { kind: 'unknown', message: 'GitHub’s answer couldn’t be read.' } };
  if (typeof json.access_token === 'string' && json.access_token) {
    return { type: 'token', token: json.access_token, expiresIn: typeof json.expires_in === 'number' ? json.expires_in : undefined };
  }
  if (json.error === 'authorization_pending') return { type: 'pending', interval };
  // GitHub adds 5 s and says the new interval; never go faster than before.
  if (json.error === 'slow_down') return { type: 'slow-down', interval: Math.max(positive(json.interval, 0), interval + 5) };
  return { type: 'failed', error: oauthError(json) };
}

const query = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

/** Step 1: ask github.com for a device + user code. */
export async function requestDeviceCode(fetchFn: FetchLike, clientId: string, now: number): Promise<{ ok: true; device: DeviceCode } | { ok: false; error: SignInError }> {
  try {
    const res = await fetchFn(`${DEVICE_CODE_URL}?${query({ client_id: clientId })}`, { method: 'POST', headers: { Accept: 'application/json' } });
    return parseDeviceCodeResponse(await res.json().catch(() => undefined), now);
  } catch {
    return { ok: false, error: { kind: 'network', message: 'Couldn’t reach GitHub — check your connection.' } };
  }
}

export interface PollOptions {
  fetchFn: FetchLike;
  clientId: string;
  device: DeviceCode;
  /** Resolves after `ms`, or early when `signal` aborts. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
  signal?: AbortSignal;
  repositoryId?: number;
}

/**
 * Step 2: poll for the token until the user enters the code, cancels, or the code expires.
 * Never polls faster than `interval` (GitHub answers `slow_down` and adds 5 s if we do).
 */
export async function pollForToken(o: PollOptions): Promise<{ ok: true; token: string; expiresIn?: number } | { ok: false; error: SignInError }> {
  const cancelled = { ok: false as const, error: { kind: 'cancelled' as const, message: 'Sign-in cancelled.' } };
  let interval = o.device.interval;
  let failures = 0;
  const params = query({
    client_id: o.clientId,
    device_code: o.device.deviceCode,
    grant_type: DEVICE_GRANT_TYPE,
    ...(o.repositoryId ? { repository_id: String(o.repositoryId) } : {}),
  });
  for (;;) {
    await o.sleep(interval * SECOND, o.signal);
    if (o.signal?.aborted) return cancelled;
    if (o.now() >= o.device.expiresAt) return { ok: false, error: OAUTH_ERRORS.expired_token };
    let step: PollStep;
    try {
      const res = await o.fetchFn(`${ACCESS_TOKEN_URL}?${params}`, { method: 'POST', headers: { Accept: 'application/json' }, signal: o.signal });
      step = interpretTokenResponse(await res.json(), interval);
      failures = 0;
    } catch {
      if (o.signal?.aborted) return cancelled;
      if (++failures >= MAX_POLL_FAILURES) return { ok: false, error: { kind: 'network', message: 'Lost the connection to GitHub while waiting. Try again.' } };
      continue;
    }
    if (step.type === 'token') return { ok: true, token: step.token, expiresIn: step.expiresIn };
    if (step.type === 'failed') return { ok: false, error: step.error };
    interval = step.interval;
  }
}

export type TokenKind = 'fine-grained' | 'classic' | 'app';

/** A pasted token, tidied (spaces, quotes, "Bearer ") and recognised by its prefix. */
export function checkPastedToken(raw: string): { ok: true; token: string; kind: TokenKind } | { ok: false; message: string } {
  const token = raw
    .trim()
    .replace(/^bearer\s+/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!token) return { ok: false, message: 'Paste the token GitHub showed you (it starts with github_pat_).' };
  if (/^github_pat_[A-Za-z0-9_]{30,}$/.test(token)) return { ok: true, token, kind: 'fine-grained' };
  if (/^ghp_[A-Za-z0-9]{30,}$/.test(token)) return { ok: true, token, kind: 'classic' };
  if (/^ghu_[A-Za-z0-9]{30,}$/.test(token)) return { ok: true, token, kind: 'app' };
  return { ok: false, message: 'That doesn’t look like a GitHub token. A fine-grained token starts with github_pat_ — copy the whole thing.' };
}

/**
 * GitHub's "new fine-grained token" form, pre-filled: name, description, owner, a year's expiry
 * and Contents read-only. Picking the eepy-app repository can't be pre-filled.
 */
export function fineGrainedTokenUrl(): string {
  const owner = RELEASES_REPO.split('/')[0];
  return `${TOKENS_URL}/new?${query({
    name: 'eepy app updates',
    description: `Lets eepy on my phone check ${RELEASES_REPO} releases and download the APK. Read-only.`,
    target_name: owner,
    expires_in: '366',
    contents: 'read',
  })}`;
}

/** Steps shown next to the "paste a token" box. */
export const TOKEN_STEPS = [
  'Open the link below (signed in to GitHub). Name, owner, expiry and “Contents: Read-only” are filled in.',
  'Under Repository access choose “Only select repositories” and pick eepy-app.',
  'Tap “Generate token”, copy it (it starts with github_pat_) and paste it here.',
];

/** The `login` of `GET /user`. */
export function parseLogin(json: unknown): string | undefined {
  return isObject(json) && typeof json.login === 'string' && json.login ? json.login : undefined;
}
