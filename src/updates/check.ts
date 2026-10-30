/**
 * Checks GitHub Releases for a newer eepy build and tells the user once per build.
 *
 * - `manual` (Check now, opening App updates): always runs.
 * - `open` (eepy comes to the foreground) and `background` (the background sync task): only with
 *   `settings.updates.autoCheck`, at most every UPDATE_CHECK_INTERVAL (6 h), not on development
 *   builds, and not again for 15 min after a failed attempt (or until a rate limit resets).
 *
 * When a newer build appears, the background run posts one notification for it on the `reports`
 * channel; in the foreground the in-app banner shows it instead. Either way the build is recorded
 * in `settings.updates.notifiedBuild`, so it's announced only once.
 *
 * Requests carry the GitHub token when signed in (./token.ts). Sign-in problems (401, a private
 * repo while signed out, a token that can't see eepy-app) never notify: they're stored in
 * `settings.updates.authProblem` for Settings to show, and count as a check for the 6 h throttle.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { MINUTE } from '../engine/time';
import { configureNotifications } from '../notifications/channels';
import { APP_UPDATES_FEATURE, updateNotificationId } from '../notifications/features/appUpdates';
import { UpdateSettings, useStore } from '../state/store';
import { appInForeground, installedBuild } from './current';
import {
  compareBuild,
  type FetchLike,
  fetchReleases,
  isAuthProblem,
  isCheckDue,
  type ReleaseBuild,
  shouldNotify,
  type UpdateError,
  updateNotification,
  type UpdateState,
} from './releases';
import { useUpdateStatus } from './status';
import { getGithubToken, TOKEN_UNREADABLE } from './token';

export type CheckReason = 'manual' | 'open' | 'background';

export interface UpdateCheckOutcome {
  status: UpdateState | 'skipped' | 'error';
  latest?: ReleaseBuild;
  error?: UpdateError;
  /** A notification was posted for `latest`. */
  notified?: boolean;
}

/** After a failed automatic check, wait this long before the next automatic attempt. */
export const RETRY_AFTER_FAILURE = 15 * MINUTE;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);
let inFlight: Promise<UpdateCheckOutcome> | undefined;
// The open app and a background run share one JS context; never announce a build twice.
const announcedThisSession = new Set<number>();

/** Why an automatic check shouldn't run now (undefined = go ahead). */
function skipReason(reason: CheckReason, now: number): string | undefined {
  if (reason === 'manual') return undefined;
  const { updates } = useStore.getState().settings;
  if (!updates.autoCheck) return 'off';
  if (installedBuild().build === undefined) return 'development build';
  if (!isCheckDue(updates.lastCheck, now)) return 'checked recently';
  const { error, lastAttempt } = useUpdateStatus.getState();
  if (error?.retryAt !== undefined && now < error.retryAt) return 'rate limited';
  if (error && lastAttempt !== undefined && now - lastAttempt < RETRY_AFTER_FAILURE) return 'failed recently';
  return undefined;
}

async function postUpdateNotification(r: ReleaseBuild, previous: number | undefined): Promise<'posted' | 'not-allowed'> {
  if (Platform.OS === 'web') return 'not-allowed';
  await configureNotifications();
  if (!(await Notifications.getPermissionsAsync()).granted) return 'not-allowed';
  if (previous !== undefined) await Notifications.dismissNotificationAsync(updateNotificationId(previous)).catch(() => undefined);
  const { title, body } = updateNotification(r);
  await Notifications.scheduleNotificationAsync({
    identifier: updateNotificationId(r.build),
    content: { title, body, data: { feature: APP_UPDATES_FEATURE, build: r.build } },
    trigger: { channelId: 'reports' },
  });
  return 'posted';
}

async function runCheck(reason: CheckReason, now: number, fetchFn: FetchLike): Promise<UpdateCheckOutcome> {
  useUpdateStatus.setState({ checking: true, lastAttempt: now });
  let token: string | undefined;
  try {
    token = await getGithubToken();
  } catch {
    // Not "signed out": don't drop the login or ask GitHub without the token. Retried later.
    const error: UpdateError = { kind: 'network', message: TOKEN_UNREADABLE };
    useUpdateStatus.setState({ checking: false, error });
    return { status: 'error', error };
  }
  if (!token && useStore.getState().settings.updates.login) {
    // Signed out underneath us (e.g. a restored backup has the login but not the secure token).
    useStore.getState().setUpdateSettings({ login: undefined, authMethod: undefined });
  }
  const result = await fetchReleases(fetchFn, { now, token });
  if (!result.ok) {
    useUpdateStatus.setState({ checking: false, error: result.error });
    // GitHub answered; retrying every 15 min won't fix a sign-in problem, so throttle as usual.
    if (isAuthProblem(result.error.kind)) useStore.getState().setUpdateSettings({ authProblem: result.error.kind, lastCheck: now });
    return { status: 'error', error: result.error };
  }
  const latest = result.releases[0];
  const installed = installedBuild().build;
  useUpdateStatus.setState({ checking: false, error: undefined, latest });

  const {
    settings: { updates },
    setUpdateSettings,
  } = useStore.getState();
  const patch: Partial<UpdateSettings> = { lastCheck: now, latestBuild: latest?.build, authProblem: undefined };
  let notified = false;
  if (latest && shouldNotify({ installed, latest: latest.build, notified: updates.notifiedBuild }) && !announcedThisSession.has(latest.build)) {
    announcedThisSession.add(latest.build);
    // Looking at eepy right now: the banner on Today / Settings already says so.
    const foreground = reason !== 'background' && appInForeground();
    if (foreground) {
      patch.notifiedBuild = latest.build;
    } else {
      try {
        notified = (await postUpdateNotification(latest, updates.notifiedBuild)) === 'posted';
        patch.notifiedBuild = latest.build;
      } catch (e) {
        // Try again at the next check.
        announcedThisSession.delete(latest.build);
        console.warn('update notification failed', e);
      }
    }
  }
  setUpdateSettings(patch);
  return { status: compareBuild(installed, latest), latest, notified };
}

/** Checks GitHub for a newer build (see the module comment for when). Never throws. */
export function checkForUpdates(reason: CheckReason, now = Date.now(), fetchFn: FetchLike = defaultFetch): Promise<UpdateCheckOutcome> {
  if (inFlight) return inFlight;
  if (skipReason(reason, now)) return Promise.resolve({ status: 'skipped' });
  inFlight = runCheck(reason, now, fetchFn)
    .catch((e): UpdateCheckOutcome => {
      const error: UpdateError = { kind: 'network', message: e instanceof Error ? e.message : String(e) };
      useUpdateStatus.setState({ checking: false, error });
      return { status: 'error', error };
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

/** Clears the "update ready" notification once that build (or a newer one) is installed. */
export async function dismissInstalledUpdateNotification(): Promise<void> {
  if (Platform.OS === 'web') return;
  const installed = installedBuild().build;
  const { notifiedBuild } = useStore.getState().settings.updates;
  if (installed === undefined || notifiedBuild === undefined || notifiedBuild > installed) return;
  await Notifications.dismissNotificationAsync(updateNotificationId(notifiedBuild)).catch(() => undefined);
}
