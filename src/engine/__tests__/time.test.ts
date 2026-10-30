import {
  addDays,
  atMinutes,
  circularMeanMinutes,
  circularSdMinutes,
  clockDiff,
  dateKey,
  daysBetween,
  formatClock,
  formatDuration,
  formatHourLabel,
  formatTime,
  formatTimeInOffset,
  localizeClockText,
  minutesOfDay,
  parseHHMM,
  setClockFormat,
} from '../time';

describe('time helpers', () => {
  it('averages clock times across midnight', () => {
    expect(circularMeanMinutes([23 * 60, 60])).toBeCloseTo(0, 5);
    expect(circularMeanMinutes([22 * 60 + 30, 23 * 60 + 30])).toBeCloseTo(23 * 60, 5);
  });

  it('measures spread of clock times', () => {
    expect(circularSdMinutes([600, 600, 600])).toBeCloseTo(0, 3);
    const sd = circularSdMinutes([23 * 60, 60])!;
    expect(sd).toBeGreaterThan(55);
    expect(sd).toBeLessThan(65);
  });

  it('computes signed shortest clock differences', () => {
    expect(clockDiff(23 * 60, 30)).toBe(90);
    expect(clockDiff(30, 23 * 60)).toBe(-90);
  });

  it('handles DST transitions when stepping days', () => {
    // US DST ended 2026-11-01 in America/Chicago (the test timezone).
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(daysBetween('2026-10-25', '2026-11-08')).toBe(14);
    expect(minutesOfDay(atMinutes('2026-11-01', 7 * 60))).toBe(7 * 60);
    expect(dateKey(atMinutes('2026-11-01', 23 * 60 + 59))).toBe('2026-11-01');
  });

  it('formats and parses', () => {
    expect(formatDuration(452)).toBe('7h 32m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatClock(-30)).toBe('23:30');
    expect(parseHHMM('6:05')).toBe(365);
    expect(parseHHMM('25:00')).toBeUndefined();
  });
});

describe('12-hour clock', () => {
  beforeEach(() => setClockFormat('12h'));
  afterEach(() => setClockFormat('24h'));
  const nb = (s: string) => s.replace(/ (AM|PM)/g, '\u00A0$1');

  it('formats times with AM/PM, midnight and noon as 12', () => {
    expect(formatClock(0)).toBe(nb('12:00 AM'));
    expect(formatClock(7 * 60 + 5)).toBe(nb('7:05 AM'));
    expect(formatClock(12 * 60)).toBe(nb('12:00 PM'));
    expect(formatClock(23 * 60 + 59)).toBe(nb('11:59 PM'));
    expect(formatClock(-30)).toBe(nb('11:30 PM'));
    expect(formatTime(atMinutes('2026-10-30', 13 * 60 + 15))).toBe(nb('1:15 PM'));
    expect(formatTimeInOffset(Date.UTC(2026, 9, 30, 18, 30), 60)).toBe(nb('7:30 PM'));
  });

  it('keeps chart labels short', () => {
    expect(formatHourLabel(9 * 60)).toBe(nb('9 AM'));
    expect(formatHourLabel(0)).toBe(nb('12 AM'));
    expect(formatHourLabel(15 * 60 + 30)).toBe(nb('3:30 PM'));
    setClockFormat('24h');
    expect(formatHourLabel(9 * 60)).toBe('09:00');
  });

  it('rewrites times inside fixed text, and leaves 24h text alone', () => {
    expect(localizeClockText('No caffeine after 14:00')).toBe(nb('No caffeine after 2:00 PM'));
    expect(localizeClockText('22:00–5:00')).toBe(nb('10:00 PM–5:00 AM'));
    setClockFormat('24h');
    expect(localizeClockText('No caffeine after 14:00')).toBe('No caffeine after 14:00');
  });
});
