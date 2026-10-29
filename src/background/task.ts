/**
 * Background sync: pulls new Health Connect data, re-runs the engine and re-plans notifications
 * (morning report, adaptive reminders, pings) while eepy is closed.
 *
 * This module is imported from the app entry (index.ts) so the task is defined before Android
 * wakes the JS runtime headlessly.
 * OWNER: background & notifications workstream. Stub — defines nothing until implemented.
 */
export const BACKGROUND_SYNC_TASK = 'eepy-background-sync';

/** Registers (or unregisters) the periodic background task according to settings. */
export async function registerBackgroundSync(_enabled: boolean): Promise<void> {}
