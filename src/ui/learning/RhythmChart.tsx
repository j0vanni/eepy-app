// OWNER: learning workstream. Today's predicted energy: average-person model vs. personal model, with check-ins.
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { AlertnessPoint } from '@/engine/alertness';
import { formatClock, formatHourLabel, HOUR, minutesOfDay, MINUTE } from '@/engine/time';
import { ChartFrame } from '../charts';
import { colors, font, space } from '../theme';

export interface ChartCheckIn {
  /** Placed on today's time axis (clock time of the original check-in). */
  t: number;
  energy: number;
  today: boolean;
}

function hourTicks(start: number, end: number, every: number): number[] {
  const d = new Date(start);
  d.setMinutes(0, 0, 0);
  const out: number[] = [];
  for (let t = d.getTime() + (d.getTime() < start ? HOUR : 0); t <= end; t += HOUR) if (new Date(t).getHours() % every === 0) out.push(t);
  return out;
}

const pathOf = (pts: AlertnessPoint[], x: (t: number) => number, y: (e: number) => number) =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.energy).toFixed(1)}`).join(' ');

export function RhythmChart({
  population,
  personal,
  checkins,
  now,
  height = 190,
}: {
  population: AlertnessPoint[];
  /** Omitted while the personal fit isn't in effect. */
  personal?: AlertnessPoint[];
  checkins: ChartCheckIn[];
  now: number;
  height?: number;
}) {
  if (population.length < 2) return null;
  const start = population[0].t;
  const end = population[population.length - 1].t;
  const top = 10;
  const axisH = 18;
  const labelW = 26;
  const plotH = height - axisH - top;
  return (
    <View>
      <ChartFrame height={height}>
        {(width) => {
          const plotW = width - labelW;
          const x = (t: number) => labelW + ((t - start) / (end - start)) * plotW;
          const y = (e: number) => top + plotH - (e / 100) * plotH;
          const sleepRuns: { s: number; e: number }[] = [];
          for (const p of population) {
            if (!p.asleep) continue;
            const last = sleepRuns[sleepRuns.length - 1];
            if (last && p.t - last.e <= 6 * MINUTE) last.e = p.t;
            else sleepRuns.push({ s: p.t, e: p.t });
          }
          // Lines stop at lights-out; the shaded band shows the planned sleep.
          let cut = population.length;
          while (cut > 0 && population[cut - 1].asleep) cut--;
          const lightsOut = cut < population.length ? population[cut].t : Infinity;
          const awake = (pts: AlertnessPoint[]) => pts.filter((p) => p.t < lightsOut);
          const main = awake(personal ?? population);
          const showNow = now >= start && now <= end;
          return (
            <Svg width={width} height={height}>
              {sleepRuns.map((r, i) => (
                <Rect key={`s${i}`} x={x(r.s)} y={top} width={Math.max(1, x(r.e) - x(r.s))} height={plotH} fill={colors.deep} opacity={0.22} />
              ))}
              {[25, 50, 75].map((v) => (
                <G key={v}>
                  <Line x1={labelW} x2={width} y1={y(v)} y2={y(v)} stroke={colors.border} strokeWidth={0.5} strokeDasharray="3,4" />
                  <SvgText x={0} y={y(v) + 3} fill={colors.textFaint} fontSize={9}>
                    {v}
                  </SvgText>
                </G>
              ))}
              {personal ? <Path d={pathOf(awake(population), x, y)} stroke={colors.textDim} strokeWidth={1.5} strokeDasharray="5,4" fill="none" opacity={0.8} /> : null}
              <Path d={pathOf(main, x, y)} stroke={colors.energy} strokeWidth={2} fill="none" />
              {showNow ? <Line x1={x(now)} x2={x(now)} y1={top} y2={top + plotH} stroke={colors.text} strokeWidth={1} strokeDasharray="2,3" opacity={0.6} /> : null}
              {checkins
                .filter((c) => c.t >= start && c.t <= end)
                .sort((a, b) => Number(a.today) - Number(b.today))
                .map((c, i) => (
                  <Circle
                    key={i}
                    cx={x(c.t)}
                    cy={y(c.energy)}
                    r={c.today ? 5 : 4}
                    fill={colors.accent}
                    opacity={c.today ? 1 : 0.55}
                    stroke={colors.surface}
                    strokeWidth={2}
                  />
                ))}
              {hourTicks(start, end, 3).map((t) => (
                <SvgText key={t} x={x(t)} y={height - 4} fill={colors.textFaint} fontSize={10} textAnchor="middle">
                  {formatHourLabel(minutesOfDay(t))}
                </SvgText>
              ))}
            </Svg>
          );
        }}
      </ChartFrame>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.sm }}>
        <Legend swatch={<View style={{ width: 16, height: 2, backgroundColor: colors.energy, borderRadius: 1 }} />} label={personal ? 'Your rhythm' : 'Forecast'} />
        {personal ? (
          <Legend
            swatch={
              <View style={{ flexDirection: 'row', gap: 2 }}>
                {[0, 1, 2].map((k) => (
                  <View key={k} style={{ width: 4, height: 2, backgroundColor: colors.textDim }} />
                ))}
              </View>
            }
            label="Average person"
          />
        ) : null}
        <Legend swatch={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} />} label="Your check-ins (2 weeks)" />
      </View>
    </View>
  );
}

function Legend({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {swatch}
      <Text style={font.tiny}>{label}</Text>
    </View>
  );
}
