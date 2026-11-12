import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { Analysis } from '../../engine/analysis';
import { activeExperiment, computeExperimentResult, Experiment, ExperimentData, experimentData, ExperimentResult, rankTemplates, suggestionInput, TemplateSuggestion } from '../../engine/experiments';
import { evaluateGoals, goalInput, GoalInput, GoalsSummary } from '../../engine/goals';
import { buildWeeklyReview, latestReviewWeek, WeeklyReview } from '../../engine/weeklyReview';
import { selectDataset, useStore } from '../../state/store';

/** Mark (settings.marks) holding the week of the last weekly review that was opened. */
export const REVIEW_SEEN_MARK = 'weeklyReview.seen';

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

/** Progress and the before/after comparison for one experiment. */
export function useExperimentResult(a: Analysis | undefined, exp: Experiment | undefined): ExperimentResult | undefined {
  const data = useExperimentData(a);
  return useMemo(() => (exp && data ? computeExperimentResult(exp, data) : undefined), [exp, data]);
}

/** The latest weekly review, and whether it has been opened yet. */
export function useLatestReview(a: Analysis | undefined): { week: string; review: WeeklyReview; isNew: boolean } | undefined {
  const data = useStore(useShallow(selectDataset));
  const goals = useStore((s) => s.goals);
  const experiments = useStore((s) => s.experiments);
  const seen = useStore((s) => s.settings.marks[REVIEW_SEEN_MARK]);
  return useMemo(() => {
    if (!a) return undefined;
    const week = latestReviewWeek(a.day);
    return { week, review: buildWeeklyReview({ analysis: a, data, goals, experiments, weekStart: week }), isNew: seen !== week };
  }, [a, data, goals, experiments, seen]);
}
