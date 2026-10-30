import {
  compareBuild,
  describeHttpError,
  type FetchLike,
  fetchReleases,
  formatBytes,
  githubHeaders,
  isAuthProblem,
  isCheckDue,
  MAX_CHANGES,
  parseBuildTag,
  parseReleaseNotes,
  parseReleases,
  RELEASES_API_URL,
  type ReleaseBuild,
  resolveInstalledBuild,
  shouldNotify,
  summaryLine,
  UPDATE_CHECK_INTERVAL,
  updateNotification,
  versionFromApkName,
} from '../releases';

/** A real (trimmed) `GET /repos/j0vanni/eepy-app/releases` response: note it isn't sorted by build. */
const REAL: unknown[] = require('./fixtures/releases.json');

const HOUR = 3600_000;
const NOW = Date.parse('2026-10-30T18:00:00Z');

/** The release body CI writes now (see the "Release notes" step in android-apk.yml). */
const NEW_BODY = [
  "## What's new",
  '',
  '- Add in-app updates from GitHub Releases',
  '- Caffeine curve shows **tonight’s** cut-off',
  '- Merge branch `main` into feature',
  '- Add in-app updates from GitHub Releases',
  '',
  'Android APK built from `main` @ 0123456789abcdef0123456789abcdef01234567 (changes since build-14).',
  '',
  '**Install:** open this page on your phone, download the `.apk`, and allow',
  '"Install unknown apps" for your browser when Android asks.',
].join('\r\n');

function release(build: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: `build-${build}`,
    name: `eepy build ${build}`,
    draft: false,
    prerelease: true,
    published_at: '2026-10-30T12:00:00Z',
    target_commitish: 'abcdef0123456789abcdef0123456789abcdef01',
    html_url: `https://github.com/j0vanni/eepy-app/releases/tag/build-${build}`,
    body: `Android APK built from \`main\` @ abcdef0123456789abcdef0123456789abcdef01.`,
    assets: [
      {
        id: 690_000_000 + build,
        url: `https://api.github.com/repos/j0vanni/eepy-app/releases/assets/${690_000_000 + build}`,
        name: `eepy-0.2.0-build${build}.apk`,
        size: 51_771_954,
        state: 'uploaded',
        browser_download_url: `https://github.com/j0vanni/eepy-app/releases/download/build-${build}/eepy-0.2.0-build${build}.apk`,
      },
    ],
    ...over,
  };
}

const headers = (h: Record<string, string> = {}) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });

describe('parseReleases', () => {
  it('reads the real GitHub response, newest build first', () => {
    const builds = parseReleases(REAL)!;
    expect(builds.map((b) => b.build)).toEqual([13, 12, 7, 5, 4]);
    const [latest] = builds;
    expect(latest).toMatchObject({
      build: 13,
      tag: 'build-13',
      version: '0.2.0',
      // The API asset endpoint (works for a private repo), not browser_download_url.
      apk: {
        id: 690050923,
        name: 'eepy-0.2.0-build13.apk',
        size: 51_771_954,
        url: 'https://api.github.com/repos/j0vanni/eepy-app/releases/assets/690050923',
      },
      pageUrl: 'https://github.com/j0vanni/eepy-app/releases/tag/build-13',
      publishedAt: Date.parse('2026-10-29T22:05:52Z'),
      commit: 'fd4cc8e',
      changes: [],
      moreChanges: 0,
    });
    expect(builds.find((b) => b.build === 7)?.branch).toBe('claude/practical-hypatia-nbsdgy');
  });

  it('skips drafts, other tags and releases without an uploaded APK', () => {
    const builds = parseReleases([
      release(20, { draft: true }),
      release(19, { assets: [] }),
      release(18, { assets: [{ id: 18, name: 'notes.txt', state: 'uploaded' }] }),
      release(17, { assets: [{ id: 17, name: 'eepy-0.2.0-build17.apk', size: 10, state: 'starter' }] }),
      release(16, { assets: [{ name: 'eepy-0.2.0-build16.apk', size: 10, state: 'uploaded' }] }), // no asset id
      { ...release(15), tag_name: 'v1.0.0' },
      release(14),
      'garbage',
      null,
    ])!;
    expect(builds.map((b) => b.build)).toEqual([14]);
  });

  it('only ever downloads from this repository, whatever links the release carries', () => {
    const [b] = parseReleases([
      release(21, { assets: [{ id: 42, name: 'eepy-0.2.0-build21.apk', size: 10, state: 'uploaded', url: 'https://evil.example/x', browser_download_url: 'https://evil.example/eepy.apk' }] }),
    ])!;
    expect(b.apk.url).toBe('https://api.github.com/repos/j0vanni/eepy-app/releases/assets/42');
  });

  it('keeps the first entry for a build and falls back to target_commitish for the commit', () => {
    const builds = parseReleases([release(9, { body: '' }), release(9, { body: 'later duplicate' })])!;
    expect(builds).toHaveLength(1);
    expect(builds[0].commit).toBe('abcdef0');
    expect(builds[0].branch).toBeUndefined();
  });

  it('returns undefined for something that is not a release list', () => {
    expect(parseReleases({ message: 'Not Found' })).toBeUndefined();
    expect(parseReleases([])).toEqual([]);
  });
});

