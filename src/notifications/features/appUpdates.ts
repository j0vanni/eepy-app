/**
 * "eepy build N is ready — tap to update" (reports channel). The notification is posted by the
 * GitHub release check in src/updates/check.ts, not planned from the sleep analysis, so plan()
 * is empty; this feature only routes the tap to the App updates screen.
 *
 * Keep imports to ../navigate and ../types: channels.ts imports every feature (imports.test.ts).
 */
import { markResponseHandled, openFromNotification } from '../navigate';
import type { NotificationFeature } from '../types';

export const APP_UPDATES_FEATURE = 'appUpdates';

/** Notification id for a build, so a newer build's notification can replace an older one. */
export const updateNotificationId = (build: number) => `eepy-update-${build}`;

export const appUpdates: NotificationFeature = {
  id: APP_UPDATES_FEATURE,
  plan: () => [],
  onResponse() {
    markResponseHandled();
    openFromNotification('/updates');
  },
};
