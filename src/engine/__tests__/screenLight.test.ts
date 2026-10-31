import { judgeScreenBrightness, linearToSlider, nightLightSchedule, screenLightSchedule, screenTargetAt, sliderToLinear } from '../screenLight';
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
    expect(s.find((t) => t.phase === 'evening')).toMatchObject({ maxBrightness: 0.5, filter: 'warm' });
    expect(s.find((t) => t.phase === 'winddown')).toMatchObject({ maxBrightness: 0.3, filter: 'warmest' });
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
    expect(judgeScreenBrightness(0.4, evening)?.tone).toBe('good');
    expect(judgeScreenBrightness(0.65, evening)?.tone).toBe('warn');
    expect(judgeScreenBrightness(1, evening)?.tone).toBe('bad');
    expect(judgeScreenBrightness(1, screenTargetAt(plan, at(13)))).toBeUndefined();
    const nl = nightLightSchedule(plan);
    expect([formatTime(nl.on), formatTime(nl.off)]).toEqual(['20:15', '07:00']);
  });
});

describe('brightness slider curve (AOSP)', () => {
  it('matches Android: half the slider is ~8% of the light, full is full', () => {
    expect(linearToSlider(0)).toBe(0);
    expect(linearToSlider(1)).toBeCloseTo(1, 3);
    expect(linearToSlider(1 / 12)).toBeCloseTo(0.5, 5);
    expect(sliderToLinear(0.5)).toBeCloseTo(1 / 12, 5);
    expect(linearToSlider(0.4)).toBeCloseTo(0.83, 2);
  });

  it('round-trips', () => {
    for (const g of [0.05, 0.15, 0.3, 0.5, 0.7, 0.95]) expect(linearToSlider(sliderToLinear(g))).toBeCloseTo(g, 6);
  });
});
