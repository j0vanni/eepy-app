/**
 * Phone-screen light through the day: how bright the screen should be and when to warm it (Night
 * Light / blue-light filter), from tonight's plan. Pure.
 *
 * The science, briefly: the body clock and melatonin respond to light through melanopsin cells
 * that are most sensitive to blue (~480 nm). In the evening, light delays melatonin — how much
 * depends mostly on how bright it is at the eye, and on its blue content. A phone held close at
 * full brightness can reach tens of lux; dimming cuts all of it, a warm filter cuts the blue part,
 * so both together work best. Melatonin starts rising roughly 2–3 hours before your usual sleep,
 * which is when the evening limits start. In the morning a screen is far too dim to set the clock
 * (outdoor light is 100–1000× brighter), so there it only shouldn't stand in for daylight.
 */
import { HOUR, MINUTE } from './time';

export type ScreenPhase = 'morning' | 'day' | 'evening' | 'winddown' | 'night';

export interface ScreenTarget {
  phase: ScreenPhase;
  from: number;
  until: number;
  /**
   * Highest brightness to aim for, as a position of Android's brightness slider (0–1) — what the
   * user sees and drags. The slider is perceptual: 50% is only ~8% of the panel's light output.
   */
  maxBrightness: number;
  /** Blue-light filter: off, Night Light on, or Night Light at its warmest (+ Extra dim). */
  filter: 'off' | 'warm' | 'warmest';
  title: string;
  advice: string;
}

/** Evening limits start this long before lights-out (melatonin onset is ~2–3 h before sleep). */
export const EVENING_LEAD_MIN = 180;
/** Morning guidance lasts this long after waking. */
const MORNING_MIN = 120;

export interface ScreenPlanInput {
  /** Today's wake-up. */
  wakeTime: number;
  windDownStart: number;
  bedtime: number;
  /** Tomorrow's wake-up. */
  nextWake: number;
}

/** Today's phases from this morning's wake-up to tomorrow's, in order. */
export function screenLightSchedule(p: ScreenPlanInput): ScreenTarget[] {
  const morningEnd = Math.min(p.wakeTime + MORNING_MIN * MINUTE, p.windDownStart);
  const eveningStart = Math.max(morningEnd, Math.min(p.bedtime - EVENING_LEAD_MIN * MINUTE, p.windDownStart));
  const out: ScreenTarget[] = [
    {
      phase: 'morning',
      from: p.wakeTime,
      until: morningEnd,
      maxBrightness: 1,
      filter: 'off',
      title: 'Morning: bright is fine',
      advice: 'No filter needed. But a screen gives ~50 lux at your face; daylight outside gives 1,000–100,000 — get outside for the light that sets your clock.',
    },
    {
      phase: 'day',
      from: morningEnd,
      until: eveningStart,
      maxBrightness: 1,
      filter: 'off',
      title: 'Daytime: anything goes',
      advice: 'Bright screens and rooms during the day help you feel alert now and sleepy tonight.',
    },
    {
      phase: 'evening',
      from: eveningStart,
      until: p.windDownStart,
      maxBrightness: 0.5,
      filter: 'warm',
      title: 'Evening: warm and dimmer',
      advice: 'Night Light on (blue-light filter), dark mode, brightness slider at or under half. Melatonin is starting to rise.',
    },
    {
      phase: 'winddown',
      from: p.windDownStart,
      until: p.bedtime,
      maxBrightness: 0.3,
      filter: 'warmest',
      title: 'Wind-down: as dim as you can read',
      advice: 'Night Light at its warmest plus Extra dim, brightness at or under 30%, phone at arm’s length — or put it down.',
    },
    {
      phase: 'night',
      from: p.bedtime,
      until: p.nextWake,
      maxBrightness: 0.15,
      filter: 'warmest',
      title: 'Night: screen away',
      advice: 'If you must look: lowest brightness, Extra dim, warmest filter, and only for a moment — no scrolling in bed.',
    },
  ];
  return out.filter((t) => t.until > t.from);
}

/** The phase `now` falls in (before this morning's wake counts as night, after tomorrow's as morning). */
export function screenTargetAt(p: ScreenPlanInput, now: number): ScreenTarget {
  const schedule = screenLightSchedule(p);
  const hit = schedule.find((t) => now >= t.from && now < t.until);
  if (hit) return hit;
  const night = schedule.find((t) => t.phase === 'night') ?? schedule[schedule.length - 1];
  if (now < p.wakeTime) return { ...night, from: now - HOUR, until: p.wakeTime };
  return schedule[0];
}

export type ScreenVerdict = { tone: 'good' | 'warn' | 'bad'; text: string };

/** How the current brightness (slider position 0–1, if known) compares with the target. */
export function judgeScreenBrightness(brightness: number | undefined, target: ScreenTarget): ScreenVerdict | undefined {
  if (brightness === undefined || target.maxBrightness >= 1) return undefined;
  const pct = Math.round(brightness * 100);
  const max = Math.round(target.maxBrightness * 100);
  if (brightness <= target.maxBrightness + 0.02) return { tone: 'good', text: `Screen at ${pct}% — within the ${max}% target.` };
  // Slider positions are perceptual, so 'a little over' is a fixed step rather than a multiple.
  if (brightness <= target.maxBrightness + 0.2) return { tone: 'warn', text: `Screen at ${pct}% — a little bright; aim for ${max}% or less.` };
  return { tone: 'bad', text: `Screen at ${pct}% — too bright for now; aim for ${max}% or less.` };
}

/** Night Light schedule to set in Android (custom times): on at the evening start, off at wake-up. */
export function nightLightSchedule(p: ScreenPlanInput): { on: number; off: number } {
  const evening = screenLightSchedule(p).find((t) => t.phase === 'evening' || t.phase === 'winddown');
  return { on: evening?.from ?? p.windDownStart, off: p.nextWake };
}

// Android's brightness slider is perceptual: AOSP maps the panel's linear brightness to the slider
// with an HLG-style curve (frameworks/base BrightnessUtils). Matching it means "30%" in eepy is
// the same as 30% on the phone's own slider.
const HLG = { r: 0.5, a: 0.17883277, b: 0.28466892, c: 0.55991073 };

/** Linear panel brightness (0–1, as Android stores it) → slider position (0–1). */
export function linearToSlider(linear: number): number {
  const v = Math.max(0, Math.min(1, linear)) * 12;
  const g = v <= 1 ? HLG.r * Math.sqrt(v) : HLG.a * Math.log(v - HLG.b) + HLG.c;
  return Math.max(0, Math.min(1, g));
}

/** Slider position (0–1) → linear panel brightness (0–1). */
export function sliderToLinear(slider: number): number {
  const g = Math.max(0, Math.min(1, slider));
  const v = g <= HLG.r ? (g / HLG.r) ** 2 : Math.exp((g - HLG.c) / HLG.a) + HLG.b;
  return Math.max(0, Math.min(1, v / 12));
}
