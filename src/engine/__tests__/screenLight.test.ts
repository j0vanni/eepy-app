import { judgeScreenBrightness, nightLightSchedule, screenLightSchedule, screenTargetAt } from '../screenLight';
import { atMinutes, formatTime } from '../time';

const D = '2026-10-29';
const plan = {
  wakeTime: atMinutes(D, 7 * 60),
  windDownStart: atMinutes(D, 22 * 60 + 15),
  bedtime: atMinutes(D, 23 * 60 + 15),
  nextWake: atMinutes('2026-10-30', 7 * 60),
};
const at = (h: number) => atMinutes(D, h * 60);

describe('phone screen light', () => {
  it('builds the day: morning, day, evening (3 h before lights-out), wind-down, night', () => {
    const s = screenLightSchedule(plan);
    expect(s.map((t) => [t.phase, formatTime(t.from), formatTime(t.until)])).toEqual([
      ['morning', '07:00', '09:00'],
      ['day', '09:00', '20:15'],
      ['evening', '20:15', '22:15'],
      ['winddown', '22:15', '23:15'],
      ['night', '23:15', '07:00'],
    ]);
    expect(s.find((t) => t.phase === 'evening')).toMatchObject({ maxBrightness: 0.4, filter: 'warm' });
    expect(s.find((t) => t.phase === 'winddown')).toMatchObject({ maxBrightness: 0.15, filter: 'warmest' });
  });

  it('knows the target right now, including before this morning’s wake-up', () => {
    expect(screenTargetAt(plan, at(13)).phase).toBe('day');
    expect(screenTargetAt(plan, at(21)).phase).toBe('evening');
    expect(screenTargetAt(plan, at(22.5)).phase).toBe('winddown');
    expect(screenTargetAt(plan, at(23.5)).phase).toBe('night');
    expect(screenTargetAt(plan, at(5)).phase).toBe('night');
  });

  it('follows an adjusted (later) night', () => {
    const late = { ...plan, windDownStart: plan.windDownStart + 90 * 60_000, bedtime: plan.bedtime + 90 * 60_000 };
    expect(formatTime(screenLightSchedule(late).find((t) => t.phase === 'evening')!.from)).toBe('21:45');
  });

  it('judges brightness against the target, and suggests a Night Light schedule', () => {
    const evening = screenTargetAt(plan, at(21));
    expect(judgeScreenBrightness(0.3, evening)?.tone).toBe('good');
    expect(judgeScreenBrightness(0.7, evening)?.tone).toBe('warn');
    expect(judgeScreenBrightness(1, evening)?.tone).toBe('bad');
    expect(judgeScreenBrightness(1, screenTargetAt(plan, at(13)))).toBeUndefined();
    const nl = nightLightSchedule(plan);
    expect([formatTime(nl.on), formatTime(nl.off)]).toEqual(['20:15', '07:00']);
  });
});
