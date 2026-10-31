/**
 * Tonight's wind-down as a timeline: when the lights dim, when screens go off and the phone goes
 * on the charger, the screen-free part of the routine, and lights-out. Times come from tonight's
 * plan (so an adjusted or eased night moves everything). Pure.
 *
 * Why screens off before bed (default 45 min): evening screen light delays melatonin, and
 * scrolling keeps the brain engaged — what's on the screen (messages, news, games) postpones sleep
 * as much as the light does. The last stretch should be calm and screen-free: dim warm light,
 * reading on paper, stretching, breathing.
 */
import { EVENING_LEAD_MIN } from './screenLight';
import type { TonightPlan } from './schedule';
import { MINUTE } from './time';

export const SCREENS_OFF_OPTIONS = [30, 45, 60] as const;
export const DEFAULT_SCREENS_OFF_MIN = 45;

export type WindDownStepId = 'evening-light' | 'last-meal' | 'exercise' | 'wind-down' | 'screens-off' | 'routine' | 'lights-out';

export interface WindDownStep {
  id: WindDownStepId;
  at: number;
  title: string;
  detail: string;
  icon: string;
}

/** When screens should be off tonight: `screensOffMin` before lights-out, never before wind-down starts. */
export function screensOffAt(t: Pick<TonightPlan, 'bedtime' | 'windDownStart'>, screensOffMin = DEFAULT_SCREENS_OFF_MIN): number {
  return Math.max(t.windDownStart, t.bedtime - screensOffMin * MINUTE);
}

export function windDownTimeline(t: TonightPlan, screensOffMin = DEFAULT_SCREENS_OFF_MIN): WindDownStep[] {
  const off = screensOffAt(t, screensOffMin);
  const routine = Math.max(off, t.bedtime - 20 * MINUTE);
  const steps: WindDownStep[] = [
    {
      id: 'evening-light',
      at: Math.min(t.bedtime - EVENING_LEAD_MIN * MINUTE, t.windDownStart),
      title: 'Evening light',
      detail: 'Night Light on, screens at half brightness or less, switch big overhead lights to lamps.',
      icon: 'weather-sunset',
    },
    { id: 'last-meal', at: t.lastMeal, title: 'Last big meal', detail: 'A light snack later is fine; a heavy meal keeps your body busy into the night.', icon: 'silverware-fork-knife' },
    { id: 'exercise', at: t.lastExercise, title: 'Hard exercise done', detail: 'Gentle stretching or a walk is fine after this.', icon: 'run' },
    {
      id: 'wind-down',
      at: t.windDownStart,
      title: 'Wind-down starts',
      detail: 'Dim the lights, cool the bedroom, lay out tomorrow. Night Light at its warmest, Extra dim on.',
      icon: 'weather-night',
    },
    {
      id: 'screens-off',
      at: off,
      title: 'Screens off',
      detail: 'TV, laptop and phone off. Send last messages and check the alarm first, then put the phone on the charger, face down — sleep sounds keep playing.',
      icon: 'cellphone-off',
    },
    {
      id: 'routine',
      at: routine,
      title: 'Screen-free routine',
      detail: 'Teeth, skin care, a few pages of a paper book or slow breathing in dim, warm light.',
      icon: 'book-open-page-variant-outline',
    },
    { id: 'lights-out', at: t.bedtime, title: 'Lights out', detail: 'Dark, cool, quiet. Not sleepy after ~20 minutes? Get up and read in dim light until you are.', icon: 'sleep' },
  ];
  // Drop the routine step when there's no room for it, and keep everything in time order.
  return steps.filter((s) => !(s.id === 'routine' && t.bedtime - routine <= 15 * MINUTE)).sort((a, b) => a.at - b.at);
}

/** The step happening now (the latest one that has started), if the evening is under way. */
export function currentWindDownStep(steps: WindDownStep[], now: number): WindDownStep | undefined {
  const started = steps.filter((s) => s.at <= now);
  return started[started.length - 1];
}
