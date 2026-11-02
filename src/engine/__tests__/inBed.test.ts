/**
 * "I'm in bed": the tap as tonight's lights-out (re-timing the cycle-timed alarm through the one-night
 * override, never past the wake-up — two-step mornings included), the session's life cycle, and a
 * night saved from the taps.
 */
import { analyze, Analysis } from '../analysis';
import { generateDemoData } from '../demo';
import {
  alarmPhrase,
  closeInBed,
  IN_BED,
  InBedSession,
  inBedTonight,
  isOpen,
  justNow,
  nightFromTaps,
  planInBed,
  reopenInBed,
  sessionDetails,
  staleInBed,
  tapsNightOffer,
} from '../inBed';
import { TonightOverride } from '../schedule';
import { analyzeSessions, TAPS_ORIGIN } from '../sessions';
import { atMinutes, HOUR, MINUTE } from '../time';
import type { Profile, SleepDataset, TwoStepMorning } from '../types';
import { night } from './helpers';

// Monday evening 2026-11-02; tonight's plan wakes on Tuesday (a workday at 07:00 in the demo profile).
const DAY = '2026-11-02';
const EVE = atMinutes(DAY, 21 * 60);
const data = generateDemoData(EVE);
const plain = analyze(data, EVE);
/** Taps are kept to the minute. */
const minute = (t: number) => Math.floor(t / MINUTE) * MINUTE;
/** Lights-out as planned, to the minute. */
const BED = minute(plain.tonight.bedtime);

const inputFor = (a: Analysis, d: SleepDataset = data, override?: TonightOverride) => ({
  tonight: a.tonight,
  cycleMin: a.cycleMin,
  latencyMin: a.latencyMin,
  efficiency: a.efficiency,
  windDownMin: d.profile.windDownMin,
  override,
});

/** What the analysis plans once the tap's override is stored (the real pipeline). */
const after = (d: SleepDataset, override: TonightOverride | undefined, now: number) => analyze(d, now, { tonightOverride: override });

describe('the tap as tonight\'s lights-out', () => {
  it('re-times the alarm to the end of a sleep cycle counted from the tap, keeping the wake-up', () => {
    const tap = BED - 23 * MINUTE;
    const p = planInBed(inputFor(plain), tap);
    expect(p.session).toMatchObject({ inBedAt: tap, wakeDate: plain.tonight.wakeDate, retimed: true, wakeAt: plain.tonight.wake });
    expect(p.override).toEqual({ wakeDate: plain.tonight.wakeDate, bedtime: tap });
    const a = after(data, p.override, tap);
    // The confirmation's alarm is exactly the one the analysis (and so the alarm) will use.
    expect(p.projected!.alarm).toEqual(a.alarm);
    expect(a.tonight.bedtime).toBe(tap);
    expect(a.tonight.wake).toBe(plain.tonight.wake);
    expect(a.alarm.alarm).toBeLessThanOrEqual(a.tonight.wake);
    expect(a.alarm.alarm).toBeGreaterThan(tap);
    if (a.alarm.onBoundary) {
      const fromOnset = (a.alarm.alarm - (tap + a.latencyMin * MINUTE)) / MINUTE;
      expect(fromOnset).toBeCloseTo(a.alarm.cycles * a.cycleMin, 5);
      expect(p.session.cycles).toBe(a.alarm.cycles);
    }
  });

  it('never moves the alarm past the wake-up, whenever you tap', () => {
    for (let m = -120; m <= 150; m += 7) {
      const tap = BED + m * MINUTE;
      const p = planInBed(inputFor(plain), tap);
      const a = after(data, p.override, tap);
      expect(a.alarm.alarm).toBeLessThanOrEqual(plain.tonight.wake);
      expect(a.tonight.wake).toBe(plain.tonight.wake);
      expect(p.projected!.alarm).toEqual(a.alarm);
    }
  });

  it('keeps the plan when the tap is within 10 minutes of lights-out', () => {
    const tap = BED + 6 * MINUTE;
    const p = planInBed(inputFor(plain), tap);
    expect(p.session.retimed).toBe(false);
    expect(p.override).toBeUndefined();
    expect(p.projected!.alarm).toEqual(plain.alarm);
    expect(planInBed(inputFor(plain), plain.tonight.bedtime - 9 * MINUTE).session.retimed).toBe(false);
    expect(planInBed(inputFor(plain), plain.tonight.bedtime - 11 * MINUTE).session.retimed).toBe(true);
  });

  it('keeps a wake-up you moved yourself, and remembers the override for Undo', () => {
    const own: TonightOverride = { wakeDate: plain.tonight.wakeDate, bedtime: plain.tonight.bedtime + HOUR, wake: plain.tonight.wake + 30 * MINUTE };
    const adjusted = after(data, own, EVE);
    const tap = BED + 20 * MINUTE;
    const p = planInBed(inputFor(adjusted, data, own), tap);
    expect(p.override).toEqual({ wakeDate: own.wakeDate, bedtime: tap, wake: own.wake });
    expect(p.session.prevTonight).toEqual(own);
    const a = after(data, p.override, tap);
    expect(a.tonight.wake).toBe(own.wake);
    expect(a.alarm.alarm).toBeLessThanOrEqual(own.wake!);
    expect(p.projected!.alarm).toEqual(a.alarm);
  });

  it('is to the minute', () => {
    const tap = BED - 20 * MINUTE + 37_000;
    expect(planInBed(inputFor(plain), tap).session.inBedAt).toBe(BED - 20 * MINUTE);
  });

  it('after 4am before the wake-up belongs to this morning, re-timing nothing', () => {
    const p = planInBed({ ...inputFor(plain), morning: { wakeDate: DAY, wakeAt: atMinutes(DAY, 7 * 60) } }, atMinutes(DAY, 4 * 60 + 30));
    expect(p.session).toMatchObject({ wakeDate: DAY, wakeAt: atMinutes(DAY, 420), retimed: false });
    expect(p.override).toBeUndefined();
    expect(p.projected).toBeUndefined();
  });
});

