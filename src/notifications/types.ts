import type { Analysis } from '../engine/analysis';
import type { AppState } from '../state/store';

export type ChannelId = 'reminders' | 'alarms' | 'pings' | 'reports' | 'live';

export interface PlannedNotification {
  /** Stable id, unique within the feature. The scheduler namespaces it. */
  id: string;
  /** When to deliver (epoch ms). Ignored when `immediate` is set. */
  at: number;
  /** Present right away instead of scheduling (e.g. a morning report the moment last night syncs). */
  immediate?: boolean;
  title: string;
  body: string;
  channel: ChannelId;
  /** Action buttons registered by the feature (see NotificationFeature.categories). */
  categoryId?: string;
  data?: Record<string, unknown>;
  /** Exact alarm-clock delivery (rings in Doze). */
  alarm?: boolean;
  /** Pinned until dismissed by the app. */
  sticky?: boolean;
}

export interface PlannerContext {
  analysis: Analysis;
  state: AppState;
  now: number;
  /** True when called from the background task rather than the open app. */
  background: boolean;
}

export interface NotificationAction {
  id: string;
  title: string;
  /** Bring the app to the foreground when tapped (default true). */
  opensApp?: boolean;
}

export interface NotificationResponse {
  /** Action button id, or 'default' when the notification body was tapped. */
  actionId: string;
  data: Record<string, unknown>;
}

/**
 * One self-contained notification feature. Add a file under ./features and register it in
 * ./features/index.ts — the scheduler takes care of permissions, channels and de-duplication.
 */
export interface NotificationFeature {
  id: string;
  plan(ctx: PlannerContext): PlannedNotification[];
  categories?: { id: string; actions: NotificationAction[] }[];
  onResponse?(response: NotificationResponse, state: AppState): void | Promise<void>;
}
