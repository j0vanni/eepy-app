/**
 * App updates from GitHub Releases: the pure part (no React or native imports, unit-tested).
 *
 * CI (.github/workflows/android-apk.yml) publishes every APK as a GitHub prerelease tagged
 * `build-<N>` with one asset `eepy-<version>-build<N>.apk`. N is the workflow run number, and CI
 * also stamps it into the APK as `android.versionCode`, so the running app knows its own build.
 * This module parses the releases API response, picks the newest build that has an APK, compares
 * it with the installed build and turns the release notes into a short changelog.
 *
 * The repository can be private: every request then carries the user's token (see
 * ./githubAuth.ts), and APKs come from the API's asset endpoint, because a private repo's
 * `browser_download_url` only works with a browser session.
 */

export const RELEASES_REPO = 'j0vanni/eepy-app';
/** `/releases/latest` ignores prereleases, and every CI build is one, so list them instead. */
export const RELEASES_API_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=20`;
export const RELEASES_PAGE_URL = `https://github.com/${RELEASES_REPO}/releases`;
/** APKs are only ever downloaded from this repository's release-asset endpoint. */
export const releaseAssetUrl = (id: number) => `https://api.github.com/repos/${RELEASES_REPO}/releases/assets/${id}`;
export const APK_MIME = 'application/vnd.android.package-archive';

/** Automatic checks (app open, background task) run at most this often. */
export const UPDATE_CHECK_INTERVAL = 6 * 3600_000;
/** Changelog lines kept per release; the rest are counted in `moreChanges`. */
export const MAX_CHANGES = 8;
const MAX_LINE = 140;

export interface ReleaseApk {
  /** Asset id. */
  id: number;
  name: string;
  /** API asset endpoint: GET it with `Accept: application/octet-stream` (+ token) for the file. */
  url: string;
  /** Bytes; 0 when GitHub didn't say. */
  size: number;
}

export interface ReleaseBuild {
  build: number;
  tag: string;
  /** App version from the APK name ("0.2.0"). */
  version?: string;
  apk: ReleaseApk;
  /** The release's page on GitHub. */
  pageUrl: string;
  publishedAt?: number;
  /** Branch the APK was built from, when the notes say so. */
  branch?: string;
  /** Short commit hash. */
  commit?: string;
  /** Changelog lines (commit subjects), newest first as CI lists them. */
  changes: string[];
  /** Lines that didn't fit in `changes`. */
  moreChanges: number;
}

/**
 * `auth`: the token was revoked or expired (401). `private`: the repo is private and we're not
 * signed in (404). `no-access`: signed in, but the token can't see eepy-app (404/403).
 */
export type UpdateErrorKind = 'auth' | 'private' | 'no-access' | 'rate-limit' | 'http' | 'network' | 'timeout' | 'parse';
export type AuthProblem = Extract<UpdateErrorKind, 'auth' | 'private' | 'no-access'>;

export const isAuthProblem = (kind: UpdateErrorKind | undefined): kind is AuthProblem => kind === 'auth' || kind === 'private' || kind === 'no-access';

export const AUTH_PROBLEM_MESSAGE: Record<AuthProblem, string> = {
  auth: 'GitHub no longer accepts your sign-in (it was revoked or expired). Sign in again to keep getting updates.',
  private: 'eepy-app is private — sign in with GitHub to check for updates.',
  'no-access':
    'Your GitHub sign-in can’t see j0vanni/eepy-app. A token needs “Only select repositories → eepy-app” with Contents read-only; the eepy GitHub App needs to be installed on eepy-app.',
};

export interface UpdateError {
  kind: UpdateErrorKind;
  message: string;
  /** When it's worth trying again (rate limits). */
  retryAt?: number;
}

export type ReleasesResult = { ok: true; releases: ReleaseBuild[] } | { ok: false; error: UpdateError };

/**
 * - `update-available`: GitHub has a newer build than this one.
 * - `up-to-date`: this is the newest build (or newer than anything published).
 * - `unknown-build`: a development / web build that doesn't know its build number.
 * - `no-releases`: GitHub has no build with an APK.
 */
export type UpdateState = 'update-available' | 'up-to-date' | 'unknown-build' | 'no-releases';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** "build-15" → 15. Anything else (other tags, "build-0") → undefined. */
export function parseBuildTag(tag: unknown): number | undefined {
  const m = typeof tag === 'string' ? /^build-(\d{1,9})$/.exec(tag.trim()) : null;
  const n = m ? Number(m[1]) : NaN;
  return n > 0 ? n : undefined;
}

/** "eepy-0.2.0-build15.apk" → "0.2.0". */
export function versionFromApkName(name: string): string | undefined {
  return /^eepy-(.+)-build\d+\.apk$/i.exec(name)?.[1];
}

/**
 * The build this app is, from the native config. Only a release APK on Android has a real build
 * number (CI writes android.versionCode); dev builds, web and Jest get undefined.
 */
