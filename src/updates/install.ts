/**
 * Downloads a release APK into the cache and hands it to Android's package installer.
 *
 * - Download: expo-file-system's `File.downloadFileAsync` (progress via `onProgress`) into
 *   `<cache>/updates/`. Only the APK being installed is kept there. The URL is the API's asset
 *   endpoint (works for private repos) with `Accept: application/octet-stream` and the GitHub
 *   token; it answers 302 to a signed release-assets.githubusercontent.com URL. On Android that
 *   download runs on a plain OkHttpClient, which follows the redirect and drops `Authorization`
 *   when the host changes, so the signed URL is fetched without the token (as it must be).
 * - Install: an `ACTION_VIEW` intent (expo-intent-launcher) with the file's `content://` URI from
 *   expo-file-system's FileProvider, type `application/vnd.android.package-archive` and
 *   `FLAG_GRANT_READ_URI_PERMISSION`. This needs `REQUEST_INSTALL_PACKAGES` (app.json); the first
 *   time, Android also asks the user to allow eepy to "install unknown apps".
 *
 * Android only. On web and iOS everything here is a no-op or refuses politely.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

import { useStore } from '../state/store';
import { appPackageName } from './current';
import { AUTH_PROBLEM_MESSAGE, APK_MIME, githubHeaders, type ReleaseBuild } from './releases';
import { type DownloadState, useUpdateStatus } from './status';
import { getGithubToken, TOKEN_UNREADABLE } from './token';

const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
const UPDATES_DIR = 'updates';

/** Whether this platform can download and install an APK. */
export function canInstallUpdates(): boolean {
  return Platform.OS === 'android';
}

function updatesDir(): Directory {
  return new Directory(Paths.cache, UPDATES_DIR);
}

function removeQuietly(entry: File | Directory): void {
  try {
    if (entry.exists) entry.delete();
  } catch {
    // Cache files: the system can clear them anyway.
  }
}

/** Downloads (or reuses an already complete download of) the build's APK. */
export async function downloadApk(release: ReleaseBuild, token: string | undefined, onProgress: (written: number, total: number) => void): Promise<File> {
  if (!canInstallUpdates()) throw new Error('Updates can only be installed in the Android app.');
  const dir = updatesDir();
  dir.create({ intermediates: true, idempotent: true });
  for (const entry of dir.list()) if (entry.name !== release.apk.name) removeQuietly(entry);

  const target = new File(dir, release.apk.name);
  const expected = release.apk.size;
  if (expected > 0 && target.exists && target.size === expected) {
    onProgress(expected, expected);
    return target;
  }
  try {
    const file = await File.downloadFileAsync(release.apk.url, target, {
      headers: githubHeaders(token, 'application/octet-stream'),
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => onProgress(bytesWritten, totalBytes > 0 ? totalBytes : expected > 0 ? expected : -1),
    });
    if (expected > 0 && file.size !== expected) {
      removeQuietly(file);
      throw new Error(`The download was incomplete (${file.size} of ${expected} bytes). Try again.`);
    }
    return file;
  } catch (e) {
    removeQuietly(target);
    throw e;
  }
}

/**
 * Opens Android's installer for a downloaded APK. Resolves when the installer closes without
 * replacing eepy (cancelled, or blocked by "Install unknown apps"); a successful update restarts
 * the app instead.
 */
export async function launchInstaller(file: File): Promise<void> {
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    type: APK_MIME,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

/** Android's "Install unknown apps" switch for eepy (Android 8+). */
export async function openInstallPermissionSettings(): Promise<void> {
  if (!canInstallUpdates()) return;
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, { data: `package:${appPackageName()}` });
}

/** Deletes downloaded APKs for builds that are already installed (nothing on development builds). */
export function removeInstalledDownloads(installed: number | undefined): void {
  if (!canInstallUpdates() || installed === undefined) return;
  if (useUpdateStatus.getState().download.phase !== 'idle') return;
  try {
    const dir = updatesDir();
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      const build = Number(/build(\d+)\.apk$/i.exec(entry.name)?.[1]);
      if (!(build > installed)) removeQuietly(entry);
    }
  } catch {
    // best effort
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** expo-file-system reports HTTP failures as "... response has status: 404". */
function downloadError(e: unknown, signedIn: boolean): { text: string; authProblem?: 'auth' | 'private' | 'no-access' } {
  const status = Number(/status:?\s*(\d{3})/i.exec(message(e))?.[1]);
  if (status === 401) return { text: AUTH_PROBLEM_MESSAGE.auth, authProblem: 'auth' };
  if (status === 404 || status === 403) {
    const kind = signedIn ? 'no-access' : 'private';
    return { text: AUTH_PROBLEM_MESSAGE[kind], authProblem: kind };
  }
  return { text: `Download failed: ${message(e)}` };
}

let running: Promise<void> | undefined;

/** Download → installer, reporting progress in `useUpdateStatus().download`. Never throws. */
export function downloadAndInstall(release: ReleaseBuild): Promise<void> {
  running ??= (async () => {
    const { build } = release;
    const set = (download: DownloadState) => useUpdateStatus.setState({ download });
    set({ phase: 'downloading', build, written: 0, total: release.apk.size > 0 ? release.apk.size : -1 });
    let file: File;
    let token: string | undefined;
    try {
      token = await getGithubToken();
    } catch {
      set({ phase: 'error', build, message: TOKEN_UNREADABLE });
      return;
    }
    try {
      let lastEmit = 0;
      file = await downloadApk(release, token, (written, total) => {
        const t = Date.now();
        if (t - lastEmit < 150 && written < total) return; // ~6 UI updates a second is plenty
        lastEmit = t;
        set({ phase: 'downloading', build, written, total });
      });
    } catch (e) {
      const { text, authProblem } = downloadError(e, !!token);
      if (authProblem) useStore.getState().setUpdateSettings({ authProblem });
      set({ phase: 'error', build, message: text });
      return;
    }
    set({ phase: 'installing', build });
    try {
      await launchInstaller(file);
      set({ phase: 'ready', build });
    } catch (e) {
      set({ phase: 'error', build, message: `Couldn't open Android's installer: ${message(e)}` });
    }
  })().finally(() => {
    running = undefined;
  });
  return running;
}
