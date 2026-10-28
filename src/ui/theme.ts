/** Night-friendly palette: deep navy surfaces, soft lavender accent, warm amber for warnings. */
export const colors = {
  bg: '#0B1020',
  surface: '#141A2E',
  surfaceAlt: '#1B2340',
  border: '#262F52',
  text: '#ECEAFF',
  textDim: '#A3A8C7',
  textFaint: '#6D7398',
  accent: '#9B8CFF',
  accentSoft: '#2C2A5A',
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

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 14, lg: 20, pill: 999 };

export const font = {
  h1: { fontSize: 28, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 20, fontWeight: '700' as const, color: colors.text },
  h3: { fontSize: 16, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  small: { fontSize: 13, color: colors.textDim, lineHeight: 18 },
  tiny: { fontSize: 11, color: colors.textFaint, letterSpacing: 0.3 },
  stat: { fontSize: 30, fontWeight: '700' as const, color: colors.text },
};

export function scoreColor(score: number): string {
  if (score >= 85) return colors.good;
  if (score >= 70) return colors.accent;
  if (score >= 55) return colors.warn;
  return colors.bad;
}

export function debtColor(category: string): string {
  return { none: colors.good, low: colors.good, moderate: colors.warn, high: colors.bad, severe: colors.bad }[category] ?? colors.textDim;
}