export function resolveInstalledBuild(opts: { os: string; dev: boolean; versionCode: unknown }): number | undefined {
  const { os, dev, versionCode } = opts;
  if (os !== 'android' || dev) return undefined;
  return typeof versionCode === 'number' && Number.isInteger(versionCode) && versionCode > 0 ? versionCode : undefined;
}

function pickApk(assets: unknown): ReleaseApk | undefined {
  if (!Array.isArray(assets)) return undefined;
  for (const a of assets) {
    if (!isObject(a)) continue;
    const name = asString(a.name);
    const id = a.id;
    if (!name || !/\.apk$/i.test(name) || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) continue;
    // Still uploading (or a failed upload): not installable yet.
    if (a.state !== undefined && a.state !== 'uploaded') continue;
    const size = typeof a.size === 'number' && a.size > 0 ? a.size : 0;
    // Built from the id, so the download always goes to this repository's asset endpoint.
    return { id, name, url: releaseAssetUrl(id), size };
  }
  return undefined;
}

function cleanLine(line: string): string {
  const text = line
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](link) → text
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1).trimEnd()}…` : text;
}

const HEADING = /^#{1,6}\s+/;
const CHANGES_HEADING = /^#{1,6}\s+(what.?s new|changes|changelog)\b/i;
const BULLET = /^\s*[-*+]\s+(.+)$/;
const MERGE = /^merge (branch|pull request|remote-tracking|tag)\b/i;
const BUILT_FROM = /built from `([^`]+)` @ ([0-9a-f]{7,40})/i;

/**
 * The changelog in a release body: the bullets under a "What's new" / "Changes" heading (CI
 * writes one commit subject per bullet), or every bullet when there is no such heading. Older
 * releases only say "Android APK built from `main` @ <sha>", which gives the branch and commit.
 */
export function parseReleaseNotes(body: string | undefined | null): { changes: string[]; total: number; branch?: string; commit?: string } {
  const text = (body ?? '').replace(/\r\n?/g, '\n');
  let lines = text.split('\n');
  const start = lines.findIndex((l) => CHANGES_HEADING.test(l.trim()));
  if (start >= 0) {
    lines = lines.slice(start + 1);
    const end = lines.findIndex((l) => HEADING.test(l.trim()));
    if (end >= 0) lines = lines.slice(0, end);
  }
  const seen = new Set<string>();
  const all: string[] = [];
  for (const l of lines) {
    const m = BULLET.exec(l);
    if (!m) continue;
    const item = cleanLine(m[1]);
    if (!item || MERGE.test(item) || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    all.push(item);
  }
  const built = BUILT_FROM.exec(text);
  return { changes: all.slice(0, MAX_CHANGES), total: all.length, branch: built?.[1], commit: built?.[2]?.slice(0, 7) };
}

/**
 * Every installable build in a `GET /repos/{owner}/{repo}/releases` response, newest build
 * first. Drafts, tags other than `build-<N>` and releases without an uploaded APK are skipped.
 * Undefined when the response isn't a release list at all.
 */
export function parseReleases(json: unknown): ReleaseBuild[] | undefined {
  if (!Array.isArray(json)) return undefined;
  const byBuild = new Map<number, ReleaseBuild>();
  for (const r of json) {
    if (!isObject(r) || r.draft === true) continue;
    const build = parseBuildTag(r.tag_name);
    const apk = build ? pickApk(r.assets) : undefined;
    if (!build || !apk || byBuild.has(build)) continue;
    const notes = parseReleaseNotes(asString(r.body));
    const target = asString(r.target_commitish);
    const published = Date.parse(asString(r.published_at) ?? '');
    const page = asString(r.html_url);
    byBuild.set(build, {
      build,
      tag: `build-${build}`,
      version: versionFromApkName(apk.name),
      apk,
      pageUrl: page?.startsWith(`https://github.com/${RELEASES_REPO}/`) ? page : `${RELEASES_PAGE_URL}/tag/build-${build}`,
      publishedAt: Number.isFinite(published) ? published : undefined,
      branch: notes.branch,
      commit: notes.commit ?? (target && /^[0-9a-f]{40}$/i.test(target) ? target.slice(0, 7) : undefined),
      changes: notes.changes,
      moreChanges: notes.total - notes.changes.length,
    });
  }
  return [...byBuild.values()].sort((a, b) => b.build - a.build);
}

export function compareBuild(installed: number | undefined, latest: ReleaseBuild | undefined): UpdateState {
  if (!latest) return 'no-releases';
  if (installed === undefined) return 'unknown-build';
  return latest.build > installed ? 'update-available' : 'up-to-date';
}

/** Whether an automatic check is due. A clock that went backwards also counts as due. */
export function isCheckDue(lastCheck: number | undefined, now: number, interval = UPDATE_CHECK_INTERVAL): boolean {
  return lastCheck === undefined || now < lastCheck || now - lastCheck >= interval;
}

/** One "update ready" notification per build, and never for a build we can't compare against. */
export function shouldNotify(o: { installed?: number; latest?: number; notified?: number }): boolean {
  if (o.installed === undefined || o.latest === undefined || o.latest <= o.installed) return false;
  return o.notified === undefined || o.latest > o.notified;
}

/** One line about what's in a build: its first change, else where it was built from. */
export function summaryLine(r: ReleaseBuild): string {
  const [first] = r.changes;
  const more = r.changes.length - 1 + r.moreChanges;
  if (first) return more > 0 ? `${first} (+${more} more)` : first;
  if (r.commit) return `Built from ${r.branch ?? 'the latest code'} @ ${r.commit}`;
  return r.version ? `eepy ${r.version}` : 'A newer build of eepy is on GitHub';
}

export function updateNotification(r: ReleaseBuild): { title: string; body: string } {
  return { title: `eepy build ${r.build} is ready — tap to update`, body: summaryLine(r) };
}

/** "49.4 MB". Empty when the size is unknown. */
export function formatBytes(n: number): string {
  if (!(n > 0)) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export interface HeaderLike {
  get(name: string): string | null;
}

/** Headers for a GitHub request: the bearer token when signed in. */
export function githubHeaders(token?: string, accept = 'application/vnd.github+json'): Record<string, string> {
  return token ? { Accept: accept, Authorization: `Bearer ${token}` } : { Accept: accept };
}

/**
 * GitHub's error responses in plain words. 403/429 with exhausted limits are rate limits; 401 is
 * a dead token; 404 means "private, sign in" when signed out and "can't see the repo" when
 * signed in (GitHub answers 404, not 403, for private repos you can't see).
 */
export function describeHttpError(status: number, headers: HeaderLike, now: number, signedIn = false): UpdateError {
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = Number(headers.get('x-ratelimit-reset'));
  const retryAfter = Number(headers.get('retry-after'));
  if (status === 429 || (status === 403 && (remaining === '0' || retryAfter > 0))) {
    const retryAt = retryAfter > 0 ? now + retryAfter * 1000 : reset > 0 ? reset * 1000 : undefined;
    const minutes = retryAt !== undefined ? Math.max(1, Math.ceil((retryAt - now) / 60_000)) : undefined;
    return {
      kind: 'rate-limit',
      message: `GitHub's limit for update checks from this network was reached${minutes !== undefined ? ` — try again in ${minutes} min` : ' — try again later'}.`,
      retryAt,
    };
  }
  if (status === 401) return { kind: 'auth', message: AUTH_PROBLEM_MESSAGE.auth };
  if (status === 404) return signedIn ? { kind: 'no-access', message: AUTH_PROBLEM_MESSAGE['no-access'] } : { kind: 'private', message: AUTH_PROBLEM_MESSAGE.private };
  // e.g. "Resource not accessible by personal access token" (no Contents permission).
  if (status === 403 && signedIn) return { kind: 'no-access', message: AUTH_PROBLEM_MESSAGE['no-access'] };
  if (status >= 500) return { kind: 'http', message: `GitHub is having trouble (HTTP ${status}). Try again later.` };
  return { kind: 'http', message: `GitHub refused the update check (HTTP ${status}).` };
}

export type FetchLike = (
  url: string,
  init: { method?: 'GET' | 'POST'; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; headers: HeaderLike; json(): Promise<unknown> }>;

/** Lists the published builds. Never throws: failures come back as `{ ok: false, error }`. */
export async function fetchReleases(fetchFn: FetchLike, opts: { now?: number; timeoutMs?: number; token?: string } = {}): Promise<ReleasesResult> {
  const now = opts.now ?? Date.now();
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller?.abort();
  }, opts.timeoutMs ?? 15_000);
  try {
    // Signed out: only the Accept header, so browsers don't need a CORS preflight.
    const res = await fetchFn(RELEASES_API_URL, { headers: githubHeaders(opts.token), signal: controller?.signal });
    if (!res.ok) return { ok: false, error: describeHttpError(res.status, res.headers, now, !!opts.token) };
    const releases = parseReleases(await res.json());
    if (!releases) return { ok: false, error: { kind: 'parse', message: "GitHub's answer didn't look like a list of releases." } };
    return { ok: true, releases };
  } catch (e) {
    if (timedOut) return { ok: false, error: { kind: 'timeout', message: 'GitHub took too long to answer. Try again in a moment.' } };
    if (e instanceof SyntaxError) return { ok: false, error: { kind: 'parse', message: "GitHub's answer couldn't be read." } };
    return { ok: false, error: { kind: 'network', message: "Couldn't reach GitHub — check your connection." } };
  } finally {
    clearTimeout(timer);
  }
}
