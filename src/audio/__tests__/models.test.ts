import { BREATH_PATTERNS, breathStateAt, cycleMs, MIN_SCALE, phaseTargetScale, sessionCycles, sessionMs } from '../breathing';
import {
  effectiveVolume,
  formatRemaining,
  isTimerFading,
  MAX_TIMER_FADE_MS,
  sleepTimerGain,
  timerFadeMs,
  voiceFinished,
  voiceGain,
} from '../envelope';
import { formatLux, lightAdvice, lightContextAt, luxMeterPosition, smoothLux } from '../light';
import { timerShortLabel } from '../sounds';
import { showWindDownCard, windDownStatus } from '../windDown';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('voice envelopes', () => {
  it('fades in with an equal-power curve', () => {
    const env = { startedAt: 0, fadeInMs: 1000, fadeOutMs: 1000 };
    expect(voiceGain(env, 0)).toBe(0);
    expect(voiceGain(env, 500)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(voiceGain(env, 1000)).toBe(1);
    expect(voiceGain(env, 99_999)).toBe(1);
  });

  it('crossfades keep combined power at 1', () => {
    const outgoing = { startedAt: 0, fadeInMs: 0, stopAt: 2000, fadeOutMs: 1000 };
    const incoming = { startedAt: 1000, fadeInMs: 1000, fadeOutMs: 1000 };
    for (const t of [1000, 1250, 1500, 1750, 2000]) {
      expect(voiceGain(outgoing, t) ** 2 + voiceGain(incoming, t) ** 2).toBeCloseTo(1, 5);
    }
    expect(voiceFinished(outgoing, 1999)).toBe(false);
    expect(voiceFinished(outgoing, 2000)).toBe(true);
  });
});

describe('sleep timer', () => {
  it('fades over the last 3 minutes of a long timer, a quarter of a short one', () => {
    expect(timerFadeMs(45 * MIN)).toBe(MAX_TIMER_FADE_MS);
    expect(timerFadeMs(8 * MIN)).toBe(2 * MIN);
  });

  it('holds full volume, then fades gently to silence at the end', () => {
    const start = 0;
    const end = 30 * MIN;
    expect(sleepTimerGain(start, end, 10 * MIN)).toBe(1);
    expect(sleepTimerGain(start, end, end - 3 * MIN)).toBe(1);
    const mid = sleepTimerGain(start, end, end - 1.5 * MIN);
    expect(mid).toBeCloseTo(0.25, 5); // (1 - 0.5)²
    expect(sleepTimerGain(start, end, end - 1000)).toBeLessThan(0.01);
    expect(sleepTimerGain(start, end, end)).toBe(0);
    expect(isTimerFading(start, end, end - 2 * MIN)).toBe(true);
    expect(isTimerFading(start, end, 5 * MIN)).toBe(false);
  });

  it('decreases monotonically through the fade', () => {
    let prev = 1;
    for (let t = 27 * MIN; t <= 30 * MIN; t += 5000) {
      const g = sleepTimerGain(0, 30 * MIN, t);
      expect(g).toBeLessThanOrEqual(prev);
      prev = g;
    }
  });

  it('plays forever with no timer', () => {
    expect(sleepTimerGain(0, undefined, 10 * HOUR)).toBe(1);
    expect(isTimerFading(0, undefined, 10 * HOUR)).toBe(false);
  });

  it('multiplies user volume, voice fade and timer', () => {
    const env = { startedAt: 0, fadeInMs: 0, fadeOutMs: 1000 };
    expect(effectiveVolume(0.6, env, { startedAt: 0, endsAt: 30 * MIN }, 10 * MIN)).toBeCloseTo(0.6, 5);
    expect(effectiveVolume(0.6, env, { startedAt: 0, endsAt: 30 * MIN }, 30 * MIN - 1.5 * MIN)).toBeCloseTo(0.15, 5);
    expect(effectiveVolume(2, env, { startedAt: 0 }, 0)).toBe(1);
  });

  it('formats remaining time', () => {
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(61_000)).toBe('1:01');
    expect(formatRemaining(45 * MIN)).toBe('45:00');
    expect(formatRemaining(90 * MIN + 5000)).toBe('1:30:05');
    expect(timerShortLabel(0)).toBe('Off');
    expect(timerShortLabel(45)).toBe('45m');
    expect(timerShortLabel(60)).toBe('1h');
    expect(timerShortLabel(90)).toBe('1½h');
    expect(timerShortLabel(75)).toBe('1h15');
  });
});

