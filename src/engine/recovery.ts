/**
 * Recovery early warning: resting HR up + HRV down + breathing rate up for 2+ nights
 * vs. the personal baseline suggests illness or overreaching.
 *
 * OWNER: coach workstream. Stub — returns undefined until implemented.
 */
import type { Night } from './sessions';
import type { DailyStats, NightVitals } from './types';

export interface RecoveryAlert {
  level: 'watch' | 'warning';
  title: string;
  detail: string;
  /** Wake dates that triggered the alert. */
  nights: string[];
}

export function detectRecoveryAlert(_input: {
  nights: Night[];
  vitals: Record<string, NightVitals>;
  daily: Record<string, DailyStats>;
  asOfDate: string;
}): RecoveryAlert | undefined {
  return undefined;
}
