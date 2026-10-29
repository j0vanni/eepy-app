import { memo, useMemo, useRef, useState } from 'react';
import { PanResponder, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import type { AlertnessPoint } from '../engine/alertness';
import { formatClock, formatTime, HOUR, minutesOfDay } from '../engine/time';
import { ChartFrame } from './charts';
import { colors, font, space } from './theme';

/** Local clock hours between start and end that are multiples of `every`. */
function hourTicks(start: number, end: number, every: number): number[] {
  const d = new Date(start);
  d.setMinutes(0, 0, 0);
  let t = d.getTime();
  if (t < start) t += HOUR;
  const out: number[] = [];
  for (; t <= end; t += HOUR) if (new Date(t).getHours() % every === 0) out.push(t);
  return out;
}

const linePath = (pts: AlertnessPoint[], x: (t: number) => number, y: (e: number) => number) =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.energy).toFixed(1)}`).join(' ');

const nearest = (pts: AlertnessPoint[], t: number) =>
  pts.length && t >= pts[0].t - 5 * 60_000 ? pts.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)) : undefined;

interface Props {
  baseline: AlertnessPoint[];
  scenario: AlertnessPoint[];
  from: number;
  to: number;
  /** Energy level of the focus zone (shaded above). */
  focusEnergy?: number;
  /** Afternoon dip of the scenario day. */
  dip?: { t: number; energy: number };
  height?: number;
  baselineLabel?: string;
  scenarioLabel?: string;
}

/**
 * Two energy curves on one 0–100 axis, styled like EnergyChart: the plan as a muted dashed reference,
 * the what-if as the highlighted line. Drag across it to read both values at a moment.
 */
export const CompareChart = memo(function CompareChart({
  baseline,
  scenario,
  from,
  to,
  focusEnergy,
  dip,
  height = 160,
  baselineLabel = 'Plan',
  scenarioLabel = 'What if',
}: Props) {
  const [scrubT, setScrubT] = useState<number | undefined>();
  const geo = useRef({ width: 0, from, to });
  geo.current.from = from;
  geo.current.to = to;

  // Claims horizontal drags only, so vertical scrolling still works over the chart.
  const pan = useMemo(() => {
    const at = (x: number) => {
      const g = geo.current;
      return g.from + Math.min(1, Math.max(0, x / Math.max(1, g.width))) * (g.to - g.from);
    };
    let startX = 0;
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 6 && Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderGrant: (e) => {
        startX = e.nativeEvent.locationX;
        setScrubT(at(startX));
      },
      onPanResponderMove: (_, gs) => setScrubT(at(startX + gs.dx)),
      onPanResponderRelease: () => setScrubT(undefined),
      onPanResponderTerminate: () => setScrubT(undefined),
    });
  }, []);

  if (to <= from) return null;
  const top = 10;
  const axisH = 18;
  const plotH = height - axisH - top;
  const b = scrubT !== undefined ? nearest(baseline, scrubT) : undefined;
  const s = scrubT !== undefined ? nearest(scenario, scrubT) : undefined;

  return (
    <View>
      <View style={{ height, pointerEvents: 'box-only' }} {...pan.panHandlers}>
        <ChartFrame height={height}>
          {(width) => {
            geo.current.width = width;
            const x = (t: number) => ((t - from) / (to - from)) * width;
            const y = (e: number) => top + plotH - (e / 100) * plotH;
            const sLine = scenario.length > 1 ? linePath(scenario, x, y) : '';
            const sArea = sLine ? `${sLine} L${x(scenario[scenario.length - 1].t).toFixed(1)},${top + plotH} L${x(scenario[0].t).toFixed(1)},${top + plotH} Z` : '';
            const bLine = baseline.length > 1 ? linePath(baseline, x, y) : '';
            const sleepEnd = scenario.length ? scenario[0].t : from;
            const scrubX = scrubT !== undefined ? x(scrubT) : undefined;
            return (
              <Svg width={width} height={height}>
                <Defs>
                  <LinearGradient id="cmpGrad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={colors.energy} stopOpacity={0.4} />
                    <Stop offset="1" stopColor={colors.energy} stopOpacity={0.02} />
                  </LinearGradient>
                </Defs>
                {focusEnergy !== undefined ? (
                  <G>
                    <Rect x={0} y={top} width={width} height={y(focusEnergy) - top} fill={colors.good} opacity={0.07} />
                    <Line x1={0} x2={width} y1={y(focusEnergy)} y2={y(focusEnergy)} stroke={colors.good} strokeWidth={0.8} strokeDasharray="4,4" opacity={0.7} />
                    <SvgText x={width - 2} y={y(focusEnergy) - 4} fill={colors.textDim} fontSize={9} textAnchor="end">
                      focus zone
                    </SvgText>
                  </G>
                ) : null}
                {sleepEnd > from ? <Rect x={0} y={top} width={x(sleepEnd)} height={plotH} fill={colors.deep} opacity={0.25} /> : null}
                {dip ? <Rect x={x(dip.t) - x(from + 45 * 60_000)} y={top} width={2 * x(from + 45 * 60_000)} height={plotH} fill={colors.warn} opacity={0.1} /> : null}
                {[25, 50, 75].map((v) => (
                  <Line key={v} x1={0} x2={width} y1={y(v)} y2={y(v)} stroke={colors.border} strokeWidth={0.5} strokeDasharray="3,4" />
                ))}
                {sArea ? <Path d={sArea} fill="url(#cmpGrad)" /> : null}
                {bLine ? <Path d={bLine} stroke={colors.textDim} strokeWidth={1.6} strokeDasharray="5,4" fill="none" opacity={0.9} /> : null}
                {sLine ? <Path d={sLine} stroke={colors.energy} strokeWidth={2.2} fill="none" /> : null}
                {dip && scrubX === undefined ? <Circle cx={x(dip.t)} cy={y(dip.energy)} r={4} fill={colors.warn} stroke={colors.surface} strokeWidth={2} /> : null}
                {scrubX !== undefined ? (
                  <G>
                    <Line x1={scrubX} x2={scrubX} y1={top} y2={top + plotH} stroke={colors.text} strokeWidth={1} strokeDasharray="2,3" />
                    {b ? <Circle cx={x(b.t)} cy={y(b.energy)} r={4} fill={colors.textDim} stroke={colors.surface} strokeWidth={2} /> : null}
                    {s ? <Circle cx={x(s.t)} cy={y(s.energy)} r={5} fill={colors.energy} stroke={colors.surface} strokeWidth={2} /> : null}
                  </G>
                ) : null}
                {hourTicks(from, to, 3).map((t) => (
                  <SvgText key={t} x={Math.min(width - 14, Math.max(14, x(t)))} y={height - 4} fill={colors.textFaint} fontSize={10} textAnchor="middle">
                    {formatClock(minutesOfDay(t))}
                  </SvgText>
                ))}
              </Svg>
            );
          }}
        </ChartFrame>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 6, minHeight: 18 }}>
        {scrubT !== undefined ? (
          <Text style={[font.small, { color: colors.text }]}>
            {formatTime(scrubT)} · {baselineLabel} {b ? Math.round(b.energy) : '—'} · {scenarioLabel} {s ? Math.round(s.energy) : 'asleep'}
          </Text>
        ) : (
          <>
            <LegendItem dashed label={baselineLabel} color={colors.textDim} />
            <LegendItem label={scenarioLabel} color={colors.energy} />
            <Text style={[font.tiny, { flex: 1, textAlign: 'right' }]}>drag to compare</Text>
          </>
        )}
      </View>
    </View>
  );
});

function LegendItem({ label, color, dashed }: { label: string; color: string; dashed?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Svg width={18} height={6}>
        <Line x1={1} x2={17} y1={3} y2={3} stroke={color} strokeWidth={dashed ? 1.6 : 2.4} strokeDasharray={dashed ? '4,3' : undefined} strokeLinecap="round" />
      </Svg>
      <Text style={font.small}>{label}</Text>
    </View>
  );
}
