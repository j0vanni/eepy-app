import { eReaderGetUpTip, eReaderIfOn, eReaderSchedule, eReaderTargetAt, READING_FRONTLIGHT } from '../eReader';
import { atMinutes, formatTime, MINUTE } from '../time';

const D = '2026-10-29';
const bed = atMinutes(D, 23 * 60 + 15);
const plan = {
  wakeTime: atMinutes(D, 7 * 60),
  windDownStart: bed - 60 * MINUTE,
  bedtime: bed,
  nextWake: atMinutes('2026-10-30', 7 * 60),
  screensOff: bed - 45 * MINUTE,
};
const at = (h: number) => atMinutes(D, h * 60);
const WARM = { warmLight: true };
const PLAIN = { warmLight: false };

describe('e-reader frontlight', () => {
  it('builds the day: anything goes, then low in wind-down, lowest from screens-off, down at lights-out', () => {
    const s = eReaderSchedule(plan, WARM);
    expect(s.map((t) => [t.phase, formatTime(t.from), formatTime(t.until)])).toEqual([
      ['day', '07:00', '20:15'],
      ['evening', '20:15', '22:15'],
      ['winddown', '22:15', '22:30'],
      ['reading', '22:30', '23:15'],
      ['night', '23:15', '07:00'],
    ]);
    expect(s.find((t) => t.phase === 'day')).toMatchObject({ maxFrontlight: 1, darkMode: false });
    expect(s.find((t) => t.phase === 'evening')).toMatchObject({ maxFrontlight: 1, warmth: 'any' });
    expect(s.find((t) => t.phase === 'winddown')).toMatchObject({ maxFrontlight: 0.3, warmth: 'high', summary: 'Frontlight ≤ 30% · warm' });
    expect(s.find((t) => t.phase === 'reading')).toMatchObject({ maxFrontlight: READING_FRONTLIGHT, warmth: 'max', darkMode: true, summary: 'Frontlight 10–20% · warmest' });
    expect(s.find((t) => t.phase === 'night')).toMatchObject({ summary: 'E-reader down' });
  });

  it('says the frontlight can be off in daylight, and the e-reader is fine after screens-off', () => {
    expect(eReaderTargetAt(plan, at(13), WARM).advice).toMatch(/frontlight can simply be off/);
    const reading = eReaderTargetAt(plan, at(22.75), WARM);
    expect(reading.phase).toBe('reading');
    expect(reading.advice).toMatch(/e-reader is fine/);
    expect(reading.advice).toMatch(/warmth all the way up/);
    expect(reading.advice).toMatch(/dark mode/);
    expect(reading.advice).toMatch(/no browser or apps, notifications off/);
  });

  it('without a warm light: no warmth, keep it low and use a lamp', () => {
    const s = eReaderSchedule(plan, PLAIN);
    expect(s.every((t) => t.warmth === undefined)).toBe(true);
    const wind = s.find((t) => t.phase === 'winddown')!;
    expect(wind.summary).toBe('Frontlight ≤ 30%');
    expect(wind.advice).toMatch(/keep it low — a dim bedside lamp on the page beats the frontlight/);
    const reading = s.find((t) => t.phase === 'reading')!;
    expect(reading.summary).toBe('Frontlight 10–20%');
    expect(reading.advice).toMatch(/bedside lamp on the page beats the frontlight/);
    expect(reading.advice).not.toMatch(/warmth/);
    expect(eReaderTargetAt(plan, at(21), PLAIN).advice).not.toMatch(/warmth/);
    expect(eReaderTargetAt(plan, at(21), WARM).advice).toMatch(/warmth up/);
  });

  it('knows the phase right now, including before this morning’s wake-up', () => {
    expect(eReaderTargetAt(plan, at(8), WARM).phase).toBe('day');
    expect(eReaderTargetAt(plan, at(21), WARM).phase).toBe('evening');
    expect(eReaderTargetAt(plan, at(22.4), WARM).phase).toBe('winddown');
    expect(eReaderTargetAt(plan, at(22.75), WARM).phase).toBe('reading');
    expect(eReaderTargetAt(plan, at(23.5), WARM).phase).toBe('night');
    const early = eReaderTargetAt(plan, at(5), WARM);
    expect(early.phase).toBe('night');
    expect(early.until).toBe(plan.wakeTime);
  });

  it('night wake-ups: read in another room until sleepy, like after screens-off', () => {
    const night = eReaderTargetAt(plan, at(23.5), WARM);
    expect(night).toMatchObject({ maxFrontlight: READING_FRONTLIGHT, warmth: 'max', darkMode: true });
    expect(night.advice).toMatch(/In bed: e-reader down/);
    expect(night.advice).toMatch(/another room/);
    expect(night.advice).toMatch(/lowest and warmest/);
    expect(eReaderTargetAt(plan, at(23.5), PLAIN).advice).toMatch(/lowest, or by a dim lamp/);
  });

  it('has no reading phase when screens-off is at lights-out', () => {
    const s = eReaderSchedule({ ...plan, screensOff: undefined }, WARM);
    expect(s.map((t) => t.phase)).toEqual(['day', 'evening', 'winddown', 'night']);
    expect(formatTime(s.find((t) => t.phase === 'winddown')!.until)).toBe('23:15');
  });

  it('follows an adjusted (later) night', () => {
    const late = { ...plan, windDownStart: plan.windDownStart + 90 * MINUTE, bedtime: plan.bedtime + 90 * MINUTE, screensOff: plan.screensOff + 90 * MINUTE };
    const reading = eReaderSchedule(late, WARM).find((t) => t.phase === 'reading')!;
    expect([formatTime(reading.from), formatTime(reading.until)]).toEqual(['00:00', '00:45']);
  });

  it('only plans for the e-reader when the setting is on', () => {
    expect(eReaderIfOn(undefined)).toBeUndefined();
    expect(eReaderIfOn({ enabled: false, warmLight: true })).toBeUndefined();
    expect(eReaderIfOn({ enabled: true, warmLight: true })).toEqual({ warmLight: true });
    expect(eReaderGetUpTip(WARM)).toMatch(/^Get up, sit somewhere dim in another room and read on your e-reader/);
  });
});
