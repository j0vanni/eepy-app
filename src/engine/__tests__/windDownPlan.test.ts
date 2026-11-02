import type { TonightPlan } from '../schedule';
import { screenLightSchedule, screenTargetAt } from '../screenLight';
import { atMinutes, formatTime, MINUTE } from '../time';
import { currentWindDownStep, screensOffAt, windDownTimeline } from '../windDownPlan';

const bed = atMinutes('2026-10-29', 23 * 60 + 15);
const tonight = {
  wakeDate: '2026-10-30',
  isWorkday: true,
  wake: atMinutes('2026-10-30', 7 * 60),
  bedtime: bed,
  windDownStart: bed - 60 * MINUTE,
  lastMeal: bed - 180 * MINUTE,
  lastExercise: bed - 120 * MINUTE,
  inBedMin: 465,
  extraForDebtMin: 0,
  gradual: false,
  rationale: [],
} as TonightPlan;

describe('wind-down timeline', () => {
  it('lays out the evening with screens off 45 min before lights-out', () => {
    const steps = windDownTimeline(tonight);
    expect(steps.map((s) => [s.id, formatTime(s.at)])).toEqual([
      ['evening-light', '20:15'],
      ['last-meal', '20:15'],
      ['exercise', '21:15'],
      ['wind-down', '22:15'],
      ['screens-off', '22:30'],
      ['routine', '22:55'],
      ['lights-out', '23:15'],
    ]);
  });

  it('never puts screens-off before wind-down, and drops the routine when there is no room', () => {
    expect(screensOffAt({ ...tonight, windDownStart: bed - 30 * MINUTE }, 60)).toBe(bed - 30 * MINUTE);
    const short = windDownTimeline({ ...tonight, windDownStart: bed - 15 * MINUTE }, 30);
    expect(short.find((s) => s.id === 'routine')).toBeUndefined();
    expect(formatTime(short.find((s) => s.id === 'screens-off')!.at)).toBe('23:00');
  });

  it('knows the current step', () => {
    const steps = windDownTimeline(tonight);
    expect(currentWindDownStep(steps, bed - 40 * MINUTE)?.id).toBe('screens-off');
    expect(currentWindDownStep(steps, bed - 300 * MINUTE)).toBeUndefined();
  });

  it('with an e-reader: screens-off spares it, the routine becomes reading time, and it goes down at lights-out', () => {
    const steps = windDownTimeline(tonight, 45, { eReader: { warmLight: true } });
    expect(steps.map((s) => [s.id, formatTime(s.at)])).toEqual([
      ['evening-light', '20:15'],
      ['last-meal', '20:15'],
      ['exercise', '21:15'],
      ['wind-down', '22:15'],
      ['screens-off', '22:30'],
      ['reading', '22:40'],
      ['lights-out', '23:15'],
    ]);
    const step = (id: string) => steps.find((s) => s.id === id)!;
    expect(step('screens-off').title).toBe('Screens off');
    expect(step('screens-off').detail).toMatch(/Phone, tablet, TV and laptop off — your e-reader is fine/);
    expect(step('reading').title).toBe('Read on your e-reader');
    expect(step('reading').detail).toMatch(/Until lights-out/);
    expect(step('reading').detail).toMatch(/about 10–20%\), warmth all the way up/);
    expect(step('lights-out').detail).toMatch(/^Put the e-reader down/);
    expect(step('lights-out').detail).toMatch(/another room and read on your e-reader — frontlight at its lowest and warmest/);
    expect(currentWindDownStep(steps, bed - 40 * MINUTE)?.id).toBe('screens-off');
    expect(currentWindDownStep(steps, bed - 30 * MINUTE)?.id).toBe('reading');
  });

  it('with an e-reader without a warm light: keep it low, a lamp beats the frontlight', () => {
    const steps = windDownTimeline(tonight, 45, { eReader: { warmLight: false } });
    const reading = steps.find((s) => s.id === 'reading')!;
    expect(reading.detail).toMatch(/with no warm light, a dim bedside lamp on the page beats the frontlight/);
    expect(reading.detail).not.toMatch(/warmth/);
    expect(steps.find((s) => s.id === 'lights-out')!.detail).toMatch(/frontlight at its lowest, or by a dim lamp/);
  });

  it('without the e-reader nothing changes, and a short evening has no room for reading', () => {
    const plain = windDownTimeline(tonight, 45, {});
    expect(plain.find((s) => s.id === 'reading')).toBeUndefined();
    expect(plain.find((s) => s.id === 'screens-off')!.detail).not.toMatch(/e-reader/);
    expect(plain.find((s) => s.id === 'lights-out')!.detail).not.toMatch(/e-reader/);
    const short = windDownTimeline({ ...tonight, windDownStart: bed - 15 * MINUTE }, 30, { eReader: { warmLight: true } });
    expect(short.map((s) => s.id)).toEqual(['evening-light', 'last-meal', 'exercise', 'wind-down', 'screens-off', 'lights-out']);
    expect(short.find((s) => s.id === 'screens-off')!.detail).toMatch(/e-reader is fine/);
    const thirty = windDownTimeline(tonight, 30, { eReader: { warmLight: true } });
    expect(formatTime(thirty.find((s) => s.id === 'reading')!.at)).toBe('22:55');
  });

  it('moves the phone-light "screen away" phase to screens-off', () => {
    const plan = { wakeTime: atMinutes('2026-10-29', 7 * 60), windDownStart: tonight.windDownStart, bedtime: bed, nextWake: tonight.wake, screensOff: screensOffAt(tonight) };
    const night = screenLightSchedule(plan).find((t) => t.phase === 'night')!;
    expect(formatTime(night.from)).toBe('22:30');
    expect(night.title).toBe('Screens off');
    expect(screenTargetAt(plan, bed - 30 * MINUTE).phase).toBe('night');
  });
});
