import { atMinutes, MINUTE } from '../time';
import { DEFAULT_PROFILE, Profile, SleepSession, Stage, StageSegment } from '../types';

/** A night from `onset` (minutes after midnight on the evening date) lasting `hours`, with ~90 min cycles. */
export function night(
  evening: string,
  onsetMin: number,
  hours: number,
  opts: { latencyMin?: number; staged?: boolean; id?: string; kind?: 'main' | 'nap'; origin?: string } = {},
): SleepSession {
  const onset = atMinutes(evening, onsetMin);
  const wake = onset + hours * 60 * MINUTE;
  const start = onset - (opts.latencyMin ?? 10) * MINUTE;
  const stages: StageSegment[] = [{ stage: 'awake', start, end: onset }];
  if (opts.staged === false) {
    stages.push({ stage: 'asleep', start: onset, end: wake });
  } else {
    let t = onset;
    const plan: [Stage, number][] = [];
    for (let k = 0; k < 8; k++) plan.push(['light', 35], ['deep', Math.max(0, 30 - 8 * k)], ['light', 15], ['rem', 10 + 5 * k]);
    for (const [stage, mins] of plan) {
      if (t >= wake || mins <= 0) continue;
      const end = Math.min(wake, t + mins * MINUTE);
      stages.push({ stage, start: t, end });
      t = end;
    }
  }
  return { id: opts.id ?? `n-${evening}`, source: 'manual', origin: opts.origin, start, end: wake, stages, kind: opts.kind };
}

export const profile = (over: Partial<Profile> = {}): Profile => ({ ...DEFAULT_PROFILE, birthYear: 1996, onboarded: true, ...over });
