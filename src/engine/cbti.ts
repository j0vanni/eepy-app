/**
 * Structured CBT-I programme: sleep diary → prescribed sleep window, titrated weekly by sleep efficiency.
 *
 * OWNER: programmes workstream. Stub — no window until implemented.
 */
import type { Night } from './sessions';

export interface CbtiWeek {
  weekStart: string;
  windowMin: number;
  efficiency?: number;
}

export interface CbtiProgram {
  active: boolean;
  startedAt: string;
  /** Fixed wake time the window is anchored to (minutes after midnight). */
  wakeMin: number;
  /** Current prescribed time in bed (minutes). */
  windowMin: number;
  weeks: CbtiWeek[];
}

/** The window to plan tonight around, if a programme is running. */
export function currentCbtiWindow(
  _program: CbtiProgram | undefined,
  _nights: Night[],
  _today: string,
): { bedMin: number; wakeMin: number; reason: string } | undefined {
  return undefined;
}
