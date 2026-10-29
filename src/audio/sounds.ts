import type { AudioSettings } from '../state/store';

export type SoundId = AudioSettings['sound'];

export interface SoundInfo {
  id: SoundId;
  label: string;
  blurb: string;
  icon: string;
}

/** Display order and copy for the generated loops in assets/audio/ (see scripts/generate-sounds.js). */
export const SOUNDS: SoundInfo[] = [
  { id: 'brown', label: 'Brown', blurb: 'Deep, soft rumble — like a distant waterfall', icon: 'waves' },
  { id: 'pink', label: 'Pink', blurb: 'Balanced, like steady wind or surf', icon: 'weather-windy' },
  { id: 'white', label: 'White', blurb: 'Bright hiss that masks voices and traffic', icon: 'blur' },
  { id: 'rain', label: 'Rain', blurb: 'Steady rain with soft droplets', icon: 'weather-pouring' },
];

export function soundInfo(id: SoundId): SoundInfo {
  return SOUNDS.find((s) => s.id === id) ?? SOUNDS[0];
}

/** Sleep-timer choices in minutes; 0 plays until stopped. */
export const TIMER_OPTIONS = [0, 15, 30, 45, 60, 90] as const;

/** Compact label for the timer selector: Off · 15m · 30m · 45m · 1h · 1½h. */
export function timerShortLabel(min: number): string {
  if (min <= 0) return 'Off';
  if (min < 60) return `${min}m`;
  if (min % 60 === 0) return `${min / 60}h`;
  return min % 30 === 0 ? `${Math.floor(min / 60)}½h` : `${Math.floor(min / 60)}h${min % 60}`;
}
