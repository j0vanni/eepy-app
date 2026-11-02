import { Platform } from 'react-native';

/**
 * Night-friendly palette: deep navy surfaces, soft lavender accent, warm amber for warnings.
 * Colour roles: accent (purple) = actions and "your plan"; energy (yellow) = alertness, mornings,
 * daylight; caffeine (brown) = drinks; light (violet) = evening light, wind-down and light sleep;
 * info (sky) = neutral notes; good / warn / bad = outcomes.
 */
export const colors = {
  bg: '#0B1020',
  surface: '#141A2E',
  surfaceAlt: '#1B2340',
  border: '#262F52',
  text: '#ECEAFF',
  textDim: '#A3A8C7',
  // Faint text still clears 4.5:1 on every surface (hints and captions are small).
  textFaint: '#8188AD',
  accent: '#9B8CFF',
  accentSoft: '#2C2A5A',
  /** Text and icons on a filled accent (or other bright) background. */
  onAccent: '#140F33',
  good: '#5FD3A5',
  warn: '#FFB86B',
  bad: '#FF7A90',
  info: '#6CC6FF',
  // Sleep stages
  awake: '#FF9E7A',
  rem: '#6CC6FF',
  light: '#8C7DFF',
  deep: '#4B3FC9',
  asleep: '#7B74C9',
  // Energy curve
  energy: '#FFD27A',
  caffeine: '#C79A6B',
};

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

/** 4-point spacing scale. Cards pad with lg, sit md apart; sections are xl apart. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 14, lg: 18, pill: 999 };
/** Minimum touch target (Android: 48 dp; never below 44). Small controls add hitSlop to reach it. */
export const touch = { min: 44, comfy: 48 };
/** Icon sizes: inline with small text, in list rows and titles, and on big buttons. */
export const iconSize = { sm: 16, md: 20, lg: 24 };

/**
 * Type scale. Every style that wraps carries a line height so paragraphs breathe the same way on
 * every screen; `label` is the small uppercase caption used for section headers and stat labels.
 */
export const font = {
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, color: colors.text, letterSpacing: -0.2 },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const, color: colors.text },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 22 },
  small: { fontSize: 13, color: colors.textDim, lineHeight: 19 },
  tiny: { fontSize: 11.5, color: colors.textFaint, lineHeight: 16, letterSpacing: 0.2 },
  label: { fontSize: 11, lineHeight: 15, fontWeight: '600' as const, color: colors.textFaint, letterSpacing: 0.7 },
  stat: { fontSize: 30, fontWeight: '700' as const, color: colors.text },
};

/** Sans-serif for SVG chart text (react-native-svg falls back to a serif face on web without it). */
export const CHART_FONT = Platform.select({ web: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', default: 'sans-serif' });

export function scoreColor(score: number): string {
  if (score >= 85) return colors.good;
  if (score >= 70) return colors.accent;
  if (score >= 55) return colors.warn;
  return colors.bad;
}

export function debtColor(category: string): string {
  return { none: colors.good, low: colors.good, moderate: colors.warn, high: colors.bad, severe: colors.bad }[category] ?? colors.textDim;
}