describe('parseReleaseNotes', () => {
  it('takes the bullets under "What\'s new", cleaned, deduplicated and without merges', () => {
    const notes = parseReleaseNotes(NEW_BODY);
    expect(notes.changes).toEqual([
      'Add in-app updates from GitHub Releases',
      'Caffeine curve shows tonight’s cut-off',
    ]);
    expect(notes.branch).toBe('main');
    expect(notes.commit).toBe('0123456');
  });

  it('stops at the next heading and caps the list', () => {
    const many = Array.from({ length: MAX_CHANGES + 3 }, (_, i) => `- change ${i + 1}`);
    const notes = parseReleaseNotes(['## Changes', ...many, '## Install', '- download the apk'].join('\n'));
    expect(notes.changes).toHaveLength(MAX_CHANGES);
    expect(notes.total).toBe(MAX_CHANGES + 3);
    expect(notes.changes).not.toContain('download the apk');
  });

  it('uses every bullet when there is no changes heading, and strips links', () => {
    expect(parseReleaseNotes('* Fixed [the alarm](https://x.y/z)\n+ `Nap` card\nplain text').changes).toEqual(['Fixed the alarm', 'Nap card']);
    expect(parseReleaseNotes(undefined)).toEqual({ changes: [], total: 0, branch: undefined, commit: undefined });
  });

  it('shortens very long lines', () => {
    const [line] = parseReleaseNotes(`- ${'a'.repeat(300)}`).changes;
    expect(line.length).toBeLessThanOrEqual(140);
    expect(line.endsWith('…')).toBe(true);
  });
});

describe('build numbers', () => {
  it('parses build tags and APK names', () => {
    expect(parseBuildTag('build-15')).toBe(15);
    expect(parseBuildTag(' build-7 ')).toBe(7);
    expect(parseBuildTag('build-0')).toBeUndefined();
    expect(parseBuildTag('v15')).toBeUndefined();
    expect(parseBuildTag(15)).toBeUndefined();
    expect(versionFromApkName('eepy-0.2.0-build15.apk')).toBe('0.2.0');
    expect(versionFromApkName('app-release.apk')).toBeUndefined();
  });

  it('only trusts the versionCode of a release build on Android', () => {
    expect(resolveInstalledBuild({ os: 'android', dev: false, versionCode: 15 })).toBe(15);
    expect(resolveInstalledBuild({ os: 'android', dev: true, versionCode: 15 })).toBeUndefined();
    expect(resolveInstalledBuild({ os: 'android', dev: false, versionCode: undefined })).toBeUndefined();
    expect(resolveInstalledBuild({ os: 'android', dev: false, versionCode: '15' })).toBeUndefined();
    expect(resolveInstalledBuild({ os: 'web', dev: false, versionCode: 15 })).toBeUndefined();
  });

  it('compares the installed build with the newest release', () => {
    const latest = parseReleases([release(15)])![0];
    expect(compareBuild(14, latest)).toBe('update-available');
    expect(compareBuild(15, latest)).toBe('up-to-date');
    expect(compareBuild(16, latest)).toBe('up-to-date');
    expect(compareBuild(undefined, latest)).toBe('unknown-build');
    expect(compareBuild(14, undefined)).toBe('no-releases');
  });
});

