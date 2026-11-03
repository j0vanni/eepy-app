/**
 * Two-step mornings (engine/twoStep.ts) when the routine doesn't happen:
 *
 * - **At the time** — "Skip it — back to sleep until 6:00" on Today's routine card, or "Skip routine"
 *   on the routine alarm's watch buzz: the routine alarm stops (buzzes, phone backup, the native
 *   alarm), the final alarm still rings, and the morning is recorded as a one-alarm morning.
 * - **Afterwards** — "Your 5:00 routine: Did it / Skipped it" on the morning check-in and the night
 *   screen, for when you slept through it or just turned the alarm off without telling eepy.
 *
 * Both write the morning's record, `profile.wakePlan[date].twoStep` (true = did it, false = skipped),
 * which wake-up detection reads (twoStep.routineWindowFor): skipped, an early wake-up is just a
 * wake-up — not the routine's planned time awake — and with no sleep after it, it was the real one.
 * At the time, WAKE_ROUTINE_SKIP_MARK also stops the routine alarm (it may be held after 4am).
 */
import type { Analysis } from '../engine/analysis';
import { wakeTargetFor } from '../engine/schedule';
import { addDays, dateKey } from '../engine/time';
import { RoutineWindow, routineWindowFor } from '../engine/twoStep';
import type { DayWakePlan, Profile } from '../engine/types';
import { resetWakeAlarmMemo, syncWakeAlarm, WAKE_ROUTINE_SKIP_MARK } from '../notifications/fullScreenAlarm';
import { useStore } from './store';

/** Saves (or clears) one morning's wake plan; mornings older than a month are dropped to keep the store small. */
export function setWakePlanFor(date: string, plan: DayWakePlan | undefined, now = Date.now()): void {
  const st = useStore.getState();
  const next: Record<string, DayWakePlan> = { ...(st.profile.wakePlan ?? {}) };
  if (plan && Object.keys(plan).length) next[date] = plan;
  else delete next[date];
  for (const k of Object.keys(next)) if (k < addDays(dateKey(now), -30)) delete next[k];
  st.setProfile({ wakePlan: next });
}

export type RoutineOutcome = 'done' | 'skipped';

/** What you said about a morning's routine, if anything. */
export function routineOutcome(profile: Pick<Profile, 'wakePlan'>, date: string): RoutineOutcome | undefined {
  const c = profile.wakePlan?.[date]?.twoStep;
  return c === true ? 'done' : c === false ? 'skipped' : undefined;
}

/**
 * Whether a morning was planned as a two-step morning — by the weekly setting or a date switched on
 * beforehand — ignoring what you said about it afterwards (that's what the question is about).
 */
export function plannedRoutineFor(profile: Profile, date: string): RoutineWindow | undefined {
  const day = profile.wakePlan?.[date];
  const asPlanned: Profile = day?.twoStep === undefined ? profile : { ...profile, wakePlan: { ...profile.wakePlan, [date]: { ...day, twoStep: undefined } } };
  return routineWindowFor(asPlanned, date, wakeTargetFor(asPlanned, date));
}

/** Records a morning's routine as done or skipped (undefined: back to what the week says). Other fields of that day stay. */
export function setRoutineOutcome(date: string, outcome: RoutineOutcome | undefined): void {
  const prev = useStore.getState().profile.wakePlan?.[date];
  const { twoStep: _drop, ...rest } = prev ?? {};
  setWakePlanFor(date, outcome === undefined ? rest : { ...rest, twoStep: outcome === 'done' });
}

/** Re-plans reminders and the native alarms now, when there's an analysis to plan from (in the app). */
async function replan(analysis: Analysis | undefined): Promise<void> {
  if (!analysis) return;
  const state = useStore.getState();
  // Required lazily: the scheduler pulls in every notification feature, and reminders.ts imports this module.
  const { replanNotifications } = require('../notifications/scheduler') as typeof import('../notifications/scheduler');
  await replanNotifications(analysis, state).catch(() => undefined);
  await syncWakeAlarm(analysis, state).catch(() => undefined);
}

export interface RoutineSkipUndo {
  date: string;
  /** That morning's calendar entry before the skip. */
  prev?: DayWakePlan;
}

/**
 * "Skip it — back to sleep": the routine alarm stops (and won't ring), the final alarm still rings,
 * and the morning is recorded as skipped. Returns what Undo needs.
 */
export async function skipRoutine(date: string, analysis?: Analysis): Promise<RoutineSkipUndo> {
  const st = useStore.getState();
  const prev = st.profile.wakePlan?.[date];
  st.setMark(WAKE_ROUTINE_SKIP_MARK, date);
  setRoutineOutcome(date, 'skipped');
  // Stop it right away (it may be ringing or snoozed); the re-plan then leaves it off.
  const { cancelRoutineAlarms } = require('../notifications/features/reminders') as typeof import('../notifications/features/reminders');
  await cancelRoutineAlarms().catch(() => undefined);
  resetWakeAlarmMemo();
  await replan(analysis);
  return { date, ...(prev ? { prev } : {}) };
}

/** Undo: the routine alarm comes back (if it's still ahead) and the morning's record is as before. */
export async function undoSkipRoutine(undo: RoutineSkipUndo, analysis?: Analysis): Promise<void> {
  const st = useStore.getState();
  if (st.settings.marks[WAKE_ROUTINE_SKIP_MARK] === undo.date) st.setMark(WAKE_ROUTINE_SKIP_MARK, undefined);
  setWakePlanFor(undo.date, undo.prev);
  resetWakeAlarmMemo();
  await replan(analysis);
}
