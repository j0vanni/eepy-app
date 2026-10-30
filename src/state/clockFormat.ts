/**
 * 12- or 24-hour clock: Settings → "Time format" (follow the phone by default). The engine formats
 * every time through engine/time.ts, so the app applies the choice there — from the root layout
 * while it renders, and from the background task before it writes notification text.
 */
import { getCalendars } from 'expo-localization';

import { ClockFormat, setClockFormat } from '../engine/time';

export type ClockSetting = 'system' | ClockFormat;

/** The phone's own 12/24-hour setting (12-hour when it can't be read). */
export function systemClockFormat(): ClockFormat {
  try {
    const uses24 = getCalendars()[0]?.uses24hourClock;
    if (uses24 === true) return '24h';
    if (uses24 === false) return '12h';
  } catch {
    // Not available (web without Intl calendars, tests): fall through.
  }
  try {
    const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
    if (cycle === 'h23' || cycle === 'h24') return '24h';
  } catch {
    // Old Intl: default below.
  }
  return '12h';
}

export function resolveClockSetting(setting: ClockSetting | undefined): ClockFormat {
  return !setting || setting === 'system' ? systemClockFormat() : setting;
}

export function applyClockSetting(setting: ClockSetting | undefined): ClockFormat {
  const format = resolveClockSetting(setting);
  setClockFormat(format);
  return format;
}
