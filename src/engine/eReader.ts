/**
 * E-ink reader (Kindle, Kobo, Boox…) through the evening: what to set its frontlight to, from
 * tonight's plan — the same phases as the phone (engine/screenLight.ts), plus reading time from
 * screens-off to lights-out. Pure.
 *
 * Why an e-reader is fine after screens-off when a phone or tablet isn't: e-ink reflects light like
 * paper instead of shining a backlight at your eyes. With the frontlight low the light reaching
 * the eye is a small fraction of a phone's, and a warm (amber) frontlight cuts the blue part that
 * melatonin is most sensitive to. A light-emitting tablet before bed delays melatonin and sleep
 * compared with a printed book (Chang et al., 2015); a low, warm e-ink frontlight is much closer to
 * the book. It is also just reading — no feed, no messages — as long as it stays that way (Android
 * readers like Boox can run a browser and apps: keep those and notifications off at night).
 */
import { ScreenPhase, ScreenPlanInput, screenLightSchedule } from './screenLight';
import { HOUR } from './time';

/** What eepy knows about your e-reader (Settings → Wind-down & phone light). */
export interface EReader {
  /** It has a warm (amber) frontlight — e.g. Kindle Paperwhite, Kobo Clara, most Boox. */
  warmLight: boolean;
}

/** The e-reader to plan for, or undefined when the setting is off. */
export function eReaderIfOn(s: { enabled: boolean; warmLight: boolean } | undefined): EReader | undefined {
  return s?.enabled ? { warmLight: s.warmLight } : undefined;
}

export type EReaderPhase = 'day' | 'evening' | 'winddown' | 'reading' | 'night';

export interface EReaderTarget {
  phase: EReaderPhase;
  from: number;
  until: number;
  /** Highest frontlight to aim for, as a position of the reader's light slider (0–1); 1 = whatever is comfortable. */
  maxFrontlight: number;
  /** How warm to set the light — as you like, well up, or all the way. Undefined when it has no warm light. */
  warmth?: 'any' | 'high' | 'max';
  /** Dark mode (light text on black) lights less of the screen; worth it if the reader has one. */
  darkMode: boolean;
  /** One line for a schedule row: "Frontlight 10–20% · warmest". */
  summary: string;
  title: string;
  advice: string;
}

/** The reading-time frontlight: "about 10–20%", the lowest most people can read at comfortably. */
export const READING_FRONTLIGHT = 0.2;
const WIND_DOWN_FRONTLIGHT = 0.3;

const LAMP = 'a dim bedside lamp on the page beats the frontlight';

/** "frontlight at its lowest and warmest" — or, without a warm light, "frontlight at its lowest, or by a dim lamp". */
export function eReaderLowLight(e: EReader): string {
  return e.warmLight ? 'frontlight at its lowest and warmest' : 'frontlight at its lowest, or by a dim lamp';
}

/** The "can't sleep? get up and read" advice with the e-reader in it. */
export function eReaderGetUpTip(e: EReader): string {
  return `Get up, sit somewhere dim in another room and read on your e-reader — ${eReaderLowLight(e)} — until you're sleepy, then go back to bed.`;
}

/** Frontlight advice for the stretch between screens-off and lights-out (also used by the wind-down timeline). */
export function eReaderReadingLight(e: EReader): string {
  return e.warmLight
    ? 'Frontlight at the lowest you can read comfortably (about 10–20%), warmth all the way up, and dark mode if your reader has it.'
    : `Frontlight as low as you can read (about 10–20%) — with no warm light, ${LAMP}. Dark mode helps if your reader has it.`;
}

