import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { Platform } from 'react-native';

/**
 * Opens a screen from a notification response. On a cold start the root navigator may not be
 * mounted yet when the response is handled, so retry briefly instead of dropping the navigation.
 */
export function openFromNotification(href: Href, attempts = 10): void {
  const attempt = (left: number) => {
    try {
      router.push(href);
    } catch {
      if (left > 0) setTimeout(() => attempt(left - 1), 300);
    }
  };
  attempt(attempts);
}

/**
 * Forgets the last notification response once a feature has handled it, so the root layout's
 * "tapped while closed" check doesn't replay it when the React tree remounts in the same process.
 */
export function markResponseHandled(): void {
  if (Platform.OS === 'web') return;
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // Older native module: nothing to clear.
  }
}
