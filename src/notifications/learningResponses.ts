/**
 * Handles the learning notifications' action buttons (ping ratings, natural-wake Yes/No) while eepy
 * is backgrounded or closed. Those buttons don't open the app, and with the app killed the in-app
 * response listener never runs — Android instead runs this task headlessly for custom actions.
 * OWNER: learning workstream.
 *
 * Must be imported at module scope from the app entry (index.ts) so the task is defined before
 * Android starts the JS runtime headlessly. Responses are idempotent (one check-in per ping, the
 * same journal answer), so the in-app listener also seeing a response is harmless.
 */
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { useStore } from '../state/store';
import { naturalWake } from './features/naturalWake';
import { pings } from './features/pings';
import type { NotificationFeature, NotificationResponse } from './types';

export const LEARNING_RESPONSE_TASK = 'eepy-learning-notification-response';
const HANDLED: NotificationFeature[] = [pings, naturalWake];

/** Writing before the persisted store has loaded would overwrite it — wait (or give up). */
function whenHydrated(timeoutMs = 10_000): Promise<boolean> {
  if (useStore.persist.hasHydrated()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);
    unsubscribe = useStore.persist.onFinishHydration(() => {
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

interface RawResponse {
  actionIdentifier?: unknown;
  notification?: { request?: { content?: { data?: unknown; dataString?: unknown } } };
}

/** Headless payloads carry the notification data as a JSON string (`dataString`); listeners get an object. */
export function parseTaskResponse(payload: unknown): NotificationResponse | undefined {
  const p = payload as RawResponse | undefined;
  if (!p || typeof p.actionIdentifier !== 'string') return undefined;
  const content = p.notification?.request?.content;
  let data: Record<string, unknown> | undefined;
  if (content?.data && typeof content.data === 'object') data = content.data as Record<string, unknown>;
  else if (typeof content?.dataString === 'string') {
    try {
      data = JSON.parse(content.dataString) as Record<string, unknown>;
    } catch {
      data = undefined;
    }
  }
  if (!data) return undefined;
  return { actionId: p.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER ? 'default' : p.actionIdentifier, data };
}

if (Platform.OS === 'android') {
  TaskManager.defineTask(LEARNING_RESPONSE_TASK, async ({ data, error }) => {
    if (error) return;
    const response = parseTaskResponse(data);
    if (!response || response.actionId === 'default') return;
    const feature = HANDLED.find((f) => f.id === response.data.feature);
    if (!feature?.onResponse || !(await whenHydrated())) return;
    await feature.onResponse(response, useStore.getState());
    // Give the persisted store a moment to reach AsyncStorage before Android may stop the process.
    await new Promise((r) => setTimeout(r, 500));
  });
  Notifications.registerTaskAsync(LEARNING_RESPONSE_TASK).catch(() => undefined);
}
