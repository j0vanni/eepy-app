/**
 * "Options for tonight" in the app (the decisions are in engine/planOptions.ts):
 * - `usePlanOptions`: tonight's options, shared by the Planner card and Today's "Still up?" card.
 * - `applyPlanOption`: the user's tap — `settings.tonight` (lights-out / wake-up for this night, and
 *   which option is in use) and the morning's routine alarm (`wakePlan[date].twoStep`). Alarms,
 *   reminders and sleep mode follow from the analysis as they always do.
 * - `recordPlannedNight`: keeps `planLog` (what eepy planned each night) for adherence.ts.
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { logPlannedNight } from '../engine/adherence';
import type { Analysis } from '../engine/analysis';
import { inBedTonight } from '../engine/inBed';
import { OptionApply, PlanOptions, planTonightOptions } from '../engine/planOptions';
import { addDays, dateKey, MINUTE } from '../engine/time';
import type { DayWakePlan } from '../engine/types';
import { selectDataset, useStore } from './store';

let cache: { key: unknown[]; value: PlanOptions | undefined } | undefined;

/** Tonight's options (undefined while in bed, in the insomnia programme, or without a plan). Recomputed every 5 minutes. */
export function usePlanOptions(a: Analysis | undefined, now: number): PlanOptions | undefined {
  const data = useStore(useShallow(selectDataset));
  const override = useStore((s) => s.settings.tonight);
  const planLog = useStore((s) => s.planLog);
  const inBed = useStore((s) => !!a && inBedTonight(s.settings.session, a.tonight.wakeDate));
  const screensOff = useStore((s) => s.settings.notifications.screensOff);
  const bucket = Math.floor(now / (5 * MINUTE));
  return useMemo(() => {
    const key = [a, data.dayLogs, data.caffeine, data.profile, override, planLog, inBed, screensOff, bucket];
    if (cache && cache.key.every((k, i) => k === key[i])) return cache.value;
    const value = a ? planTonightOptions({ analysis: a, data, now: Math.max(now, a.now), override, planLog, inBed, screensOffReminder: screensOff }) : undefined;
    cache = { key, value };
    return value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, data, override, planLog, inBed, screensOff, bucket]);
}

/** Sets (or clears, null) one morning's routine-alarm choice, dropping mornings older than a month like the Planner does. */
function setRoutineChoice(date: string, routine: boolean | null): void {
  const state = useStore.getState();
  const cur = state.profile.wakePlan?.[date];
  if ((routine === null ? undefined : routine) === cur?.twoStep) return;
  const plan: DayWakePlan = { ...cur };
  if (routine === null) delete plan.twoStep;
  else plan.twoStep = routine;
  const next: Record<string, DayWakePlan> = { ...(state.profile.wakePlan ?? {}) };
  if (Object.keys(plan).length) next[date] = plan;
  else delete next[date];
  const oldest = addDays(dateKey(Date.now()), -30);
  for (const k of Object.keys(next)) if (k < oldest) delete next[k];
  state.setProfile({ wakePlan: next });
}

/** "Use this": tonight's times and the morning's routine as the option says (the plan's own option clears your changes). */
export function applyPlanOption(apply: OptionApply): void {
  const state = useStore.getState();
  setRoutineChoice(apply.wakeDate, apply.routine);
  const cur = state.settings.tonight;
  // An override for another night is stale anyway; only replace tonight's.
  if (apply.tonight) state.setSettings({ tonight: apply.tonight });
  else if (cur) state.setSettings({ tonight: undefined });
}

/** Writes tonight's plan to `planLog` (until its lights-out; an open sleep session never changes it). */
export function recordPlannedNight(a: Analysis, now = Date.now()): void {
  const state = useStore.getState();
  const inBed = inBedTonight(state.settings.session, a.tonight.wakeDate);
  const next = logPlannedNight(state.planLog, { tonight: a.tonight, now, inBed });
  if (next !== state.planLog) state.setPlanLog(next);
}
