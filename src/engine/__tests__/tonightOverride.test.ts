import { analyze } from '../analysis';
import { generateDemoData } from '../demo';
import { applyTonightOverride } from '../schedule';
import { atMinutes, HOUR, MINUTE } from '../time';

// Thursday evening; tonight's plan wakes on Friday (a workday at 07:00 in the demo profile).
const NOW = atMinutes('2026-10-29', 19 * 60);
const data = generateDemoData(NOW);
const plain = analyze(data, NOW);

describe('adjusting tonight', () => {
  it('moves bedtime and everything tied to it, and remembers the plan', () => {
    const late = plain.tonight.bedtime + 90 * MINUTE;
    const a = analyze(data, NOW, { tonightOverride: { wakeDate: plain.tonight.wakeDate, bedtime: late } });
    expect(a.tonight.bedtime).toBe(late);
    expect(a.tonight.wake).toBe(plain.tonight.wake);
    expect(a.tonight.windDownStart).toBe(late - data.profile.windDownMin * MINUTE);
    expect(a.tonight.lastMeal - plain.tonight.lastMeal).toBe(90 * MINUTE);
    expect(a.tonight.inBedMin).toBe(plain.tonight.inBedMin - 90);
    expect(a.tonight.adjusted).toEqual({ plannedBedtime: plain.tonight.bedtime, plannedWake: plain.tonight.wake });
    expect(a.tonight.rationale[0]).toMatch(/^Adjusted for tonight: lights out/);
    // The alarm is re-timed to a cycle boundary after the later bedtime, still before the wake-up.
    expect(a.alarm.alarm).toBeLessThanOrEqual(a.tonight.wake);
    expect(a.alarm.alarm).toBeGreaterThan(late);
    // A later bedtime allows a later caffeine cut-off.
    if (plain.caffeine.cutoff.cutoff && a.caffeine.cutoff.cutoff) expect(a.caffeine.cutoff.cutoff).toBeGreaterThan(plain.caffeine.cutoff.cutoff);
  });

  it('can move the wake-up too', () => {
    const wake = plain.tonight.wake + HOUR;
    const a = analyze(data, NOW, { tonightOverride: { wakeDate: plain.tonight.wakeDate, wake } });
    expect(a.tonight.wake).toBe(wake);
    expect(a.tonight.bedtime).toBe(plain.tonight.bedtime);
    expect(a.alarm.alarm).toBeGreaterThan(plain.alarm.alarm);
  });

  it('ignores an override for another night, or one that leaves no night', () => {
    expect(applyTonightOverride(plain.tonight, { wakeDate: '2026-10-29', bedtime: plain.tonight.bedtime + HOUR }, 60)).toBe(plain.tonight);
    expect(applyTonightOverride(plain.tonight, { wakeDate: plain.tonight.wakeDate, bedtime: plain.tonight.wake - 30 * MINUTE }, 60)).toBe(plain.tonight);
    expect(applyTonightOverride(plain.tonight, undefined, 60)).toBe(plain.tonight);
    expect(applyTonightOverride(plain.tonight, { wakeDate: plain.tonight.wakeDate, bedtime: plain.tonight.bedtime }, 60)).toBe(plain.tonight);
  });
});
