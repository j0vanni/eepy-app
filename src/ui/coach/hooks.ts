import { useMemo } from 'react';

import type { Analysis } from '../../engine/analysis';
import { activeExperiment, ExperimentData, experimentData, rankTemplates, suggestionInput, TemplateSuggestion } from '../../engine/experiments';
import { evaluateGoals, goalInput, GoalInput, GoalsSummary } from '../../engine/goals';
import { useStore } from '../../state/store';

/** Experiment inputs (analysis + journal/caffeine/vitals) memoised per data change. */
export function useExperimentData(a: Analysis | undefined): ExperimentData | undefined {
  const vitals = useStore((s) => s.vitals);
  const dayLogs = useStore((s) => s.dayLogs);
  const caffeine = useStore((s) => s.caffeine);
  const workouts = useStore((s) => s.workouts);
  return useMemo(() => (a ? experimentData(a, { vitals, dayLogs, caffeine, workouts }) : undefined), [a, vitals, dayLogs, caffeine, workouts]);
}

export function useActiveExperiment() {
  const experiments = useStore((s) => s.experiments);
  return useMemo(() => activeExperiment(experiments), [experiments]);
}

export function useSuggestions(a: Analysis | undefined): TemplateSuggestion[] {
  const dayLogs = useStore((s) => s.dayLogs);
  const caffeine = useStore((s) => s.caffeine);
  const experiments = useStore((s) => s.experiments);
  return useMemo(() => (a ? rankTemplates(suggestionInput(a, { dayLogs, caffeine }, experiments)) : []), [a, dayLogs, caffeine, experiments]);
}

export function useGoalInput(a: Analysis | undefined): GoalInput | undefined {
  const dayLogs = useStore((s) => s.dayLogs);
  const caffeine = useStore((s) => s.caffeine);
  const profile = useStore((s) => s.profile);
  return useMemo(() => (a ? goalInput(a, { dayLogs, caffeine, profile }) : undefined), [a, dayLogs, caffeine, profile]);
}

export function useGoalsSummary(a: Analysis | undefined): GoalsSummary | undefined {
  const goals = useStore((s) => s.goals);
  const input = useGoalInput(a);
  return useMemo(() => (input ? evaluateGoals(goals, input) : undefined), [goals, input]);
}
