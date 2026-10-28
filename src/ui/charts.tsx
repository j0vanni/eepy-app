import { ReactNode, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import type { AlertnessPoint } from '../engine/alertness';
import type { StageMinutes } from '../engine/sessions';
import { formatClock, formatDuration, HOUR, minutesOfDay, MINUTE } from '../engine/time';
import type { StageSegment } from '../engine/types';
import { colors, font, STAGE_COLOR, STAGE_LABEL } from './theme';

/** Measures available width and renders the chart once known. */
export function ChartFrame({ height, children }: { height: number; children: (width: number) => ReactNode }) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width));
  return (
    <View onLayout={onLayout} style={{ height, width: '100%' }}>
      {w > 0 ? children(w) : null}
    </View>
  );
}

const hourLabel = (t: number) => formatClock(minutesOfDay(t)).slice(0, 2);

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

const ROWS: Record<string, number> = { awake: 0, outOfBed: 0, rem: 1, light: 2, asleep: 2, deep: 3 };

export function Hypnogram({ segments, start, end, height = 140 }: { segments: StageSegment[]; start: number; end: number; height?: number }) {
  const labelW = 44;
  const axisH = 18;
  const rowH = (height - axisH) / 4;
  return (
    <ChartFrame height={height}>
      {(width) => {
        const plotW = width - labelW;
        const x = (t: number) => labelW + ((t - start) / (end - start)) * plotW;
        return (
          <Svg width={width} height={height}>
            {['Awake', 'REM', 'Light', 'Deep'].map((l, i) => (
              <G key={l}>
                <SvgText x={0} y={i * rowH + rowH / 2 + 4} fill={colors.textFaint} fontSize={10}>
                  {l}
                </SvgText>
                <Line x1={labelW} x2={width} y1={(i + 1) * rowH} y2={(i + 1) * rowH} stroke={colors.border} strokeWidth={0.5} />
              </G>
            ))}
            {segments.map((s, i) => {
              const row = ROWS[s.stage] ?? 2;
              const w = Math.max(1, x(s.end) - x(s.start));
              return <Rect key={i} x={x(s.start)} y={row * rowH + 3} width={w} height={rowH - 6} rx={2} fill={STAGE_COLOR[s.stage]} />;
            })}
            {hourTicks(start, end, (end - start) / HOUR > 10 ? 2 : 1).map((t) => (
              <SvgText key={t} x={x(t)} y={height - 4} fill={colors.textFaint} fontSize={10} textAnchor="middle">
                {hourLabel(t)}
              </SvgText>
            ))}
          </Svg>
        );
      }}
    </ChartFrame>
  );
}

