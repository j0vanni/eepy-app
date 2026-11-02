/** Text inside SVG charts: one sans-serif face and size everywhere, and axis labels that stay inside the chart. */
import type { ReactNode } from 'react';
import { Text as SvgText, type TextProps } from 'react-native-svg';

import { CHART_FONT, colors } from './theme';

export function ChartText({ fontSize = 10, fill = colors.textFaint, children, ...rest }: TextProps & { children?: ReactNode }) {
  return (
    <SvgText fontFamily={CHART_FONT} fontSize={fontSize} fill={fill} {...rest}>
      {children}
    </SvgText>
  );
}

/** An x-axis label centred on `x`, except near the edges where it is anchored so it isn't cut off. */
export function edgeAnchor(x: number, width: number, pad = 14): { x: number; textAnchor: 'start' | 'middle' | 'end' } {
  if (x > width - pad) return { x: Math.min(x, width - 1), textAnchor: 'end' };
  if (x < pad) return { x: Math.max(x, 1), textAnchor: 'start' };
  return { x, textAnchor: 'middle' };
}
