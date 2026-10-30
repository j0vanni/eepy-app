import {
  ACCESS_TOKEN_URL,
  checkPastedToken,
  DEVICE_CODE_URL,
  DEVICE_GRANT_TYPE,
  type DeviceCode,
  fineGrainedTokenUrl,
  interpretTokenResponse,
  parseDeviceCodeResponse,
  parseLogin,
  pollForToken,
  RELEASES_REPO_ID,
  requestDeviceCode,
} from '../githubAuth';
import type { FetchLike } from '../releases';

const NOW = Date.parse('2026-10-30T18:00:00Z');
const CLIENT_ID = 'Iv23liEXAMPLE0000000';

type Call = Parameters<FetchLike>;
/** A fetch that answers each call with the next JSON body (or throws for an Error). */
function scripted(...bodies: unknown[]) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (...args) => {
    calls.push(args);
    const body = bodies.shift();
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  };
  return { fetchFn, calls };
}

function device(over: Partial<DeviceCode> = {}): DeviceCode {
  return { deviceCode: 'dc'.repeat(20), userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresAt: NOW + 900_000, interval: 5, ...over };
}

/** A fake clock that the fake sleep advances. */
function clock() {
  let t = NOW;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    slept,
  };
}

describe('device code', () => {
  it('reads GitHub’s answer (the documented example)', () => {
    const r = parseDeviceCodeResponse(
      { device_code: '3584d83530557fdd1f46af8289938c8ef79f9dc5', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 },
      NOW,
    );
    expect(r).toEqual({
      ok: true,
      device: { deviceCode: '3584d83530557fdd1f46af8289938c8ef79f9dc5', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresAt: NOW + 900_000, interval: 5 },
    });
  });

  it('falls back to the documented defaults and never sends people off github.com', () => {
    const r = parseDeviceCodeResponse({ device_code: 'd', user_code: 'ABCD-EFGH', verification_uri: 'https://evil.example/device' }, NOW);
    expect(r.ok && r.device).toMatchObject({ verificationUri: 'https://github.com/login/device', expiresAt: NOW + 900_000, interval: 5 });
  });

  it('explains errors: device flow off, unknown client id, garbage', () => {
    expect(parseDeviceCodeResponse({ error: 'device_flow_disabled' }, NOW)).toMatchObject({ ok: false, error: { kind: 'disabled' } });
    expect(parseDeviceCodeResponse({ error: 'incorrect_client_credentials' }, NOW)).toMatchObject({ ok: false, error: { kind: 'bad-client' } });
    expect(parseDeviceCodeResponse({ message: 'Not Found' }, NOW)).toMatchObject({ ok: false, error: { kind: 'bad-client' } });
    expect(parseDeviceCodeResponse('<html>', NOW)).toMatchObject({ ok: false, error: { kind: 'unknown' } });
  });

  it('POSTs the client id to github.com/login/device/code asking for JSON', async () => {
    const { fetchFn, calls } = scripted({ device_code: 'd', user_code: 'ABCD-EFGH', interval: 5, expires_in: 900 });
    await expect(requestDeviceCode(fetchFn, CLIENT_ID, NOW)).resolves.toMatchObject({ ok: true });
    expect(calls[0]).toEqual([`${DEVICE_CODE_URL}?client_id=${CLIENT_ID}`, { method: 'POST', headers: { Accept: 'application/json' } }]);
    const offline = scripted(new TypeError('Network request failed'));
    await expect(requestDeviceCode(offline.fetchFn, CLIENT_ID, NOW)).resolves.toMatchObject({ ok: false, error: { kind: 'network' } });
  });
});

describe('interpretTokenResponse', () => {
  it('handles every documented answer', () => {
    expect(interpretTokenResponse({ access_token: 'ghu_abc', token_type: 'bearer', scope: '' }, 5)).toEqual({ type: 'token', token: 'ghu_abc', expiresIn: undefined });
    expect(interpretTokenResponse({ access_token: 'ghu_abc', expires_in: 28800, refresh_token: 'ghr_x' }, 5)).toMatchObject({ expiresIn: 28800 });
    expect(interpretTokenResponse({ error: 'authorization_pending' }, 5)).toEqual({ type: 'pending', interval: 5 });
    // slow_down: GitHub sends the new interval (+5 s); without one, add 5 s ourselves.
    expect(interpretTokenResponse({ error: 'slow_down', interval: 10 }, 5)).toEqual({ type: 'slow-down', interval: 10 });
    expect(interpretTokenResponse({ error: 'slow_down' }, 10)).toEqual({ type: 'slow-down', interval: 15 });
    expect(interpretTokenResponse({ error: 'slow_down', interval: 3 }, 10)).toEqual({ type: 'slow-down', interval: 15 });
    expect(interpretTokenResponse({ error: 'expired_token' }, 5)).toMatchObject({ type: 'failed', error: { kind: 'expired' } });
    expect(interpretTokenResponse({ error: 'token_expired' }, 5)).toMatchObject({ type: 'failed', error: { kind: 'expired' } });
    expect(interpretTokenResponse({ error: 'access_denied' }, 5)).toMatchObject({ type: 'failed', error: { kind: 'denied' } });
    expect(interpretTokenResponse({ error: 'device_flow_disabled' }, 5)).toMatchObject({ type: 'failed', error: { kind: 'disabled' } });
    expect(interpretTokenResponse({ error: 'incorrect_device_code' }, 5)).toMatchObject({ type: 'failed', error: { kind: 'expired' } });
    expect(interpretTokenResponse({ error: 'weird', error_description: 'Something odd' }, 5)).toMatchObject({
      type: 'failed',
      error: { kind: 'unknown', message: 'GitHub sign-in failed: Something odd.' },
    });
  });
});