describe('two-step mornings', () => {
  // Thursday → Friday (a workday): up at 5:00 for the routine, final wake-up 6:05.
  const THU = '2026-10-22';
  const NOW = atMinutes(THU, 21 * 60);
  const TWO: TwoStepMorning = { enabled: true, firstWakeMin: 5 * 60, routineMin: 20 };
  const demo = generateDemoData(NOW);
  const withProfile = (p: Partial<Profile>): SleepDataset => ({ ...demo, profile: { ...demo.profile, workWakeMin: 6 * 60 + 5, ...p } });
  const d = withProfile({ twoStepMorning: TWO });
  const a = analyze(d, NOW);

  it('keeps the routine alarm as the first, cycle-timed ring and the final alarm at the wake-up', () => {
    const tap = minute(a.tonight.bedtime) + 40 * MINUTE;
    const p = planInBed(inputFor(a, d), tap);
    const next = after(d, p.override, tap);
    const two = next.tonight.twoStep!;
    expect(two).toBeDefined();
    expect(p.session.twoStep).toBe(true);
    expect(next.tonight.wake).toBe(a.tonight.wake);
    expect(two.firstWake).toBe(a.tonight.twoStep!.firstWake);
    expect(next.alarm.alarm).toBe(two.firstAlarm);
    expect(two.firstAlarm).toBeLessThanOrEqual(two.firstWake);
    expect(two.firstAlarm).toBeGreaterThanOrEqual(two.firstWake - 30 * MINUTE);
    expect(two.routineEnd).toBe(two.firstAlarm + 20 * MINUTE);
    expect(p.projected!.tonight.twoStep).toEqual(two);
    expect(p.projected!.alarm).toEqual(next.alarm);
  });

  it('drops the routine alarm when you go to bed too close to it (one alarm at the wake-up)', () => {
    const tap = minute(a.tonight.twoStep!.firstWake) - 80 * MINUTE;
    const p = planInBed(inputFor(a, d), tap);
    const next = after(d, p.override, tap);
    expect(next.tonight.twoStep).toBeUndefined();
    expect(p.projected!.tonight.twoStep).toBeUndefined();
    expect(p.session.twoStep).toBeUndefined();
    expect(next.alarm.alarm).toBeLessThanOrEqual(next.tonight.wake);
  });
});