export function StageBar({ minutes, height = 14 }: { minutes: StageMinutes; height?: number }) {
  const parts = (['deep', 'light', 'asleep', 'rem', 'awake'] as const).filter((k) => minutes[k] > 0);
  const total = parts.reduce((s, k) => s + minutes[k], 0) || 1;
  return (
    <View>
      <View style={{ flexDirection: 'row', height, borderRadius: height / 2, overflow: 'hidden' }}>
        {parts.map((k) => (
          <View key={k} style={{ flex: minutes[k] / total, backgroundColor: STAGE_COLOR[k] }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        {parts.map((k) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: STAGE_COLOR[k] }} />
            <Text style={font.small}>
              {STAGE_LABEL[k]} {formatDuration(minutes[k])}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function EnergyChart({
  points,
  now,
  dip,
  focusWindows,
  nap,
  height = 170,
}: {
  points: AlertnessPoint[];
  now: number;
  dip?: { start: number; end: number; t: number };
  focusWindows?: { start: number; end: number }[];
  nap?: { start: number; end: number };
  height?: number;
}) {
  if (points.length < 2) return null;
  const start = points[0].t;
  const end = points[points.length - 1].t;
  const top = 10;
  const axisH = 18;
  const plotH = height - axisH - top;
  return (
    <ChartFrame height={height}>
      {(width) => {
        const x = (t: number) => ((t - start) / (end - start)) * width;
        const y = (e: number) => top + plotH - (e / 100) * plotH;
        const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.energy).toFixed(1)}`).join(' ');
        const area = `${line} L${width},${top + plotH} L0,${top + plotH} Z`;
        const sleepRuns: { s: number; e: number }[] = [];
        for (const p of points) {
          if (!p.asleep) continue;
          const last = sleepRuns[sleepRuns.length - 1];
          if (last && p.t - last.e <= 6 * MINUTE) last.e = p.t;
          else sleepRuns.push({ s: p.t, e: p.t });
        }
        const nowP = points.reduce((a, b) => (Math.abs(b.t - now) < Math.abs(a.t - now) ? b : a));
        const showNow = now >= start && now <= end;
        return (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.energy} stopOpacity={0.45} />
                <Stop offset="1" stopColor={colors.energy} stopOpacity={0.02} />
              </LinearGradient>
            </Defs>
            {(focusWindows ?? []).map((w, i) => (
              <Rect key={`f${i}`} x={x(w.start)} y={top} width={x(w.end) - x(w.start)} height={plotH} fill={colors.good} opacity={0.08} />
            ))}
            {dip ? <Rect x={x(dip.start)} y={top} width={x(dip.end) - x(dip.start)} height={plotH} fill={colors.warn} opacity={0.1} /> : null}
            {nap ? <Rect x={x(nap.start)} y={top} width={Math.max(3, x(nap.end) - x(nap.start))} height={plotH} fill={colors.accent} opacity={0.25} /> : null}
            {sleepRuns.map((r, i) => (
              <Rect key={`s${i}`} x={x(r.s)} y={top} width={x(r.e) - x(r.s)} height={plotH} fill={colors.deep} opacity={0.25} />
            ))}
            {[25, 50, 75].map((v) => (
              <Line key={v} x1={0} x2={width} y1={y(v)} y2={y(v)} stroke={colors.border} strokeWidth={0.5} strokeDasharray="3,4" />
            ))}
            <Path d={area} fill="url(#eg)" />
            <Path d={line} stroke={colors.energy} strokeWidth={2.2} fill="none" />
            {showNow ? (
              <G>
                <Line x1={x(now)} x2={x(now)} y1={top} y2={top + plotH} stroke={colors.text} strokeWidth={1} strokeDasharray="2,3" />
                <Circle cx={x(nowP.t)} cy={y(nowP.energy)} r={5} fill={colors.energy} stroke={colors.bg} strokeWidth={2} />
              </G>
            ) : null}
            {hourTicks(start, end, 3).map((t) => (
              <SvgText key={t} x={x(t)} y={height - 4} fill={colors.textFaint} fontSize={10} textAnchor="middle">
                {formatClock(minutesOfDay(t))}
              </SvgText>
            ))}
          </Svg>
        );
      }}
    </ChartFrame>
  );
}

export interface BarDatum {
  label: string;
  value?: number;
  extra?: number;
  highlight?: boolean;
}

/** Sleep duration bars (main + nap stacked) against a sleep-need reference line. */
export function DurationBars({ data, need, height = 160 }: { data: BarDatum[]; need: number; height?: number }) {
  const axisH = 16;
  const top = 14;
  const plotH = height - axisH - top;
  const max = Math.max(need * 1.25, ...data.map((d) => (d.value ?? 0) + (d.extra ?? 0)));
  return (
    <ChartFrame height={height}>
      {(width) => {
        const slot = width / data.length;
        const bw = Math.max(3, slot * 0.62);
        const y = (v: number) => top + plotH - (v / max) * plotH;
        const every = Math.ceil(data.length / 10);
        return (
          <Svg width={width} height={height}>
            {data.map((d, i) => {
              const x0 = i * slot + (slot - bw) / 2;
              if (d.value === undefined) {
                return <Rect key={i} x={x0} y={top + plotH - 2} width={bw} height={2} fill={colors.border} />;
              }
              const met = d.value + (d.extra ?? 0) >= need - 15;
              return (
                <G key={i}>
                  <Rect x={x0} y={y(d.value)} width={bw} height={top + plotH - y(d.value)} rx={Math.min(4, bw / 2)} fill={met ? colors.accent : colors.warn} opacity={d.highlight ? 1 : 0.85} />
                  {d.extra ? <Rect x={x0} y={y(d.value + d.extra)} width={bw} height={y(d.value) - y(d.value + d.extra)} rx={2} fill={colors.rem} /> : null}
                </G>
              );
            })}
            <Line x1={0} x2={width} y1={y(need)} y2={y(need)} stroke={colors.good} strokeWidth={1.2} strokeDasharray="5,4" />
            <SvgText x={width - 2} y={y(need) - 4} fill={colors.good} fontSize={10} textAnchor="end">
              need {formatDuration(need)}
            </SvgText>
            {data.map((d, i) =>
              i % every === 0 ? (
                <SvgText key={`l${i}`} x={i * slot + slot / 2} y={height - 3} fill={colors.textFaint} fontSize={9} textAnchor="middle">
                  {d.label}
                </SvgText>
              ) : null,
            )}
          </Svg>
        );
      }}
    </ChartFrame>
  );
}

export function LineChart({
  values,
  labels,
  color = colors.accent,
  height = 140,
  format = (v: number) => String(Math.round(v)),
  band,
  reference,
  minY,
  maxY,
}: {
  values: (number | undefined)[];
  labels: string[];
  color?: string;
  height?: number;
  format?: (v: number) => string;
  band?: { lo: number; hi: number };
  reference?: { value: number; label: string };
  minY?: number;
  maxY?: number;
}) {
  const defined = values.filter((v): v is number => v !== undefined);
  if (defined.length < 2) return <Text style={font.small}>Not enough data yet.</Text>;
  const axisH = 16;
  const top = 12;
  const plotH = height - axisH - top;
  const extras = [band?.lo, band?.hi, reference?.value].filter((v): v is number => v !== undefined);
  let lo = minY ?? Math.min(...defined, ...extras);
  let hi = maxY ?? Math.max(...defined, ...extras);
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.1;
  lo -= minY === undefined ? pad : 0;
  hi += maxY === undefined ? pad : 0;
  return (
    <ChartFrame height={height}>
      {(width) => {
        const labelW = 30;
        const plotW = width - labelW;
        const x = (i: number) => labelW + (values.length === 1 ? plotW / 2 : (i / (values.length - 1)) * plotW);
        const y = (v: number) => top + plotH - ((v - lo) / (hi - lo)) * plotH;
        let d = '';
        let pen = false;
        values.forEach((v, i) => {
          if (v === undefined) {
            pen = false;
            return;
          }
          d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
          pen = true;
        });
        const every = Math.ceil(labels.length / 7);
        return (
          <Svg width={width} height={height}>
            {band ? <Rect x={labelW} y={y(band.hi)} width={plotW} height={Math.max(1, y(band.lo) - y(band.hi))} fill={color} opacity={0.1} /> : null}
            {reference ? (
              <G>
                <Line x1={labelW} x2={width} y1={y(reference.value)} y2={y(reference.value)} stroke={colors.good} strokeDasharray="4,4" />
                <SvgText x={width - 2} y={y(reference.value) - 4} fill={colors.good} fontSize={10} textAnchor="end">
                  {reference.label}
                </SvgText>
              </G>
            ) : null}
            {[lo + pad, (lo + hi) / 2, hi - pad].map((v, i) => (
              <SvgText key={i} x={0} y={y(v) + 4} fill={colors.textFaint} fontSize={9}>
                {format(v)}
              </SvgText>
            ))}
            <Path d={d} stroke={color} strokeWidth={2} fill="none" />
            {values.map((v, i) => (v === undefined ? null : <Circle key={i} cx={x(i)} cy={y(v)} r={values.length > 40 ? 1.5 : 2.5} fill={color} />))}
            {labels.map((l, i) =>
              i % every === 0 ? (
                <SvgText key={`l${i}`} x={x(i)} y={height - 3} fill={colors.textFaint} fontSize={9} textAnchor="middle">
                  {l}
                </SvgText>
              ) : null,
            )}
          </Svg>
        );
      }}
    </ChartFrame>
  );
}

/** Sleep timing per night on a 20:00 → 12:00 axis: shows consistency at a glance. */
export function SleepTimeline({ rows, height = 180 }: { rows: { label: string; onsetMin?: number; wakeMin?: number }[]; height?: number }) {
  const axisH = 16;
  const top = 8;
  const labelW = 34;
  const toY = (m: number) => ((m - 20 * 60 + 1440) % 1440) / (16 * 60); // 20:00 → 0, 12:00 → 1
  return (
    <ChartFrame height={height}>
      {(width) => {
        const plotH = height - axisH - top;
        const slot = (width - labelW) / rows.length;
        const bw = Math.max(3, slot * 0.55);
        const every = Math.ceil(rows.length / 10);
        return (
          <Svg width={width} height={height}>
            {[20, 0, 4, 8, 12].map((h) => {
              const yy = top + toY(h * 60) * plotH;
              return (
                <G key={h}>
                  <Line x1={labelW} x2={width} y1={yy} y2={yy} stroke={colors.border} strokeWidth={0.5} />
                  <SvgText x={0} y={yy + 4} fill={colors.textFaint} fontSize={9}>
                    {formatClock(h * 60)}
                  </SvgText>
                </G>
              );
            })}
            {rows.map((r, i) => {
              if (r.onsetMin === undefined || r.wakeMin === undefined) return null;
              const y1 = top + toY(r.onsetMin) * plotH;
              const y2 = top + toY(r.wakeMin) * plotH;
              if (y2 <= y1) return null;
              return <Rect key={i} x={labelW + i * slot + (slot - bw) / 2} y={y1} width={bw} height={y2 - y1} rx={Math.min(3, bw / 2)} fill={colors.light} />;
            })}
            {rows.map((r, i) =>
              i % every === 0 ? (
                <SvgText key={`l${i}`} x={labelW + i * slot + slot / 2} y={height - 3} fill={colors.textFaint} fontSize={9} textAnchor="middle">
                  {r.label}
                </SvgText>
              ) : null,
            )}
          </Svg>
        );
      }}
    </ChartFrame>
  );
}