describe('breathing', () => {
  const box = BREATH_PATTERNS.box;
  const p478 = BREATH_PATTERNS['478'];

  it('has the right rhythms', () => {
    expect(box.phases.map((p) => p.seconds)).toEqual([4, 4, 4, 4]);
    expect(p478.phases.map((p) => p.seconds)).toEqual([4, 7, 8]);
    expect(cycleMs(box)).toBe(16_000);
    expect(cycleMs(p478)).toBe(19_000);
  });

  it('fits whole breaths into 2/5/10 minute sessions', () => {
    expect(sessionCycles(box, 2)).toBe(8); // 128 s
    expect(sessionCycles(box, 5)).toBe(19);
    expect(sessionCycles(p478, 2)).toBe(6); // 114 s
    expect(sessionCycles(p478, 10)).toBe(32);
    expect(sessionMs(p478, 2)).toBe(6 * 19_000);
  });

  it('walks through the phases with a countdown', () => {
    let s = breathStateAt(p478, 2, 0);
    expect(s.phase.kind).toBe('inhale');
    expect(s.phaseSecondsLeft).toBe(4);
    expect(s.step).toBe(0);
    s = breathStateAt(p478, 2, 3_100);
    expect(s.phaseSecondsLeft).toBe(1);
    s = breathStateAt(p478, 2, 4_000);
    expect(s.phase.kind).toBe('holdIn');
    expect(s.phaseSecondsLeft).toBe(7);
    expect(s.step).toBe(1);
    s = breathStateAt(p478, 2, 12_500);
    expect(s.phase.kind).toBe('exhale');
    expect(s.phaseProgress).toBeCloseTo(1.5 / 8, 5);
    s = breathStateAt(p478, 2, 19_000);
    expect(s.cycle).toBe(1);
    expect(s.phase.kind).toBe('inhale');
    expect(s.step).toBe(3);
    expect(s.remainingMs).toBe(5 * 19_000);
  });

  it('ends after the last breath', () => {
    expect(breathStateAt(box, 2, 128_000 - 1).done).toBe(false);
    const end = breathStateAt(box, 2, 128_000);
    expect(end.done).toBe(true);
    expect(end.remainingMs).toBe(0);
  });

  it('grows on the inhale and shrinks on the exhale', () => {
    expect(phaseTargetScale('inhale')).toBe(1);
    expect(phaseTargetScale('holdIn')).toBe(1);
    expect(phaseTargetScale('exhale')).toBe(MIN_SCALE);
    expect(phaseTargetScale('holdOut')).toBe(MIN_SCALE);
  });
});

describe('light check', () => {
  it('judges bedtime light', () => {
    expect(lightAdvice(4, 'evening').tone).toBe('good');
    expect(lightAdvice(30, 'evening').tone).toBe('info');
    expect(lightAdvice(80, 'evening')).toMatchObject({ tone: 'warn', title: 'Dim the lights' });
    expect(lightAdvice(400, 'evening').tone).toBe('bad');
  });

  it('judges morning light', () => {
    expect(lightAdvice(1500, 'morning')).toMatchObject({ tone: 'good', title: 'Outdoor-strength light' });
    expect(lightAdvice(300, 'morning').tone).toBe('info');
    expect(lightAdvice(80, 'morning').tone).toBe('warn');
  });

  it('picks the context from the plan', () => {
    const wakeTime = 7 * HOUR;
    const windDownStart = 22 * HOUR;
    const bedtime = 22.5 * HOUR;
    expect(lightContextAt(8 * HOUR, { wakeTime, windDownStart, bedtime })).toBe('morning');
    expect(lightContextAt(14 * HOUR, { wakeTime, windDownStart, bedtime })).toBe('day');
    expect(lightContextAt(20 * HOUR, { wakeTime, windDownStart, bedtime })).toBe('evening');
    expect(lightContextAt(24.5 * HOUR, { wakeTime, windDownStart, bedtime })).toBe('evening');
  });

  it('smooths and formats readings', () => {
    expect(smoothLux(undefined, 50)).toBe(50);
    const s = smoothLux(10, 1000, 0.5);
    expect(s).toBeGreaterThan(10);
    expect(s).toBeLessThan(1000);
    expect(luxMeterPosition(1)).toBe(0);
    expect(luxMeterPosition(100)).toBeCloseTo(0.5, 5);
    expect(luxMeterPosition(1e6)).toBe(1);
    expect(formatLux(3.24)).toBe('3.2');
    expect(formatLux(52.4)).toBe('52');
    expect(formatLux(1500)).toBe('1.5k');
    expect(formatLux(25_000)).toBe('25k');
  });
});

describe('wind-down timing', () => {
  const t = { windDownStart: 22 * HOUR + 20 * MIN, bedtime: 22 * HOUR + 50 * MIN };

  it('describes before, during and after', () => {
    expect(windDownStatus(21 * HOUR, t)).toMatchObject({ phase: 'before', minToWindDown: 80, minToBedtime: 110, progress: 0 });
    expect(windDownStatus(22 * HOUR + 35 * MIN, t)).toMatchObject({ phase: 'during', minToWindDown: 0, minToBedtime: 15, progress: 0.5 });
    expect(windDownStatus(23 * HOUR, t)).toMatchObject({ phase: 'after', minToBedtime: -10, progress: 1 });
  });

  it('shows the Today card only from 2h before wind-down until lights-out', () => {
    expect(showWindDownCard(20 * HOUR + 19 * MIN, t)).toBe(false);
    expect(showWindDownCard(20 * HOUR + 20 * MIN, t)).toBe(true);
    expect(showWindDownCard(22 * HOUR + 49 * MIN, t)).toBe(true);
    expect(showWindDownCard(22 * HOUR + 50 * MIN, t)).toBe(false);
  });
});
