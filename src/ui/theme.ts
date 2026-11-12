import { Platform } from 'react-native';

/**
 * eepy's look: a bedside clock. Near-black, warm white type, one amber signal colour.
 *
 * - Amber is the only accent: the energy number, the one main action on a screen, "now".
 *   Amber light is also the light that disturbs sleep least, which is the point of the app.
 * - Blue belongs to sleep (stages, nights, the body clock) and never to buttons.
 * - No borders around blocks: panels are a slightly lighter black, groups are separated by space
 *   and a small caption, rows by a hairline.
 * - Big numbers carry the screen; everything else is quiet.
 */
export const colors = {
  bg: '#0A0A0B',
  /** A panel: a block lifted off the page. */
  surface: '#151517',
  /** A control inside a panel (a secondary button, a chip, a field). */
  surfaceAlt: '#212124',
  /** Hairlines and tracks. */
  border: '#2C2C30',
  text: '#F4F1EA',
  textDim: '#B1ADA4',
  // Faint text still clears 4.5:1 on the page and on panels (hints and captions are small).
  textFaint: '#8B877E',
  accent: '#FFB224',
  /** A quiet amber wash behind a selected or highlighted thing. */
  accentSoft: '#2E230F',
  /** Text and icons on a filled accent (or other bright) background. */
  onAccent: '#1A1200',
  good: '#6FD08C',
  warn: '#FF9A3D',
  bad: '#FF6B6B',
  /** Behind a destructive button. */
  badSoft: '#33181A',
  info: '#8AB4FF',
  /** Sleep: nights, the plan for tonight, the body clock. */
  sleep: '#8AB4FF',
  sleepSoft: '#14203A',
  // Sleep stages
  awake: '#FF8F6B',
  rem: '#7CD4FD',
  light: '#6C9BF2',
  deep: '#3558C9',
  asleep: '#5F86DD',
  // Energy curve
  energy: '#FFB224',
  caffeine: '#C9A27C',
};

/** The dimmed night view: true black, text a step down. */
export const night = { bg: '#000000', surface: '#0C0C0D', text: '#B1ADA4', textDim: '#7C786F', border: '#1A1A1C' };

export const STAGE_COLOR: Record<string, string> = {
  awake: colors.awake,
  outOfBed: colors.awake,
  rem: colors.rem,
  light: colors.light,
  deep: colors.deep,
  asleep: colors.asleep,
};

export const STAGE_LABEL: Record<string, string> = {
  awake: 'Awake',
  outOfBed: 'Out of bed',
  rem: 'REM',
  light: 'Light',
  deep: 'Deep',
  asleep: 'Asleep',
};

/** 4-point spacing scale. Panels pad with lg, sit md apart; groups are xl apart. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 };
/** Minimum touch target (Android: 48 dp; never below 44). Small controls add hitSlop to reach it. */
export const touch = { min: 44, comfy: 52 };
/** Icon sizes: inline with small text, in list rows and titles, and on big buttons. */
export const iconSize = { sm: 16, md: 20, lg: 24 };

/**
 * Type scale. Every style that wraps carries a line height; `label` is the small caption over
 * groups and numbers; `display` is the one big number a screen is about.
 */
export const font = {
  display: { fontSize: 64, lineHeight: 68, fontWeight: '800' as const, color: colors.text, letterSpacing: -2, fontVariant: ['tabular-nums' as const] },
  h1: { fontSize: 30, lineHeight: 36, fontWeight: '800' as const, color: colors.text, letterSpacing: -0.6 },
  h2: { fontSize: 21, lineHeight: 27, fontWeight: '700' as const, color: colors.text, letterSpacing: -0.2 },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15.5, color: colors.text, lineHeight: 22 },
  small: { fontSize: 13.5, color: colors.textDim, lineHeight: 19 },
  tiny: { fontSize: 12, color: colors.textFaint, lineHeight: 16 },
  label: { fontSize: 11.5, lineHeight: 15, fontWeight: '700' as const, color: colors.textFaint, letterSpacing: 0.9 },
  stat: { fontSize: 30, fontWeight: '800' as const, color: colors.text, letterSpacing: -0.6 },
};

/** Sans-serif for SVG chart text (react-native-svg falls back to a serif face on web without it). */
export const CHART_FONT = Platform.select({ web: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', default: 'sans-serif' });

export function scoreColor(score: number): string {
  if (score >= 85) return colors.good;
  if (score >= 70) return colors.text;
  if (score >= 55) return colors.warn;
  return colors.bad;
}

export function debtColor(category: string): string {
  return { none: colors.good, low: colors.good, moderate: colors.warn, high: colors.bad, severe: colors.bad }[category] ?? colors.textDim;
}
