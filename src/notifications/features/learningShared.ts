/**
 * Small helpers shared by the learning notifications (pings, naturalWake).
 * OWNER: learning workstream.
 */
import * as Notifications from 'expo-notifications';
import { Href, router } from 'expo-router';
import { Platform } from 'react-native';

/**
 * Removes delivered notifications matching `match` from the shade. Android doesn't auto-dismiss a
 * notification when one of its action buttons is used, only when its body is tapped.
 */
export async function dismissPresented(match: (n: Notifications.Notification) => boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  const shown = await Notifications.getPresentedNotificationsAsync();
  await Promise.all(shown.filter(match).map((n) => Notifications.dismissNotificationAsync(n.request.identifier).catch(() => undefined)));
}

/** Navigates once the root navigator is mounted (responses can arrive during a cold start). */
export function openRoute(href: Href, tries = 6): void {
  try {
    router.push(href);
  } catch {
    if (tries > 0) setTimeout(() => openRoute(href, tries - 1), 400);
  }
}
