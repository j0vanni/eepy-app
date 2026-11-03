/**
 * The bedtime rundown in the app (the model is engine/rundown.ts): tonight's rundown for the
 * screens, the guided player's Done / Skip / Back (kept in `settings.rundownProgress` for tonight,
 * so leaving and coming back resumes), and edits from Settings → Your bedtime rundown.
 */
import { useMemo } from 'react';

import type { Analysis } from '../engine/analysis';
import {
  backRundownStep,
  markRundownStep,
  phoneDownAt,
  playerPosition,
  progressFor,
  Rundown,
  rundownFor,
  RundownSettings,
  startRundownProgress,
} from '../engine/rundown';
import { AppState, useStore } from './store';

type RundownView = Pick<AppState, 'settings' | 'profile' | 'cbti'>;

/** Tonight's rundown (undefined when it's off or there's no plan yet), with the player's progress fitted at `now`. */
export function useRundown(a: Analysis | undefined, now: number): Rundown | undefined {
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const cbti = useStore((s) => s.cbti);
  return useMemo(() => (a ? rundownFor(a, { settings, profile, cbti }, now) : undefined), [a, settings, profile, cbti, now]);
}

/** When the phone goes down tonight: the rundown's phone-down, or `screensOffMin` before lights-out when it's off. */
export function usePhoneDown(a: Analysis | undefined): number | undefined {
  const rundown = useStore((s) => s.settings.rundown);
  const screensOffMin = useStore((s) => s.settings.screensOffMin);
  return a ? phoneDownAt(a.tonight, { rundown, screensOffMin }) : undefined;
}

const view = (): RundownView => useStore.getState();
const tonightsRundown = (a: Analysis, now: number) => rundownFor(a, view(), now);

/** "Start my rundown" (`pickUp`: start at the step happening now; the ones before count as skipped). */
export function startRundown(a: Analysis, now = Date.now(), pickUp = false): void {
  const st = view();
  const r = rundownFor(a, { ...st, settings: { ...st.settings, rundownProgress: undefined } }, now);
  if (r) useStore.getState().setSettings({ rundownProgress: startRundownProgress(r, now, pickUp) });
}

/** Done / Skip on the player's current step. */
export function markRundown(a: Analysis, s: 'done' | 'skipped', now = Date.now()): void {
  const r = tonightsRundown(a, now);
  const p = progressFor(useStore.getState().settings.rundownProgress, a.tonight.wakeDate);
  const step = r && playerPosition(r).step;
  if (!r || !p || !step) return;
  useStore.getState().setSettings({ rundownProgress: markRundownStep(p, step.id, s, now) });
}

/** Back: the step before comes up again. */
export function backRundown(a: Analysis, now = Date.now()): void {
  const r = tonightsRundown(a, now);
  const p = progressFor(useStore.getState().settings.rundownProgress, a.tonight.wakeDate);
  if (r && p) useStore.getState().setSettings({ rundownProgress: backRundownStep(p, r, now) });
}

/** Start over (forgets tonight's progress). */
export function resetRundownProgress(): void {
  useStore.getState().setSettings({ rundownProgress: undefined });
}

/** An edit from Settings → Your bedtime rundown (pure reducers in engine/rundown.ts). */
export function updateRundown(fn: (s: RundownSettings) => RundownSettings): void {
  const st = useStore.getState();
  const next = fn(st.settings.rundown);
  if (next !== st.settings.rundown) st.setSettings({ rundown: next });
}
