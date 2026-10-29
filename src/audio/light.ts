/** Room-light guidance from the phone's ambient-light sensor (lux). Pure. */

export type LightContext = 'evening' | 'morning' | 'day';

export type LightTone = 'good' | 'info' | 'warn' | 'bad';

export interface LightAdvice {
  tone: LightTone;
  title: string;
  body: string;
}

/** Thresholds (lux) used by the guidance and the meter's markers. */
export const LUX = {
  /** Below this before bed: melatonin is barely suppressed. */
  eveningIdeal: 10,
  /** Above this before bed: bright enough to delay melatonin noticeably. */
  eveningBright: 50,
  /** Typical bright indoor lighting. */
  indoorBright: 250,
  /** Outdoor-strength light: enough to anchor the body clock in the morning. */
  outdoor: 1000,
};

/**
 * Which guidance applies now: morning from 1h before until 4h after today's wake time, evening
 * from 3h before wind-down until 3h after bedtime, otherwise daytime.
 */
export function lightContextAt(now: number, plan: { wakeTime?: number; windDownStart?: number; bedtime?: number }): LightContext {
  const H = 3_600_000;
  if (plan.wakeTime !== undefined && now >= plan.wakeTime - H && now <= plan.wakeTime + 4 * H) return 'morning';
  if (plan.windDownStart !== undefined && plan.bedtime !== undefined && now >= plan.windDownStart - 3 * H && now <= plan.bedtime + 3 * H) return 'evening';
  if (plan.wakeTime === undefined && plan.windDownStart === undefined) {
    const h = new Date(now).getHours();
    if (h >= 5 && h < 11) return 'morning';
    if (h >= 19 || h < 5) return 'evening';
  }
  return 'day';
}

export function lightAdvice(lux: number, context: LightContext): LightAdvice {
  const l = Math.max(0, lux);
  if (context === 'evening') {
    if (l < LUX.eveningIdeal) return { tone: 'good', title: 'Dim enough for melatonin', body: 'Under 10 lux is ideal before bed. Keep it this way until lights-out.' };
    if (l <= LUX.eveningBright) return { tone: 'info', title: 'Fairly dim', body: 'Fine for winding down — a lamp low and warm, away from your eyes, is even better.' };
    if (l < LUX.indoorBright) return { tone: 'warn', title: 'Dim the lights', body: 'Over 50 lux this late starts to hold back melatonin. Switch to a low lamp.' };
    return { tone: 'bad', title: 'Too bright for bedtime', body: 'Room light this bright can delay your body clock. Turn off overhead lights and dim screens.' };
  }
  if (context === 'morning') {
    if (l >= LUX.outdoor) return { tone: 'good', title: 'Outdoor-strength light', body: 'Over 1 000 lux — this is the light that sets your body clock. 10–30 minutes is plenty.' };
    if (l >= LUX.indoorBright) return { tone: 'info', title: 'Bright indoor light', body: 'Helpful, but daylight outside is 10–100× brighter. Step out or sit by a window.' };
    return { tone: 'warn', title: 'Too dim to wake your body clock', body: 'Indoor light is weak. Get outside for 10–30 minutes soon after waking, even if it is cloudy.' };
  }
  if (l >= LUX.outdoor) return { tone: 'good', title: 'Daylight', body: 'Bright light in the day makes you more alert now and sleepier tonight.' };
  if (l >= LUX.indoorBright) return { tone: 'info', title: 'Bright indoor light', body: 'Good for alertness. Save dim light for the evening.' };
  return { tone: 'info', title: 'Dim for daytime', body: 'A brighter room or a walk outside can lift your energy.' };
}

/** 0–1 position on a log-scale meter from 1 to 10 000 lux. */
export function luxMeterPosition(lux: number): number {
  return Math.min(1, Math.max(0, Math.log10(Math.max(1, lux)) / 4));
}

/** Exponential smoothing so the reading doesn't flicker. Works in log space (perception). */
export function smoothLux(prev: number | undefined, next: number, alpha = 0.3): number {
  if (prev === undefined || !Number.isFinite(prev)) return Math.max(0, next);
  const lp = Math.log1p(Math.max(0, prev));
  const ln = Math.log1p(Math.max(0, next));
  return Math.expm1(lp + alpha * (ln - lp));
}

export function formatLux(lux: number): string {
  if (lux >= 10_000) return `${Math.round(lux / 1000)}k`;
  if (lux >= 1000) return `${(lux / 1000).toFixed(1)}k`;
  if (lux >= 10) return String(Math.round(lux));
  return lux.toFixed(1);
}
