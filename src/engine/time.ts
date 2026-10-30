/** Time helpers. Everything is device-local time unless a UTC offset is passed explicitly. */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const MIN_PER_DAY = 1440;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date (YYYY-MM-DD) of a timestamp. */
export function dateKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight at the start of a date key. */
export function startOfDateKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + n, 12).getTime());
}

/** Whole days from a to b (b - a), robust to DST. */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY);
}

export function weekdayOfKey(key: string): number {
  return new Date(startOfDateKey(key) + 12 * HOUR).getDay();
}

/** Minutes after local midnight (0–1439.x). */
export function minutesOfDay(t: number): number {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/** Timestamp for a local clock time (minutes after midnight, may exceed 1440 or be negative) on a date. */
export function atMinutes(key: string, minutes: number): number {
  const [y, m, d] = key.split('-').map(Number);
  const whole = Math.floor(minutes);
  return new Date(y, m - 1, d, 0, whole, Math.round((minutes - whole) * 60)).getTime();
}

export function normalizeMinutes(m: number): number {
  return ((m % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
}

/** Signed shortest distance a → b on the 24h clock, in [-720, 720). */
export function clockDiff(a: number, b: number): number {
  return normalizeMinutes(b - a + 720) - 720;
}

/** Circular mean of clock times (minutes after midnight). */
export function circularMeanMinutes(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  let x = 0;
  let y = 0;
  for (const v of values) {
    const a = (v / MIN_PER_DAY) * 2 * Math.PI;
    x += Math.cos(a);
    y += Math.sin(a);
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return undefined;
  return normalizeMinutes((Math.atan2(y, x) / (2 * Math.PI)) * MIN_PER_DAY);
}

/** Circular standard deviation of clock times, in minutes. */
export function circularSdMinutes(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  let x = 0;
  let y = 0;
  for (const v of values) {
    const a = (v / MIN_PER_DAY) * 2 * Math.PI;
    x += Math.cos(a);
    y += Math.sin(a);
  }
  const r = Math.min(1, Math.sqrt(x * x + y * y) / values.length);
  if (r <= 1e-9) return MIN_PER_DAY / 2;
  return (Math.sqrt(-2 * Math.log(r)) / (2 * Math.PI)) * MIN_PER_DAY;
}

export function parseHHMM(s: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  return h * 60 + min;
}

export type ClockFormat = '12h' | '24h';

/**
 * How clock times are shown everywhere (set by the app from Settings; tests keep the 24h default).
 * Module state on purpose: formatting happens deep inside the engine (plan rationale, notification
 * text) and threading a parameter through every caller isn't worth it.
 */
let clockFormat: ClockFormat = '24h';

export function setClockFormat(format: ClockFormat): void {
  clockFormat = format;
}

export function getClockFormat(): ClockFormat {
  return clockFormat;
}

/** 12-hour pieces of a time of day: 0 → 12 AM, 13:05 → 1:05 PM. */
function twelveHour(m: number): { h: number; mm: string; ampm: 'AM' | 'PM' } {
  const h24 = Math.floor(m / 60);
  return { h: h24 % 12 === 0 ? 12 : h24 % 12, mm: pad(m % 60), ampm: h24 < 12 ? 'AM' : 'PM' };
}

/** Formats minutes-after-midnight as "07:05" (24h) or "7:05 AM" (12h, with a no-break space). */
export function formatClock(minutes: number): string {
  const m = Math.round(normalizeMinutes(minutes)) % MIN_PER_DAY;
  if (clockFormat === '12h') {
    const t = twelveHour(m);
    return `${t.h}:${t.mm}\u00A0${t.ampm}`;
  }
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Compact hour label for chart axes: "09:00" or "9 AM" (minutes shown only when not on the hour). */
export function formatHourLabel(minutes: number): string {
  const m = Math.round(normalizeMinutes(minutes)) % MIN_PER_DAY;
  if (clockFormat === '24h') return formatClock(m);
  const t = twelveHour(m);
  return t.mm === '00' ? `${t.h}\u00A0${t.ampm}` : `${t.h}:${t.mm}\u00A0${t.ampm}`;
}

/** Rewrites "HH:MM" times inside fixed text (quiz answers, experiment rules) in the current format. */
export function localizeClockText(text: string): string {
  if (clockFormat === '24h') return text;
  return text.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, h: string, mm: string) => formatClock(Number(h) * 60 + Number(mm)));
}

export function formatTime(t: number): string {
  return formatClock(minutesOfDay(t));
}

/** Formats a timestamp's clock time as seen in a fixed UTC offset (minutes east of UTC). */
export function formatTimeInOffset(t: number, offsetMin: number): string {
  const shifted = new Date(t + offsetMin * MINUTE);
  return formatClock(shifted.getUTCHours() * 60 + shifted.getUTCMinutes());
}

/** "7h 32m", "45m", "-1h 05m". */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const total = Math.round(Math.abs(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${sign}${m}m`;
  return `${sign}${h}h ${pad(m)}m`;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function roundTo(t: number, stepMin: number): number {
  const step = stepMin * MINUTE;
  return Math.round(t / step) * step;
}
