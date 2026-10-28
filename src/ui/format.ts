import { addDays, dateKey, formatDuration, formatTime, startOfDateKey } from '../engine/time';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayLabel(key: string, today = dateKey(Date.now())): string {
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  if (key === addDays(today, 1)) return 'Tomorrow';
  const d = new Date(startOfDateKey(key) + 12 * 3600_000);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function nightLabel(wakeDate: string, today = dateKey(Date.now())): string {
  if (wakeDate === today) return 'Last night';
  const d = new Date(startOfDateKey(addDays(wakeDate, -1)) + 12 * 3600_000);
  return `${WEEKDAYS[d.getDay()]} night`;
}

export function shortDate(key: string): string {
  const d = new Date(startOfDateKey(key) + 12 * 3600_000);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export function weekdayInitial(key: string): string {
  return WEEKDAYS[new Date(startOfDateKey(key) + 12 * 3600_000).getDay()][0];
}

export function greeting(now: number): string {
  const h = new Date(now).getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function relativeTime(t: number, now = Date.now()): string {
  const min = Math.round((now - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
}

export function countdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export { formatDuration, formatTime };
