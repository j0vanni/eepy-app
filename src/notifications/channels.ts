import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { FEATURES } from './features';

let configured: Promise<void> | undefined;

/** Notification handler, Android channels and action categories. Safe to call repeatedly. */
export function configureNotifications(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  configured ??= (async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('reminders', { name: 'Sleep reminders', importance: Notifications.AndroidImportance.DEFAULT });
      await Notifications.setNotificationChannelAsync('alarms', {
        name: 'Nap & wake alarms',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 600, 300, 600, 300, 600],
        sound: 'default',
        bypassDnd: true,
      });
      await Notifications.setNotificationChannelAsync('wake', {
        name: 'Gentle wake alarm',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'wake.wav',
        vibrationPattern: [0, 400, 600, 400],
        bypassDnd: true,
        audioAttributes: { usage: Notifications.AndroidAudioUsage.ALARM, contentType: Notifications.AndroidAudioContentType.SONIFICATION },
      });
      await Notifications.setNotificationChannelAsync('pings', { name: 'Alertness check-ins', importance: Notifications.AndroidImportance.DEFAULT });
      await Notifications.setNotificationChannelAsync('reports', { name: 'Sleep reports', importance: Notifications.AndroidImportance.DEFAULT });
      await Notifications.setNotificationChannelAsync('live', { name: 'Live countdowns', importance: Notifications.AndroidImportance.LOW });
    }
    for (const f of FEATURES) {
      for (const c of f.categories ?? []) {
        await Notifications.setNotificationCategoryAsync(
          c.id,
          c.actions.map((a) => ({ identifier: a.id, buttonTitle: a.title, options: { opensAppToForeground: a.opensApp ?? true } })),
        );
      }
    }
  })().catch((e) => {
    configured = undefined;
    throw e;
  });
  return configured;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}
