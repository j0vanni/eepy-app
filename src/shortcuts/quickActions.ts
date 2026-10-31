/**
 * One-tap actions behind eepy://quick/<action> — opened by the long-press app-icon shortcuts, the
 * "Log coffee" Quick Settings tile and the sleep-mode "play sleep sounds?" notification, and
 * handled by src/app/quick/[action].tsx. Pure: no React or native imports, so it's unit-testable.
 */
import { usualCaffeine, usualDose, type UsualCaffeine } from '../engine/caffeineHabits';
import type { NapOption, NapRecommendation } from '../engine/nap';
import { dateKey, MINUTE } from '../engine/time';
import type { CaffeineDose } from '../engine/types';

export type QuickAction = 'coffee' | 'nap' | 'late' | 'checkin' | 'sounds';

const ALIASES: Record<string, QuickAction> = {
  coffee: 'coffee',
  'usual-coffee': 'coffee',
  caffeine: 'coffee',
  nap: 'nap',
  late: 'late',
  'running-late': 'late',
  tonight: 'late',
  checkin: 'checkin',
  'check-in': 'checkin',
  sounds: 'sounds',
  'sleep-sounds': 'sounds',
};

/** The route param (string, repeated param or missing) as a known action. */
export function parseQuickAction(raw: string | string[] | undefined): QuickAction | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  return ALIASES[value.trim().toLowerCase()];
}

export function quickLink(action: QuickAction): string {
  return `eepy://quick/${action}`;
}

/** Long-press app-icon shortcuts, closest to the icon first. `icon` names a drawable in the native module. */
export interface AppShortcut {
  id: string;
  /** Launchers show this when space is tight (≈10 characters). */
  shortLabel: string;
  longLabel: string;
  link: string;
  icon: 'coffee' | 'nap' | 'late' | 'checkin';
}

export const APP_SHORTCUTS: AppShortcut[] = [
  { id: 'coffee', shortLabel: 'Coffee', longLabel: 'Log my usual coffee', link: quickLink('coffee'), icon: 'coffee' },
  { id: 'nap', shortLabel: 'Nap', longLabel: 'Start a nap', link: quickLink('nap'), icon: 'nap' },
  { id: 'late', shortLabel: 'Running late', longLabel: 'Running late', link: quickLink('late'), icon: 'late' },
  { id: 'checkin', shortLabel: 'Check in', longLabel: 'Check in', link: quickLink('checkin'), icon: 'checkin' },
];

/** A drink of the usual kind already logged this close to its usual time counts as the usual. */
const SAME_DRINK_WINDOW = 90 * MINUTE;

export type QuickCoffee =
  /** Not enough history to know a usual drink: open the drink editor instead. */
  | { kind: 'no-usual' }
  /** Today's usual is already logged (by the nudge, the Today card, the check-in or this shortcut). */
  | { kind: 'already'; dose: CaffeineDose; usual: UsualCaffeine }
  /** Log this: the usual drink at its usual time (or now, if that's still ahead), with the per-day usual id. */
  | { kind: 'log'; dose: CaffeineDose; usual: UsualCaffeine };

/**
 * "Log my usual coffee". Uses the same per-day id as every other "usual" button (usualDoseId), so
 * a second tap — or the notification's "Yes" — can't log it twice.
 */
export function planQuickCoffee(doses: CaffeineDose[], now: number): QuickCoffee {
  const usual = usualCaffeine(doses, now);
  if (!usual) return { kind: 'no-usual' };
  const dose = usualDose(usual, now);
  const day = dateKey(dose.time);
  const existing =
    doses.find((d) => d.id === dose.id) ??
    doses.find((d) => dateKey(d.time) === day && d.label === usual.label && Math.abs(d.time - dose.time) <= SAME_DRINK_WINDOW);
  if (existing) return { kind: 'already', dose: existing, usual };
  return { kind: 'log', dose, usual };
}

/** "Log another now" after the usual was already logged: a fresh id, timed now. */
export function anotherDose(usual: Pick<UsualCaffeine, 'mg' | 'label'>, now: number): CaffeineDose {
  return { id: `c-${now}-${usual.mg}`, time: now, mg: usual.mg, label: usual.label };
}

/** Screens a quick action may hand over to. */
export type QuickRedirect = '/' | '/onboarding' | '/caffeine' | '/nap' | '/tonight' | '/checkin';

export type QuickDecision =
  | { redirect: QuickRedirect }
  | { sheet: 'coffee-logged'; dose: CaffeineDose; usual: UsualCaffeine }
  | { sheet: 'coffee-already'; dose: CaffeineDose; usual: UsualCaffeine }
  /** Offer to start the recommended nap right away (or open the Nap coach). */
  | { sheet: 'nap'; option: NapOption; headline: string }
  | { sheet: 'sounds' };

export interface QuickInput {
  onboarded: boolean;
  caffeine: CaffeineDose[];
  /** A nap timer is already running: just show it. */
  napRunning: boolean;
  nap?: Pick<NapRecommendation, 'best' | 'headline'>;
}

/** What eepy://quick/<action> does, decided once when it opens. */
export function decideQuickAction(action: QuickAction | undefined, input: QuickInput, now: number): QuickDecision {
  if (!input.onboarded) return { redirect: '/onboarding' };
  switch (action) {
    case 'coffee': {
      const plan = planQuickCoffee(input.caffeine, now);
      if (plan.kind === 'no-usual') return { redirect: '/caffeine' };
      return plan.kind === 'log' ? { sheet: 'coffee-logged', dose: plan.dose, usual: plan.usual } : { sheet: 'coffee-already', dose: plan.dose, usual: plan.usual };
    }
    case 'nap': {
      const best = input.nap?.best;
      if (input.napRunning || !best?.suitable) return { redirect: '/nap' };
      return { sheet: 'nap', option: best, headline: input.nap?.headline ?? '' };
    }
    case 'late':
      return { redirect: '/tonight' };
    case 'checkin':
      return { redirect: '/checkin' };
    case 'sounds':
      return { sheet: 'sounds' };
    default:
      return { redirect: '/' };
  }
}
