/**
 * Reaction-time test: a one-minute psychomotor vigilance task (PVT), the standard objective measure
 * of alertness in sleep research. A signal appears after a random wait; you tap as fast as you can.
 * Slower and more variable responses, and more lapses, mean lower alertness — whatever you'd have
 * rated yourself.
 *
 * Phones add their own delay (touch sampling, display), so a result is only compared with the
 * person's own earlier tests, never with lab norms: speed (1000 / reaction time, the most sensitive
 * PVT measure) against the median of their previous tests.
 */
import { mean, median, pearson, sd } from './stats';
import type { ReactionTest } from './types';

export const REACTION = {
  /** Signals per test. */
  trials: 12,
  /** Random wait before each signal (ms). */
  minWaitMs: 1500,
  maxWaitMs: 5000,
  /** No tap within this long counts as a miss. */
  timeoutMs: 3000,
  /** A tap this soon after the signal can't be a reaction to it. */
  anticipationMs: 100,
  /** A response slower than this multiple of your usual counts as a lapse. */
  lapseFactor: 1.6,
  /** Earlier tests needed before a result can be compared with "your usual". */
  minBaseline: 3,
  /** Tests (with a forecast) needed before the agreement with the forecast is shown. */
  minForAgreement: 8,
};

/** The waits before each signal, from a random source (0–1). */
export function planWaits(rand: () => number = Math.random, trials = REACTION.trials): number[] {
  return Array.from({ length: trials }, () => Math.round(REACTION.minWaitMs + rand() * (REACTION.maxWaitMs - REACTION.minWaitMs)));
}

export interface ReactionSummary {
  /** Valid responses. */
  n: number;
  medianMs: number;
  /** Mean speed, responses per second (1000 / RT). */
  speed: number;
  /** Slowest tenth, ms — where sleepiness shows first. */
  slowestMs: number;
  falseStarts: number;
  misses: number;
}

export function summarizeReaction(test: Pick<ReactionTest, 'rts' | 'falseStarts' | 'misses'>): ReactionSummary | undefined {
  const rts = test.rts.filter((r) => r >= REACTION.anticipationMs && r <= REACTION.timeoutMs);
  if (rts.length < 5) return undefined;
  const sorted = [...rts].sort((a, b) => a - b);
  const tail = sorted.slice(-Math.max(1, Math.round(sorted.length / 10)));
  return {
    n: rts.length,
    medianMs: Math.round(median(rts)),
    speed: mean(rts.map((r) => 1000 / r)),
    slowestMs: Math.round(mean(tail)),
    falseStarts: test.falseStarts,
    misses: test.misses,
  };
}

export type ReactionVerdict = 'sharp' | 'usual' | 'slow' | 'very-slow';

export interface ReactionReading extends ReactionSummary {
  /** Your usual median reaction time (ms) from earlier tests; undefined until there are enough. */
  usualMs?: number;
  /** SDs faster (+) or slower (−) than your usual speed. */
  z?: number;
  /** Responses slower than 1.6 × your usual, plus misses. */
  lapses?: number;
  verdict?: ReactionVerdict;
}

/** A test's result against the tests before it. */
export function readReaction(test: ReactionTest, earlier: ReactionTest[]): ReactionReading | undefined {
  const summary = summarizeReaction(test);
  if (!summary) return undefined;
  const past = earlier
    .filter((t) => t.time < test.time)
    .map(summarizeReaction)
    .filter((s): s is ReactionSummary => !!s);
  if (past.length < REACTION.minBaseline) return summary;
  const speeds = past.map((s) => s.speed);
  const usualMs = Math.round(median(past.map((s) => s.medianMs)));
  // At least 5% of the usual speed, so three near-identical tests don't make every later one "extreme".
  const spread = Math.max(sd(speeds) || 0, 0.05 * median(speeds));
  const z = (summary.speed - median(speeds)) / spread;
  const lapses = test.rts.filter((r) => r > REACTION.lapseFactor * usualMs).length + test.misses;
  const verdict: ReactionVerdict = z >= 0.75 ? 'sharp' : z > -0.75 ? 'usual' : z > -2 ? 'slow' : 'very-slow';
  return { ...summary, usualMs, z: Math.round(z * 100) / 100, lapses, verdict };
}

export const REACTION_VERDICT_TEXT: Record<ReactionVerdict, string> = {
  sharp: 'Sharper than your usual',
  usual: 'About your usual',
  slow: 'Slower than your usual',
  'very-slow': 'Much slower than your usual',
};

export interface ReactionAgreement {
  n: number;
  /** Correlation between reaction speed and the forecast's energy at the time of each test. */
  r: number;
  text: string;
}

/** Does the forecast go up and down with measured reaction speed? `energyAt` = forecast energy at a time. */
export function reactionAgreement(tests: ReactionTest[], energyAt: (t: number) => number | undefined): ReactionAgreement | undefined {
  const speeds: number[] = [];
  const energies: number[] = [];
  for (const t of tests) {
    const s = summarizeReaction(t);
    const e = energyAt(t.time);
    if (!s || e === undefined) continue;
    speeds.push(s.speed);
    energies.push(e);
  }
  if (speeds.length < REACTION.minForAgreement) return undefined;
  const r = pearson(speeds, energies);
  if (!Number.isFinite(r)) return undefined;
  const text =
    r >= 0.5
      ? 'Your reaction speed rises and falls with the forecast — a strong sign the energy numbers track something real.'
      : r >= 0.25
        ? 'Your reaction speed tends to follow the forecast.'
        : r > -0.25
          ? "So far your reaction speed doesn't follow the forecast. More tests at different times of day will settle it."
          : 'Your reaction speed runs against the forecast so far — keep checking in so eepy can correct itself.';
  return { n: speeds.length, r: Math.round(r * 100) / 100, text };
}
