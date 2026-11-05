/**
 * eepy dimming itself in the evening (ui/EveningScreen.tsx, the rundown player): on with
 * settings.screenDim, and off "for tonight" (until the next noon) as soon as you set the brightness
 * yourself — eepy's Brightness control (its own window) or the phone-brightness slider.
 */
import { atMinutes, dateKey, minutesOfDay } from '../engine/time';
import type { Settings } from './store';

/** Whether eepy dims and tints itself right now (the setting is on and not paused with "Brighter"). */
export function eepyDimOn(settings: Pick<Settings, 'screenDim' | 'screenDimPausedUntil'>, now: number): boolean {
  return settings.screenDim && !(settings.screenDimPausedUntil !== undefined && now < settings.screenDimPausedUntil);
}

/** "Brighter" lasts until the next noon: the rest of tonight, and the morning. */
export function brighterUntil(now: number): number {
  const noon = atMinutes(dateKey(now), 12 * 60);
  return minutesOfDay(now) < 12 * 60 ? noon : noon + 24 * 3600_000;
}

/**
 * You set the brightness yourself: auto-dimming off until the next noon, eepy's own window at
 * `slider` (eepy's control) or following the phone's brightness (undefined).
 */
export function manualBrightness(now: number, slider?: number): Pick<Settings, 'screenDimPausedUntil' | 'eepyBrightness'> {
  return { screenDimPausedUntil: brighterUntil(now), eepyBrightness: slider };
}

/** Back to eepy's automatic evening dimming. */
export const AUTO_BRIGHTNESS: Pick<Settings, 'screenDimPausedUntil' | 'eepyBrightness'> = { screenDimPausedUntil: undefined, eepyBrightness: undefined };

/** eepy's own window right now: auto-dimmed to a slider position, set by you, or following the phone. */
export function eepyWindowMode(
  settings: Pick<Settings, 'screenDim' | 'screenDimPausedUntil' | 'eepyBrightness'>,
  now: number,
  autoDimTo: number | undefined,
): { kind: 'auto'; slider: number } | { kind: 'manual'; slider: number } | { kind: 'phone' } {
  const paused = settings.screenDimPausedUntil !== undefined && now < settings.screenDimPausedUntil;
  if (paused && settings.eepyBrightness !== undefined) return { kind: 'manual', slider: settings.eepyBrightness };
  if (!paused && settings.screenDim && autoDimTo !== undefined) return { kind: 'auto', slider: autoDimTo };
  return { kind: 'phone' };
}