function target(phase: EReaderPhase, from: number, until: number, e: EReader): EReaderTarget {
  const warm = e.warmLight;
  switch (phase) {
    case 'day':
      return {
        phase,
        from,
        until,
        maxFrontlight: 1,
        warmth: warm ? 'any' : undefined,
        darkMode: false,
        summary: 'Anything comfortable',
        title: 'Daytime: anything comfortable',
        advice: 'E-ink reflects light like paper, so in daylight or a bright room the frontlight can simply be off.',
      };
    case 'evening':
      return {
        phase,
        from,
        until,
        maxFrontlight: 1,
        warmth: warm ? 'any' : undefined,
        darkMode: false,
        summary: 'Anything comfortable',
        title: 'Evening: anything comfortable',
        advice: `With the lamps on you may not need the frontlight at all; otherwise set it to whatever is comfortable.${warm ? ' Start turning the warmth up.' : ''}`,
      };
    case 'winddown':
      return {
        phase,
        from,
        until,
        maxFrontlight: WIND_DOWN_FRONTLIGHT,
        warmth: warm ? 'high' : undefined,
        darkMode: false,
        summary: warm ? 'Frontlight ≤ 30% · warm' : 'Frontlight ≤ 30%',
        title: 'Wind-down: frontlight low',
        advice: warm ? 'Frontlight at 30% or less, warmth well up (mostly amber).' : `Frontlight at 30% or less. It has no warm light, so keep it low — ${LAMP}.`,
      };
    case 'reading':
      return {
        phase,
        from,
        until,
        maxFrontlight: READING_FRONTLIGHT,
        warmth: warm ? 'max' : undefined,
        darkMode: true,
        summary: warm ? 'Frontlight 10–20% · warmest' : 'Frontlight 10–20%',
        title: warm ? 'Before lights-out: lowest and warmest' : 'Before lights-out: as low as you can read',
        advice: `Phones and tablets are off, but the e-reader is fine — it reflects light instead of shining it at you. ${eReaderReadingLight(e)} Books only: no browser or apps, notifications off.`,
      };
    case 'night':
      return {
        phase,
        from,
        until,
        maxFrontlight: READING_FRONTLIGHT,
        warmth: warm ? 'max' : undefined,
        darkMode: true,
        summary: 'E-reader down',
        title: 'Night: e-reader down',
        advice: `In bed: e-reader down, light off. Awake for ~20 minutes and not sleepy? ${eReaderGetUpTip(e)}`,
      };
  }
}

const PHASE_OF: Record<ScreenPhase, EReaderPhase> = { morning: 'day', day: 'day', evening: 'evening', winddown: 'winddown', night: 'night' };

/** Today's e-reader phases from this morning's wake-up to tomorrow's, in order. */
export function eReaderSchedule(p: ScreenPlanInput, e: EReader): EReaderTarget[] {
  const out: EReaderTarget[] = [];
  const push = (phase: EReaderPhase, from: number, until: number) => {
    if (until <= from) return;
    const last = out[out.length - 1];
    // Morning and daytime are the same for an e-reader: one 'day' phase.
    if (last && last.phase === phase && last.until === from) out[out.length - 1] = target(phase, last.from, until, e);
    else out.push(target(phase, from, until, e));
  };
  for (const t of screenLightSchedule(p)) {
    if (t.phase !== 'night') {
      push(PHASE_OF[t.phase], t.from, t.until);
      continue;
    }
    // The phone's "screen away" phase starts at screens-off; for the e-reader that's reading time until lights-out.
    const lightsOut = Math.max(t.from, Math.min(p.bedtime, t.until));
    push('reading', t.from, lightsOut);
    push('night', lightsOut, t.until);
  }
  return out;
}

/** The phase `now` falls in (before this morning's wake counts as night, after tomorrow's as day). */
export function eReaderTargetAt(p: ScreenPlanInput, now: number, e: EReader): EReaderTarget {
  const schedule = eReaderSchedule(p, e);
  const hit = schedule.find((t) => now >= t.from && now < t.until);
  if (hit) return hit;
  if (now < p.wakeTime) return target('night', now - HOUR, p.wakeTime, e);
  return schedule[0];
}
