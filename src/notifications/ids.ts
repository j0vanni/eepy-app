/**
 * Identifiers of planner notifications. Dependency-free, so features can cancel each other's
 * notifications without importing the scheduler (which imports every feature).
 */
export const PLAN_PREFIX = 'eepy-plan-';

export function plannedId(featureId: string, id: string): string {
  return `${PLAN_PREFIX}${featureId}-${id}`;
}

/** "Running late" button on the wind-down / lights-out notifications: opens Adjust tonight. */
export const RUNNING_LATE_CATEGORY = 'tonight-late';
export const RUNNING_LATE_ACTION = 'late';
/** "I'm in bed" button on the same notifications: opens eepy and starts the sleep session (eepy://quick/inbed). */
export const IN_BED_ACTION = 'in-bed';
export const IN_BED_LINK = '/quick/inbed';

/** Tonight's evening notifications that are noise once you're in bed (dismissed by "I'm in bed"). */
export function eveningNotificationIds(wakeDate: string): string[] {
  return [plannedId('liveWindDown', 'live'), plannedId('reminders', 'winddown'), plannedId('reminders', 'bedtime'), plannedId('screensOff', wakeDate), plannedId('screenLight', wakeDate)];
}
