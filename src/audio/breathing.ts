/** Paced-breathing patterns and a pure "where am I in the session" model for the pacer UI. */

export type BreathPhaseKind = 'inhale' | 'holdIn' | 'exhale' | 'holdOut';

export interface BreathPhase {
  kind: BreathPhaseKind;
  label: string;
  seconds: number;
}

export type BreathPatternId = 'box' | '478';

export interface BreathPattern {
  id: BreathPatternId;
  name: string;
  short: string;
  blurb: string;
  phases: BreathPhase[];
}

export const BREATH_PATTERNS: Record<BreathPatternId, BreathPattern> = {
  box: {
    id: 'box',
    name: 'Box breathing',
    short: 'Box 4·4·4·4',
    blurb: 'Equal four-second sides. Steadies a racing mind without making you light-headed.',
    phases: [
      { kind: 'inhale', label: 'Breathe in', seconds: 4 },
      { kind: 'holdIn', label: 'Hold', seconds: 4 },
      { kind: 'exhale', label: 'Breathe out', seconds: 4 },
      { kind: 'holdOut', label: 'Hold', seconds: 4 },
    ],
  },
  '478': {
    id: '478',
    name: '4-7-8 breathing',
    short: '4·7·8',
    blurb: 'In through the nose for 4, hold for 7, out slowly through the mouth for 8. The long exhale slows your heart rate.',
    phases: [
      { kind: 'inhale', label: 'Breathe in', seconds: 4 },
      { kind: 'holdIn', label: 'Hold', seconds: 7 },
      { kind: 'exhale', label: 'Breathe out', seconds: 8 },
    ],
  },
};

export const SESSION_MINUTES = [2, 5, 10] as const;

export function cycleMs(p: BreathPattern): number {
  return p.phases.reduce((s, ph) => s + ph.seconds, 0) * 1000;
}

/** Whole breaths that fit the chosen length (rounded to the nearest, at least one). */
export function sessionCycles(p: BreathPattern, minutes: number): number {
  return Math.max(1, Math.round((minutes * 60_000) / cycleMs(p)));
}

export function sessionMs(p: BreathPattern, minutes: number): number {
  return sessionCycles(p, minutes) * cycleMs(p);
}

export interface BreathState {
  done: boolean;
  /** 0-based breath number. */
  cycle: number;
  cycles: number;
  phaseIndex: number;
  phase: BreathPhase;
  /** 0–1 through the current phase. */
  phaseProgress: number;
  /** Whole seconds left in this phase, counting down 4, 3, 2, 1. */
  phaseSecondsLeft: number;
  /** Ms left in the whole session. */
  remainingMs: number;
  /** Changes every time a new phase starts; drives animation and haptics. */
  step: number;
}

export function breathStateAt(p: BreathPattern, minutes: number, elapsedMs: number): BreathState {
  const cycles = sessionCycles(p, minutes);
  const total = cycles * cycleMs(p);
  const t = Math.max(0, elapsedMs);
  if (t >= total) {
    const last = p.phases[p.phases.length - 1];
    return {
      done: true,
      cycle: cycles - 1,
      cycles,
      phaseIndex: p.phases.length - 1,
      phase: last,
      phaseProgress: 1,
      phaseSecondsLeft: 0,
      remainingMs: 0,
      step: cycles * p.phases.length,
    };
  }
  const cycle = Math.floor(t / cycleMs(p));
  let within = t - cycle * cycleMs(p);
  let phaseIndex = 0;
  while (within >= p.phases[phaseIndex].seconds * 1000) {
    within -= p.phases[phaseIndex].seconds * 1000;
    phaseIndex++;
  }
  const phase = p.phases[phaseIndex];
  const phaseMs = phase.seconds * 1000;
  return {
    done: false,
    cycle,
    cycles,
    phaseIndex,
    phase,
    phaseProgress: within / phaseMs,
    phaseSecondsLeft: Math.max(1, Math.ceil((phaseMs - within) / 1000)),
    remainingMs: total - t,
    step: cycle * p.phases.length + phaseIndex,
  };
}

/** Circle size (0–1 of its maximum) a phase animates towards. */
export function phaseTargetScale(kind: BreathPhaseKind): number {
  return kind === 'inhale' || kind === 'holdIn' ? 1 : MIN_SCALE;
}

export const MIN_SCALE = 0.5;
