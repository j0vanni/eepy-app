import { CAFFEINE_PRESETS } from '../caffeine';
import { drinkOptions, frequentDrinks, usualCaffeine, usualCaffeineMissing, usualDose } from '../caffeineHabits';
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

describe('drink options', () => {
  it('has instant and decaf coffee', () => {
    expect(CAFFEINE_PRESETS.find((p) => p.label.startsWith('Instant coffee'))?.mg).toBe(62);
    expect(CAFFEINE_PRESETS.find((p) => p.label.startsWith('Decaf'))?.mg).toBeLessThan(10);
  });

  it('puts your own drinks first and lets them replace a preset of the same name', () => {
    const opts = drinkOptions([{ label: 'My instant (2 tsp)', mg: 90 }, { label: 'Espresso shot', mg: 80 }]);
    expect(opts[0]).toEqual({ label: 'My instant (2 tsp)', mg: 90 });
    expect(opts.filter((o) => o.label === 'Espresso shot')).toEqual([{ label: 'Espresso shot', mg: 80 }]);
    expect(opts.length).toBe(CAFFEINE_PRESETS.length + 1);
  });

  it('offers what you drink most, then common defaults', () => {
    const opts = drinkOptions([{ label: 'My instant (2 tsp)', mg: 90 }]);
    const doses = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, time: now(8) - i * 86_400_000, mg: 90, label: 'My instant (2 tsp)' })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: `b${i}`, time: now(14) - (i + 1) * 86_400_000, mg: 47, label: 'Black tea' })),
      // Too old to count.
      { id: 'old', time: now(8) - 40 * 86_400_000, mg: 200, label: 'Cold brew (16 oz)' },
    ];
    const quick = frequentDrinks(doses, now(12), opts);
    expect(quick.map((d) => d.label)).toEqual(['My instant (2 tsp)', 'Black tea', 'Coffee (8 oz / 240 ml)', 'Instant coffee (8 oz)', 'Espresso shot', 'Large coffee (16 oz)']);
    expect(frequentDrinks([], now(12), opts).map((d) => d.label)[1]).toBe('Instant coffee (8 oz)');
  });
});
