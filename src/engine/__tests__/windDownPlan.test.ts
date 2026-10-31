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

  it('moves the phone-light "screen away" phase to screens-off', () => {
    const plan = { wakeTime: atMinutes('2026-10-29', 7 * 60), windDownStart: tonight.windDownStart, bedtime: bed, nextWake: tonight.wake, screensOff: screensOffAt(tonight) };
    const night = screenLightSchedule(plan).find((t) => t.phase === 'night')!;
    expect(formatTime(night.from)).toBe('22:30');
    expect(night.title).toBe('Screens off');
    expect(screenTargetAt(plan, bed - 30 * MINUTE).phase).toBe('night');
  });
});
