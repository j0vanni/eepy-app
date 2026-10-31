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
