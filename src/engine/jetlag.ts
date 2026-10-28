import { normalizeMinutes } from './time';

export interface JetLagInput {
  /** UTC offsets in minutes (east positive), e.g. New York in winter = −300. */
  homeOffsetMin: number;
  destOffsetMin: number;
  /** Habitual bedtime / wake time at home, minutes after midnight home time. */
  bedtimeMin: number;
  wakeMin: number;
  /** Days before departure the user is willing to start shifting (0–3). */
  preDays: number;
}

export interface JetLagDay {
  /** Negative = before departure, 0 = travel day, positive = days after arrival. */
  dayIndex: number;
  label: string;
  /** Clock times are in the time zone the traveller is in on that day. */
  zone: 'home' | 'destination';
  bedtimeMin: number;
  wakeMin: number;
  seekLight?: { startMin: number; endMin: number };
  avoidLight?: { startMin: number; endMin: number };
  notes: string[];
}

export interface JetLagPlan {
  shiftHours: number;
  direction: 'east' | 'west' | 'none';
  strategy: 'advance' | 'delay' | 'none';
  daysToAdjust: number;
  days: JetLagDay[];
  summary: string;
}

const ADVANCE_PER_DAY_H = 1;
const DELAY_PER_DAY_H = 1.5;

/**
 * Builds a day-by-day plan to re-entrain the body clock: how much to shift sleep each day and when
 * to seek or avoid bright light relative to the shifting core-body-temperature minimum (CBTmin).
 * Light in the ~3h after CBTmin advances the clock (helps eastward); light in the ~3h before delays it.
 */
export function planJetLag(input: JetLagInput): JetLagPlan {
  let shiftH = (input.destOffsetMin - input.homeOffsetMin) / 60;
  if (shiftH > 12) shiftH -= 24;
  if (shiftH < -12) shiftH += 24;
  if (Math.abs(shiftH) < 1) {
    return { shiftHours: shiftH, direction: 'none', strategy: 'none', daysToAdjust: 0, days: [], summary: 'Less than an hour of difference — no plan needed.' };
  }
  const direction = shiftH > 0 ? 'east' : 'west';
  // Large eastward jumps (> 9h) are usually easier to absorb by delaying around the clock.
  let strategy: 'advance' | 'delay' = direction === 'east' ? 'advance' : 'delay';
  let needed = Math.abs(shiftH);
  if (direction === 'east' && shiftH > 9) {
    strategy = 'delay';
    needed = 24 - shiftH;
  }
  const rate = strategy === 'advance' ? ADVANCE_PER_DAY_H : DELAY_PER_DAY_H;
  const sign = strategy === 'advance' ? -1 : 1; // advance = earlier clock times
  const preDays = Math.max(0, Math.min(3, Math.round(input.preDays)));
  const preShift = Math.min(needed, preDays * 1); // ≤1h/day before leaving
  const remaining = needed - preShift;
  const postDays = Math.ceil(remaining / rate);
  const days: JetLagDay[] = [];

  let shifted = 0; // body-clock hours shifted so far, in the strategy's direction
  const offsetH = shiftH; // destination clock = home clock + offsetH
  const lightFor = (wakeMinBody: number, zoneOffsetH: number) => {
    const cbt = wakeMinBody - 120; // CBTmin in home-clock minutes (body clock)
    const conv = (m: number) => normalizeMinutes(m + zoneOffsetH * 60);
    return strategy === 'advance'
      ? { seek: { startMin: conv(cbt), endMin: conv(cbt + 180) }, avoid: { startMin: conv(cbt - 180), endMin: conv(cbt) } }
      : { seek: { startMin: conv(cbt - 180), endMin: conv(cbt) }, avoid: { startMin: conv(cbt), endMin: conv(cbt + 180) } };
  };

  for (let d = preDays; d >= 1; d--) {
    shifted = Math.min(needed, shifted + 1);
    const bodyWake = input.wakeMin + sign * shifted * 60;
    const light = lightFor(bodyWake, 0);
    days.push({
      dayIndex: -d,
      label: `${d} day${d > 1 ? 's' : ''} before`,
      zone: 'home',
      bedtimeMin: normalizeMinutes(input.bedtimeMin + sign * shifted * 60),
      wakeMin: normalizeMinutes(bodyWake),
      seekLight: light.seek,
      avoidLight: light.avoid,
      notes: [`Shift sleep ${strategy === 'advance' ? 'earlier' : 'later'} by 1 hour.`],
    });
  }

  days.push({
    dayIndex: 0,
    label: 'Travel day',
    zone: 'destination',
    bedtimeMin: normalizeMinutes(input.bedtimeMin + offsetH * 60),
    wakeMin: normalizeMinutes(input.wakeMin + offsetH * 60),
    notes: [
      'Switch your watch and meals to destination time as soon as you board.',
      'Sleep on the plane only if it is night at your destination.',
      'Stay hydrated; go easy on alcohol and late caffeine.',
    ],
  });

  for (let d = 1; d <= postDays; d++) {
    shifted = Math.min(needed, shifted + rate);
    const lag = needed - shifted; // hours the body is still behind/ahead
    const bodyWake = input.wakeMin + sign * shifted * 60;
    // Express the body-clock light windows in destination clock time.
    const light = lightFor(bodyWake, offsetH);
    days.push({
      dayIndex: d,
      label: `Day ${d} after arrival`,
      zone: 'destination',
      bedtimeMin: normalizeMinutes(input.bedtimeMin + offsetH * 60),
      wakeMin: normalizeMinutes(input.wakeMin + offsetH * 60),
      seekLight: light.seek,
      avoidLight: light.avoid,
      notes:
        lag > 0.25
          ? [`Your body clock is still ~${lag.toFixed(1)}h off local time — a short early-afternoon nap (≤20 min) is fine.`]
          : ['You should be close to adjusted. Keep a regular schedule and get morning light.'],
    });
  }

  return {
    shiftHours: shiftH,
    direction,
    strategy,
    daysToAdjust: postDays,
    days,
    summary: `${Math.abs(shiftH)}h ${direction}ward: ${strategy === 'advance' ? 'advance' : 'delay'} your body clock${
      strategy === 'delay' && direction === 'east' ? ' the long way round (easier for big eastward jumps)' : ''
    }. Expect about ${postDays} day${postDays === 1 ? '' : 's'} to adjust after arrival${preDays ? `, after ${preDays} day${preDays > 1 ? 's' : ''} of pre-shifting` : ''}.`,
  };
}
