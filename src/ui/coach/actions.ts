import type { Analysis } from '../../engine/analysis';
import { adherenceFor, createExperiment, defaultTargetMin, Experiment, ExperimentDay, experimentData, ExperimentTemplate } from '../../engine/experiments';
import { addDays } from '../../engine/time';
import { useStore } from '../../state/store';

/** Sets (or with `undefined`, clears back to "inferred") the manual adherence answer for a day. */
export function setAnswer(e: Experiment, date: string, value: boolean | undefined) {
  const adherence = { ...e.adherence };
  if (value === undefined) delete adherence[date];
  else adherence[date] = value;
  useStore.getState().upsertExperiment({ ...e, adherence });
}

/** Tap cycle on a progress dot: no answer → yes → no → back to automatic. */
export function cycleAnswer(e: Experiment, d: ExperimentDay) {
  const manual = e.adherence[d.date];
  if (manual === undefined) setAnswer(e, d.date, d.adherence.value === true ? false : true);
  else if (manual === true) setAnswer(e, d.date, false);
  else setAnswer(e, d.date, undefined);
}

/** Demo mode: how far back to pretend an experiment started, so it's mid-way with interim results. */
export const demoBackdateDays = (t: ExperimentTemplate) => Math.max(1, t.durationDays - 3);

export function startExperiment(t: ExperimentTemplate, a: Analysis, opts: { targetMin?: number; backdateDays?: number } = {}): Experiment {
  const s = useStore.getState();
  const now = Date.now();
  let e = createExperiment(t, {
    startDate: addDays(a.day, -(opts.backdateDays ?? 0)),
    now,
    targetMin: opts.targetMin ?? defaultTargetMin(t, { ...a, profile: s.profile }),
  });
  if (opts.backdateDays) {
    // Demo only: answer the past days the data can't settle, as if the user had kept to the rule.
    const d = experimentData(a, s);
    const adherence: Record<string, boolean> = {};
    for (let i = 0; i < opts.backdateDays; i++) {
      const date = addDays(e.startDate, i);
      if (date < a.day && adherenceFor(e, date, d).value === undefined) adherence[date] = true;
    }
    e = { ...e, adherence };
  }
  s.upsertExperiment(e);
  return e;
}