describe('pollForToken', () => {
  it('waits the interval between polls, slows down when told, and returns the token', async () => {
    const c = clock();
    const { fetchFn, calls } = scripted({ error: 'authorization_pending' }, { error: 'slow_down', interval: 10 }, { error: 'authorization_pending' }, { access_token: 'ghu_token' });
    const r = await pollForToken({ fetchFn, clientId: CLIENT_ID, device: device(), sleep: c.sleep, now: c.now, repositoryId: RELEASES_REPO_ID });
    expect(r).toEqual({ ok: true, token: 'ghu_token', expiresIn: undefined });
    expect(c.slept).toEqual([5000, 5000, 10_000, 10_000]);
    const [url, init] = calls[0];
    const q = new URL(url);
    expect(`${q.origin}${q.pathname}`).toBe(ACCESS_TOKEN_URL);
    expect(Object.fromEntries(q.searchParams)).toEqual({
      client_id: CLIENT_ID,
      device_code: device().deviceCode,
      grant_type: DEVICE_GRANT_TYPE,
      repository_id: String(RELEASES_REPO_ID),
    });
    expect(init).toMatchObject({ method: 'POST', headers: { Accept: 'application/json' } });
  });

  it('stops when the code expires, the user cancels on GitHub, or GitHub says so', async () => {
    const c = clock();
    const pending = Array.from({ length: 10 }, () => ({ error: 'authorization_pending' }));
    const { fetchFn, calls } = scripted(...pending);
    const expired = await pollForToken({ fetchFn, clientId: CLIENT_ID, device: device({ expiresAt: NOW + 12_000 }), sleep: c.sleep, now: c.now });
    expect(expired).toMatchObject({ ok: false, error: { kind: 'expired' } });
    expect(calls).toHaveLength(2); // at +5 s and +10 s; +15 s is past the expiry

    const denied = scripted({ error: 'authorization_pending' }, { error: 'access_denied' });
    await expect(pollForToken({ fetchFn: denied.fetchFn, clientId: CLIENT_ID, device: device(), sleep: clock().sleep, now: clock().now })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'denied' },
    });
  });

  it('rides out a few network hiccups but not a lost connection', async () => {
    const flaky = scripted(new TypeError('offline'), new TypeError('offline'), new TypeError('offline'), { access_token: 'ghu_ok' });
    const c1 = clock();
    await expect(pollForToken({ fetchFn: flaky.fetchFn, clientId: CLIENT_ID, device: device(), sleep: c1.sleep, now: c1.now })).resolves.toMatchObject({ ok: true, token: 'ghu_ok' });
    const down = scripted(...Array.from({ length: 4 }, () => new TypeError('offline')));
    const c2 = clock();
    await expect(pollForToken({ fetchFn: down.fetchFn, clientId: CLIENT_ID, device: device(), sleep: c2.sleep, now: c2.now })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'network' },
    });
  });

  it('stops polling as soon as it is cancelled', async () => {
    const controller = new AbortController();
    const c = clock();
    const { fetchFn, calls } = scripted({ error: 'authorization_pending' }, { access_token: 'ghu_late' });
    const sleep = async (ms: number) => {
      await c.sleep(ms);
      if (calls.length === 1) controller.abort();
    };
    await expect(pollForToken({ fetchFn, clientId: CLIENT_ID, device: device(), sleep, now: c.now, signal: controller.signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'cancelled' },
    });
    expect(calls).toHaveLength(1);
  });
});

describe('pasted tokens', () => {
  const FINE = `github_pat_11ABCDEFG0${'x'.repeat(70)}`;

  it('accepts fine-grained, classic and app tokens, tidying what people paste', () => {
    expect(checkPastedToken(FINE)).toEqual({ ok: true, token: FINE, kind: 'fine-grained' });
    expect(checkPastedToken(`  Bearer ${FINE}\n`)).toEqual({ ok: true, token: FINE, kind: 'fine-grained' });
    expect(checkPastedToken(`"${FINE}"`)).toMatchObject({ ok: true, token: FINE });
    expect(checkPastedToken(`ghp_${'a'.repeat(36)}`)).toMatchObject({ ok: true, kind: 'classic' });
    expect(checkPastedToken(`ghu_${'a'.repeat(36)}`)).toMatchObject({ ok: true, kind: 'app' });
  });

  it('rejects anything else with a hint', () => {
    expect(checkPastedToken('')).toMatchObject({ ok: false, message: expect.stringMatching(/github_pat_/) });
    expect(checkPastedToken('github_pat_short')).toMatchObject({ ok: false });
    expect(checkPastedToken('hunter2')).toMatchObject({ ok: false, message: expect.stringMatching(/doesn’t look like a GitHub token/) });
  });

  it('links to a pre-filled fine-grained token form (read-only contents, owner j0vanni)', () => {
    const url = new URL(fineGrainedTokenUrl());
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/settings/personal-access-tokens/new');
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({ name: 'eepy app updates', target_name: 'j0vanni', expires_in: '366', contents: 'read' });
    expect(q.name.length).toBeLessThanOrEqual(40);
    expect(q.description).toMatch(/j0vanni\/eepy-app/);
  });

  it('reads the login from GET /user', () => {
    expect(parseLogin({ login: 'j0vanni', id: 1 })).toBe('j0vanni');
    expect(parseLogin({ message: 'Bad credentials' })).toBeUndefined();
  });
});
