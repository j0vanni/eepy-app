import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Analysis } from '../engine/analysis';
import { HOUR } from '../engine/time';
import type { AppState } from '../state/store';
import { configureNotifications } from './channels';
import { FEATURES } from './features';
import { PLAN_PREFIX, plannedId } from './ids';
import type { NotificationResponse, PlannedNotification } from './types';

const HORIZON = 36 * HOUR;
/** Too close to (re)schedule reliably — leave whatever is already scheduled alone. */
const MIN_LEAD_MS = 30_000;

function toRequest(id: string, p: PlannedNotification, feature: string): Notifications.NotificationRequestInput {
  return {
    identifier: id,
    content: {
      title: p.title,
      body: p.body,
      data: { ...p.data, feature },
      categoryIdentifier: p.categoryId,
      sticky: p.sticky,
      sound: p.silent ? false : (p.sound ?? (p.alarm ? 'default' : undefined)),
      priority: p.alarm ? 'max' : 'default',
    },
    trigger: p.immediate
      ? { channelId: p.channel }
      : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.at, channelId: p.channel, delivery: p.alarm ? 'alarmClock' : 'bestEffort' },
  };
}

/**
 * Collects every feature's planned notifications and reconciles them with what's scheduled:
 * stale ones are cancelled, current ones (re)scheduled. Called when the app opens, when data
 * changes, and from the background task.
 */
export async function replanNotifications(analysis: Analysis, state: AppState, opts: { background?: boolean; now?: number } = {}): Promise<void> {
  if (Platform.OS === 'web') return;
  await configureNotifications();
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  const now = opts.now ?? Date.now();
  const ctx = { analysis, state, now, background: !!opts.background };

  const wanted = new Map<string, { p: PlannedNotification; feature: string }>();
  // Due within seconds: already scheduled (or about to show) — neither reschedule nor cancel it.
  const imminent = new Set<string>();
  for (const f of FEATURES) {
    let planned: PlannedNotification[] = [];
    try {
      planned = f.plan(ctx);
    } catch (e) {
      console.warn(`notification feature ${f.id} failed to plan`, e);
    }
    for (const p of planned) {
      const id = plannedId(f.id, p.id);
      if (!p.immediate && p.at > now - MIN_LEAD_MS && p.at <= now + MIN_LEAD_MS) imminent.add(id);
      if (!p.immediate && (p.at <= now + MIN_LEAD_MS || p.at > now + HORIZON)) continue;
      wanted.set(id, { p, feature: f.id });
    }
  }

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.identifier.startsWith(PLAN_PREFIX) && !wanted.has(n.identifier) && !imminent.has(n.identifier)) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined);
    }
  }
  for (const [id, { p, feature }] of wanted) {
    await Notifications.scheduleNotificationAsync(toRequest(id, p, feature)).catch((e) => console.warn('schedule failed', id, e));
  }
}

/** Routes a tapped notification / action button to the feature that created it. */
export async function handleNotificationResponse(r: Notifications.NotificationResponse, state: AppState): Promise<void> {
  const data = (r.notification.request.content.data ?? {}) as Record<string, unknown>;
  const feature = FEATURES.find((f) => f.id === data.feature);
  if (!feature?.onResponse) return;
  const response: NotificationResponse = {
    actionId: r.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER ? 'default' : r.actionIdentifier,
    data,
  };
  await feature.onResponse(response, state);
  // So a remount in the same process doesn't replay the tap.
  Notifications.clearLastNotificationResponse();
}

/** Dismisses a delivered (e.g. sticky) planner notification. */
export async function dismissPlanned(featureId: string, id: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.dismissNotificationAsync(plannedId(featureId, id)).catch(() => undefined);
}
