import { usualCaffeine, usualCaffeineMissing, usualDose } from '../caffeineHabits';
import { addDays, atMinutes, formatTime } from '../time';
import type { CaffeineDose } from '../types';

const TODAY = '2026-10-30';
const now = (h: number) => atMinutes(TODAY, h * 60);
const coffee = (day: string, min: number, mg = 95, label = 'Coffee (8 oz / 240 ml)'): CaffeineDose => ({ id: `${day}-${min}`, time: atMinutes(day, min), mg, label });

function history(days: number, min = 8 * 60 + 10): CaffeineDose[] {
  const out: CaffeineDose[] = [];
  for (let i = 1; i <= days; i++) {
    const day = addDays(TODAY, -i);
    out.push(coffee(day, min + (i % 3) * 5 - 5));
    if (i % 2) out.push(coffee(day, 14 * 60, 63, 'Espresso shot'));
  }
  return out;
}

describe('usual caffeine', () => {
  it('learns the first-drink time and drink from recent mornings', () => {
    const u = usualCaffeine(history(14), now(12))!;
    expect(formatTime(atMinutes(TODAY, u.timeMin))).toBe('08:10');
    expect(u.mg).toBe(95);
    expect(u.label).toMatch(/Coffee/);
    expect(u.share).toBe(1);
  });

  it('needs a few days of history and ignores afternoon-only drinks', () => {
    expect(usualCaffeine(history(3), now(12))).toBeUndefined();
    const afternoons = Array.from({ length: 10 }, (_, i) => coffee(addDays(TODAY, -i - 1), 15 * 60));
    expect(usualCaffeine(afternoons, now(12))).toBeUndefined();
  });

  it('flags a missing usual coffee only after the grace period and before the afternoon', () => {
    const doses = history(14);
    const u = usualCaffeine(doses, now(12));
    expect(usualCaffeineMissing(doses, now(8.5), u)).toBe(false);
    expect(usualCaffeineMissing(doses, now(9.5), u)).toBe(true);
    expect(usualCaffeineMissing([...doses, coffee(TODAY, 7 * 60)], now(9.5), u)).toBe(false);
    expect(usualCaffeineMissing(doses, now(16), u)).toBe(false);
  });

  it('builds a dose at the usual time, never in the future', () => {
    const u = usualCaffeine(history(14), now(12))!;
    expect(formatTime(usualDose(u, now(12)).time)).toBe('08:10');
    expect(usualDose(u, now(7)).time).toBe(now(7));
  });
});
