/** Where tonight's wind-down stands, for the countdown and the Today card. Pure. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The Today card appears this long before wind-down starts. */
export const CARD_LEAD_MS = 2 * HOUR;

export interface WindDownTimes {
  windDownStart: number;
  bedtime: number;
}

export type WindDownPhase = 'before' | 'during' | 'after';

export interface WindDownStatus {
  phase: WindDownPhase;
  /** Minutes until wind-down starts (0 once it has). */
  minToWindDown: number;
  /** Minutes until lights-out (negative once past). */
  minToBedtime: number;
  /** 0–1 through the wind-down window. */
  progress: number;
}

export function windDownStatus(now: number, t: WindDownTimes): WindDownStatus {
  const phase: WindDownPhase = now < t.windDownStart ? 'before' : now < t.bedtime ? 'during' : 'after';
  const span = Math.max(1, t.bedtime - t.windDownStart);
  return {
    phase,
    minToWindDown: Math.max(0, Math.ceil((t.windDownStart - now) / MINUTE)),
    minToBedtime: Math.ceil((t.bedtime - now) / MINUTE),
    progress: Math.min(1, Math.max(0, (now - t.windDownStart) / span)),
  };
}

/** Evening only: from 2h before wind-down until lights-out. */
export function showWindDownCard(now: number, t: WindDownTimes): boolean {
  return now >= t.windDownStart - CARD_LEAD_MS && now < t.bedtime;
}

export interface ChecklistItem {
  id: string;
  icon: string;
  title: string;
  sub: string;
}

export const WIND_DOWN_CHECKLIST: ChecklistItem[] = [
  { id: 'lights', icon: 'lightbulb-off-outline', title: 'Dim the lights', sub: 'Low, warm lamps; overhead lights off' },
  { id: 'screens', icon: 'cellphone-off', title: 'Screens away', sub: 'Or at least night mode and low brightness' },
  { id: 'cool', icon: 'thermometer-low', title: 'Room cool, about 18–20 °C', sub: 'Your core temperature needs to drop to fall asleep' },
  { id: 'todos', icon: 'notebook-edit-outline', title: "Write down tomorrow's to-dos", sub: 'Parking tasks on paper helps you fall asleep faster' },
];
