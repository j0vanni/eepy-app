import { atMinutes, setClockFormat } from '../../engine/time';
import { clockParts, compactTime, morningKind, morningWord, nightBefore, ordinal, planLine, planSentence, wakeChoiceHint } from '../planner/planText';

// 2026-11-05 is a Thursday.
const night = {
  wakeDate: '2026-11-05',
  bedtime: atMinutes('2026-11-04', 23 * 60 + 5),
  wake: atMinutes('2026-11-05', 6 * 60 + 30),
  alarm: atMinutes('2026-11-05', 6 * 60 + 5),
  sleepMin: 430,
  noAlarm: false,
  custom: false,
};

afterEach(() => setClockFormat('24h'));

describe('planner text', () => {
  it('says a day in plain words', () => {
    setClockFormat('12h');
    expect(planSentence(night, 'alarm')).toBe('Thursday: lights out 11:05 PM → alarm 6:05 AM · 7h 10m sleep');
    expect(planLine(night, 'free')).toBe('Lights out 11:05 PM → no alarm, up around 6:30 AM');
    expect(planLine(night, 'skipped')).toBe('Lights out 11:05 PM → alarm skipped, sleep in');
    setClockFormat('24h');
    expect(planSentence(night, 'set')).toBe('Thursday: lights out 23:05 → alarm 06:05 · 7h 10m sleep');
  });

  it('uses the wake-up when there is no cycle-timed alarm', () => {
    expect(planLine({ ...night, alarm: undefined }, 'alarm')).toBe('Lights out 23:05 → alarm 06:30');
  });

  it('shortens times for the week strip', () => {
    setClockFormat('12h');
    expect(compactTime(night.bedtime)).toBe('11:05p');
    expect(compactTime(night.alarm)).toBe('6:05a');
    setClockFormat('24h');
    expect(compactTime(night.bedtime)).toBe('23:05');
  });

  it('tells free days, set times and skipped alarms apart', () => {
    expect(morningKind(night)).toBe('alarm');
    expect(morningKind({ ...night, custom: true })).toBe('set');
    expect(morningKind({ ...night, noAlarm: true, custom: true })).toBe('free');
    expect(morningKind(night, '2026-11-05')).toBe('skipped');
    expect(morningKind(night, '2026-11-06')).toBe('alarm');
    // A free day has no alarm to skip.
    expect(morningKind({ ...night, noAlarm: true }, '2026-11-05')).toBe('free');
  });

  it('names the night before and explains each wake-up choice', () => {
    expect(nightBefore('2026-11-05')).toBe('Wednesday night');
    expect(wakeChoiceHint('usual', { wakeMin: 420, isWorkday: true }, '07:00', '08:00')).toContain('usual workday alarm, 07:00');
    expect(wakeChoiceHint('usual', { wakeMin: 480, isWorkday: false }, '08:00', '08:00')).toContain('Not a workday');
    expect(wakeChoiceHint('free', { wakeMin: 420, isWorkday: true }, '07:00', '08:00')).toBe('No alarm that morning — sleep in, up around 08:00.');
    expect(wakeChoiceHint('custom', { wakeMin: 420, isWorkday: true }, '07:00', '08:00')).toContain('set time');
  });

  it('splits a time for a big number', () => {
    setClockFormat('12h');
    expect(clockParts(night.bedtime)).toEqual({ value: '11:05', unit: 'PM' });
    expect(clockParts(night.alarm)).toEqual({ value: '6:05', unit: 'AM' });
    setClockFormat('24h');
    expect(clockParts(night.bedtime)).toEqual({ value: '23:05' });
  });

  it('names the kind of morning', () => {
    expect(morningWord({ isWorkday: true })).toBe('workday');
    expect(morningWord({ isWorkday: false })).toBe('not a workday');
    expect(morningWord({ isWorkday: true, noAlarm: true })).toBe('free day, no alarm');
  });

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 5, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '5th', '11th', '12th', '13th', '21st', '22nd']);
  });
});