describe('when to check and notify', () => {
  it('checks at most every 6 hours (and again if the clock went backwards)', () => {
    expect(UPDATE_CHECK_INTERVAL).toBe(6 * HOUR);
    expect(isCheckDue(undefined, NOW)).toBe(true);
    expect(isCheckDue(NOW - 5 * HOUR, NOW)).toBe(false);
    expect(isCheckDue(NOW - 6 * HOUR, NOW)).toBe(true);
    expect(isCheckDue(NOW + HOUR, NOW)).toBe(true);
  });

  it('notifies once per newer build, never without a known installed build', () => {
    expect(shouldNotify({ installed: 14, latest: 15 })).toBe(true);
    expect(shouldNotify({ installed: 14, latest: 15, notified: 15 })).toBe(false);
    expect(shouldNotify({ installed: 14, latest: 16, notified: 15 })).toBe(true);
    expect(shouldNotify({ installed: 15, latest: 15 })).toBe(false);
    expect(shouldNotify({ installed: undefined, latest: 15 })).toBe(false);
    expect(shouldNotify({ installed: 14, latest: undefined })).toBe(false);
  });

  it('writes the notification from the first change, else the commit', () => {
    const withNotes = parseReleases([release(15, { body: NEW_BODY })])![0];
    expect(updateNotification(withNotes)).toEqual({
      title: 'eepy build 15 is ready — tap to update',
      body: 'Add in-app updates from GitHub Releases (+1 more)',
    });
    const [old] = parseReleases([release(13)])!;
    expect(summaryLine(old)).toBe('Built from main @ abcdef0');
    const bare: ReleaseBuild = { ...old, commit: undefined, branch: undefined };
    expect(summaryLine(bare)).toBe('eepy 0.2.0');
  });

  it('formats download sizes', () => {
    expect(formatBytes(51_771_954)).toBe('49.4 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(-1)).toBe('');
  });
});

describe('HTTP errors', () => {
  it('recognises GitHub rate limits and says when to retry', () => {
    const reset = Math.round((NOW + 25 * 60_000) / 1000);
    const e = describeHttpError(403, headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }), NOW);
    expect(e.kind).toBe('rate-limit');
    expect(e.retryAt).toBe(reset * 1000);
    expect(e.message).toMatch(/try again in 25 min/);
    const secondary = describeHttpError(429, headers({ 'retry-after': '60' }), NOW);
    expect(secondary).toMatchObject({ kind: 'rate-limit', retryAt: NOW + 60_000 });
  });

  it('describes other failures plainly', () => {
    expect(describeHttpError(403, headers({ 'x-ratelimit-remaining': '12' }), NOW)).toMatchObject({ kind: 'http', message: expect.stringMatching(/HTTP 403/) });
    expect(describeHttpError(502, headers(), NOW).message).toMatch(/having trouble \(HTTP 502\)/);
  });

  it('tells sign-in problems apart for a private repository', () => {
    // GitHub answers 404 (not 403) for a private repo you can't see.
    expect(describeHttpError(404, headers(), NOW, false)).toMatchObject({ kind: 'private', message: expect.stringMatching(/private — sign in/) });
    expect(describeHttpError(404, headers(), NOW, true)).toMatchObject({ kind: 'no-access', message: expect.stringMatching(/can’t see j0vanni\/eepy-app/) });
    expect(describeHttpError(401, headers(), NOW, true)).toMatchObject({ kind: 'auth', message: expect.stringMatching(/Sign in again/) });
    expect(describeHttpError(403, headers({ 'x-ratelimit-remaining': '4000' }), NOW, true).kind).toBe('no-access');
    // A rate limit is still a rate limit when signed in.
    expect(describeHttpError(403, headers({ 'x-ratelimit-remaining': '0' }), NOW, true).kind).toBe('rate-limit');
    expect(['auth', 'private', 'no-access'].every((k) => isAuthProblem(k as never))).toBe(true);
    expect(isAuthProblem('network')).toBe(false);
  });

  it('builds request headers with the token only when signed in', () => {
    expect(githubHeaders()).toEqual({ Accept: 'application/vnd.github+json' });
    expect(githubHeaders('ghu_x')).toEqual({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ghu_x' });
    expect(githubHeaders('ghu_x', 'application/octet-stream')).toEqual({ Accept: 'application/octet-stream', Authorization: 'Bearer ghu_x' });
  });
});

describe('fetchReleases', () => {
  const respond = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): FetchLike =>
    jest.fn(async () => ({
      ok: (init.status ?? 200) < 300,
      status: init.status ?? 200,
      headers: headers(init.headers),
      json: async () => (body instanceof Error ? Promise.reject(body) : body),
    }));

  it('asks the releases list (prereleases included) with a plain Accept header', async () => {
    const fetchFn = respond(REAL);
    const r = await fetchReleases(fetchFn, { now: NOW });
    expect(r.ok && r.releases[0].build).toBe(13);
    expect(fetchFn).toHaveBeenCalledWith(RELEASES_API_URL, expect.objectContaining({ headers: { Accept: 'application/vnd.github+json' } }));
    expect(RELEASES_API_URL).toBe('https://api.github.com/repos/j0vanni/eepy-app/releases?per_page=20');
  });

  it('sends the token when signed in and reads a 404 as "your sign-in can\'t see the repo"', async () => {
    const fetchFn = respond({ message: 'Not Found' }, { status: 404 });
    await expect(fetchReleases(fetchFn, { now: NOW, token: 'github_pat_abc' })).resolves.toMatchObject({ ok: false, error: { kind: 'no-access' } });
    expect(fetchFn).toHaveBeenCalledWith(RELEASES_API_URL, expect.objectContaining({ headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer github_pat_abc' } }));
    await expect(fetchReleases(fetchFn, { now: NOW })).resolves.toMatchObject({ ok: false, error: { kind: 'private' } });
  });

  it('turns failures into results instead of throwing', async () => {
    await expect(fetchReleases(respond({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }), { now: NOW })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'rate-limit' },
    });
    await expect(fetchReleases(respond({ message: 'nope' }), { now: NOW })).resolves.toMatchObject({ ok: false, error: { kind: 'parse' } });
    await expect(fetchReleases(respond(new SyntaxError('Unexpected token <')), { now: NOW })).resolves.toMatchObject({ ok: false, error: { kind: 'parse' } });
    const offline: FetchLike = () => Promise.reject(new TypeError('Network request failed'));
    await expect(fetchReleases(offline, { now: NOW })).resolves.toMatchObject({ ok: false, error: { kind: 'network' } });
  });

  it('gives up after the timeout', async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('Aborted'))));
    await expect(fetchReleases(hanging, { now: NOW, timeoutMs: 10 })).resolves.toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });
});
