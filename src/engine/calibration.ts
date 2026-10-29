/**
 * Learns the person's own circadian timing from momentary sleepiness ratings (KSS check-ins):
 * fits CircadianParams so the alertness model's predicted KSS matches what they report.
 *
 * OWNER: learning workstream. Stub — returns undefined until implemented.
 */
import type { CircadianParams, Interval } from './alertness';
import type { AlertnessCheckIn } from './types';

export interface CalibrationResult {
  params: CircadianParams;
  /** Check-ins used for the fit. */
  n: number;
  /** Mean absolute KSS error of the population model vs. the personal model. */
  maeBefore?: number;
  maeAfter?: number;
  /** 0–100 "forecast accuracy" shown to the user. */
  accuracy?: number;
  fittedAt: number;
}

export interface CalibrationInput {
  checkins: AlertnessCheckIn[];
  sleeps: Interval[];
  midSleepMin: number;
  debtMin: number;
  now: number;
}

export function fitCircadian(_input: CalibrationInput): CalibrationResult | undefined {
  return undefined;
}