describe('the session', () => {
  const s: InBedSession = { inBedAt: atMinutes(DAY, 23 * 60 + 42), wakeDate: '2026-11-03', wakeAt: atMinutes('2026-11-03', 7 * 60), retimed: true };

  it('keeps tonight quiet only while it is open, for its own night', () => {
    expect(isOpen(s)).toBe(true);
    expect(inBedTonight(s, '2026-11-03')).toBe(true);
    expect(inBedTonight(s, '2026-11-04')).toBe(false);
    expect(inBedTonight(undefined, '2026-11-03')).toBe(false);
    const up = closeInBed(s, atMinutes('2026-11-03', 7 * 60 + 5) + 20_000, 'up');
    expect(up).toMatchObject({ closed: 'up', upAt: atMinutes('2026-11-03', 425) });
    expect(inBedTonight(up, '2026-11-03')).toBe(false);
    expect(isOpen(up)).toBe(false);
    expect(reopenInBed({ ...up, sleepModeStopped: s.wakeAt })).toEqual(s);
    expect(closeInBed(s, atMinutes('2026-11-03', 12 * 60), 'auto').upAt).toBeUndefined();
  });

  it('goes stale a few hours after the wake-up, at noon at the latest', () => {
    expect(staleInBed(s, atMinutes('2026-11-03', 9 * 60 + 59))).toBe(false);
    expect(staleInBed(s, atMinutes('2026-11-03', 10 * 60))).toBe(true);
    const late = { ...s, wakeAt: atMinutes('2026-11-03', 10 * 60) };
    expect(staleInBed(late, atMinutes('2026-11-03', 11 * 60 + 59))).toBe(false);
    expect(staleInBed(late, atMinutes('2026-11-03', 12 * 60))).toBe(true);
    expect(staleInBed(closeInBed(s, s.inBedAt + HOUR, 'up'), atMinutes('2026-11-03', 13 * 60))).toBe(false);
  });

  it('offers Undo for a couple of minutes', () => {
    expect(justNow(s.inBedAt, s.inBedAt + 90_000)).toBe(true);
    expect(justNow(s.inBedAt, s.inBedAt + IN_BED.confirmMin * MINUTE)).toBe(false);
    expect(justNow(undefined, s.inBedAt)).toBe(false);
  });

  it('says what will ring', () => {
    const at = atMinutes('2026-11-03', 6 * 60 + 52);
    expect(alarmPhrase({ state: 'set', at, cycles: 5, wake: s.wakeAt })).toBe('alarm 06:52 (5 cycles)');
    expect(alarmPhrase({ state: 'set', at: s.wakeAt, routineAt: atMinutes('2026-11-03', 4 * 60 + 47), cycles: 4, wake: s.wakeAt })).toBe('routine alarm 04:47 (4 cycles) · up 07:00');
    expect(alarmPhrase({ state: 'skipped', wake: s.wakeAt })).toBe('no alarm (skipped)');
    expect(alarmPhrase({ state: 'past', wake: s.wakeAt })).toBe('wake-up 07:00');
    expect(alarmPhrase({ state: 'own', wake: s.wakeAt })).toBe('wake-up 07:00');
    expect(alarmPhrase({ state: 'own', at, cycles: 5, wake: s.wakeAt })).toBe('best wake-up 06:52 (5 cycles)');
    const details = sessionDetails({ ...s, sleepModeOn: true, sounds: 'Brown noise · 45 min' }, { state: 'set', at, cycles: 5, wake: s.wakeAt }, { soundsPlaying: true });
    expect(details).toBe('alarm 06:52 (5 cycles) · sleep mode on · Brown noise · 45 min');
    expect(sessionDetails(s, { state: 'set', at, wake: s.wakeAt })).toBe('alarm 06:52');
  });
});

describe('last night from your taps', () => {
  const inBedAt = atMinutes(DAY, 23 * 60 + 42);
  const s: InBedSession = { inBedAt, wakeDate: '2026-11-03', wakeAt: atMinutes('2026-11-03', 420), retimed: false };
  const up = closeInBed(s, atMinutes('2026-11-03', 7 * 60 + 5), 'up');

  it('is in bed → up, awake for your usual time to fall asleep', () => {
    const n = nightFromTaps(up, 18.4)!;
    expect(n).toMatchObject({ id: `manual-${inBedAt}`, source: 'manual', origin: TAPS_ORIGIN, kind: 'main', start: inBedAt, end: up.upAt });
    expect(n.stages).toEqual([
      { stage: 'awake', start: inBedAt, end: inBedAt + 18 * MINUTE },
      { stage: 'asleep', start: inBedAt + 18 * MINUTE, end: up.upAt },
    ]);
    // Your usual within bounds.
    expect(nightFromTaps(up, 2)!.stages[0].end).toBe(inBedAt + 5 * MINUTE);
    expect(nightFromTaps(up, 200)!.stages[0].end).toBe(inBedAt + 60 * MINUTE);
  });

  it("isn't a night without an up time, or when it's too short or too long", () => {
    expect(nightFromTaps(s, 15)).toBeUndefined();
    expect(nightFromTaps(closeInBed(s, inBedAt + 2 * HOUR, 'up'), 15)).toBeUndefined();
    expect(nightFromTaps(closeInBed(s, inBedAt + 17 * HOUR, 'up'), 15)).toBeUndefined();
  });

  it('is offered only for this morning, when the watch night is missing and it was not saved or dismissed', () => {
    const ctx = { day: '2026-11-03', lastNightIsCurrent: false, latencyMin: 15 };
    expect(tapsNightOffer(up, ctx)).toBeDefined();
    expect(tapsNightOffer(up, { ...ctx, lastNightIsCurrent: true })).toBeUndefined();
    expect(tapsNightOffer(up, { ...ctx, day: '2026-11-04' })).toBeUndefined();
    expect(tapsNightOffer({ ...up, savedId: 'x' }, ctx)).toBeUndefined();
    expect(tapsNightOffer({ ...up, dismissed: true }, ctx)).toBeUndefined();
    expect(tapsNightOffer(closeInBed(s, atMinutes('2026-11-03', 12 * 60), 'auto'), ctx)).toBeUndefined();
    expect(tapsNightOffer(s, ctx)).toBeUndefined();
  });

  it('gives way to the watch night when it arrives', () => {
    const fromTaps = nightFromTaps(up, 15)!;
    const watch = { ...night(DAY, 23 * 60 + 55, 7, { id: 'hc:night' }), source: 'health-connect' as const, origin: 'com.nothing.smartcenter' };
    const kept = analyzeSessions([fromTaps, watch]);
    expect(kept.map((m) => m.id)).toEqual(['hc:night']);
    // A night you logged by hand still wins over the watch.
    const typed = { ...fromTaps, id: 'manual-typed', origin: undefined };
    expect(analyzeSessions([typed, watch]).map((m) => m.id)).toEqual(['manual-typed']);
  });
});
