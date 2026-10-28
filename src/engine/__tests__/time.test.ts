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
  minutesOfDay,
  parseHHMM,
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
