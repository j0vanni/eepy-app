/**
 * Goals & streaks (consistent wake time, low sleep debt, caffeine cut-off kept, …).
 *
 * OWNER: coach workstream. Stub types only until implemented.
 */
export type GoalId = 'consistent-wake' | 'debt-under-2h' | 'caffeine-cutoff' | 'in-bed-on-time' | 'meet-need' | 'wind-down';

export interface GoalSetting {
  id: GoalId;
  enabled: boolean;
  /** Date the goal was switched on (YYYY-MM-DD). */
  startedAt: string;
}
