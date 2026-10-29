import { memo, ReactNode, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import type { AlertnessPoint } from '../engine/alertness';
import type { StageMinutes } from '../engine/sessions';
import { clamp, formatClock, formatDuration, formatTime, HOUR, minutesOfDay, MINUTE } from '../engine/time';
import type { StageSegment } from '../engine/types';
import { FillPath, PulseCircle, Reveal } from './motion';
import { ScrubSurface, ScrubTooltip, useScrub } from './scrub';
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

/** Vertical cursor line (and optional dot) drawn over a chart while it is scrubbed. */
function Cursor({ width, height, x, top = 0, bottom, dot, color = colors.text }: { width: number; height: number; x: number; top?: number; bottom: number; dot?: { y: number; color: string }; color?: string }) {
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <Svg width={width} height={height}>
        <Line x1={x} x2={x} y1={top} y2={bottom} stroke={color} strokeWidth={1.2} opacity={0.75} />
        {dot ? <Circle cx={x} cy={dot.y} r={5.5} fill={dot.color} stroke={colors.bg} strokeWidth={2} /> : null}
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Hypnogram
// ---------------------------------------------------------------------------

const ROWS: Record<string, number> = { awake: 0, outOfBed: 0, rem: 1, light: 2, asleep: 2, deep: 3 };
const HYP = { labelW: 44, axisH: 18 };

export function Hypnogram({ segments, start, end, height = 140 }: { segments: StageSegment[]; start: number; end: number; height?: number }) {
  return <ChartFrame height={height}>{(width) => <HypnogramBody segments={segments} start={start} end={end} height={height} width={width} />}</ChartFrame>;
}

const HypnogramLayer = memo(function HypnogramLayer({ segments, start, end, height, width }: { segments: StageSegment[]; start: number; end: number; height: number; width: number }) {
  const rowH = (height - HYP.axisH) / 4;
  const plotW = width - HYP.labelW;
  const x = (t: number) => HYP.labelW + ((t - start) / (end - start)) * plotW;
  return (
    <Svg width={width} height={height}>
      {['Awake', 'REM', 'Light', 'Deep'].map((l, i) => (
        <G key={l}>
          <SvgText x={0} y={i * rowH + rowH / 2 + 4} fill={colors.textFaint} fontSize={10}>
            {l}
          </SvgText>
          <Line x1={HYP.labelW} x2={width} y1={(i + 1) * rowH} y2={(i + 1) * rowH} stroke={colors.border} strokeWidth={0.5} />
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
});

function HypnogramBody({ segments, start, end, height, width }: { segments: StageSegment[]; start: number; end: number; height: number; width: number }) {
  const rowH = (height - HYP.axisH) / 4;
  const plotW = width - HYP.labelW;
  const tAt = (px: number) => start + clamp((px - HYP.labelW) / plotW, 0, 1) * (end - start);
  const { selection, panHandlers } = useScrub({
    indexAt: (px) => {
      if (segments.length === 0) return undefined;
      const t = tAt(px);
      const inside = segments.findIndex((s) => t >= s.start && t < s.end);
      if (inside >= 0) return inside;
      // In a gap: the nearest segment.
      let best = 0;
      segments.forEach((s, i) => {
        const d = Math.min(Math.abs(t - s.start), Math.abs(t - s.end));
        const b = segments[best];
        if (d < Math.min(Math.abs(t - b.start), Math.abs(t - b.end))) best = i;
      });
      return best;
    },
  });
  const seg = selection ? segments[selection.index] : undefined;
  const cx = selection ? clamp(selection.x, HYP.labelW, width) : 0;
  const row = seg ? (ROWS[seg.stage] ?? 2) : 0;
  return (
    <View style={{ width, height }}>
      <Reveal width={width} height={height}>
        <HypnogramLayer segments={segments} start={start} end={end} height={height} width={width} />
      </Reveal>
      {seg ? <Cursor width={width} height={height} x={cx} bottom={height - HYP.axisH} dot={{ y: row * rowH + rowH / 2, color: STAGE_COLOR[seg.stage] }} /> : null}
      <ScrubSurface panHandlers={panHandlers} label="Hypnogram" />
      {seg && selection ? (
        <ScrubTooltip
          x={cx}
          width={width}
          title={formatTime(tAt(selection.x))}
          value={STAGE_LABEL[seg.stage] ?? seg.stage}
          detail={`${formatTime(seg.start)}–${formatTime(seg.end)} · ${formatDuration((seg.end - seg.start) / MINUTE)}`}
          color={STAGE_COLOR[seg.stage]}
          bottom={row <= 1 ? HYP.axisH : undefined}
        />
      ) : null}
    </View>
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

// ---------------------------------------------------------------------------
// Energy curve
// ---------------------------------------------------------------------------

interface EnergyProps {
  points: AlertnessPoint[];
  now: number;
  dip?: { start: number; end: number; t: number };
  focusWindows?: { start: number; end: number }[];
  nap?: { start: number; end: number };
  height?: number;
}

const EN = { top: 10, axisH: 18 };

export function energyWord(e: number): string {
  if (e >= 75) return 'high';
  if (e >= 55) return 'good';
  if (e >= 40) return 'moderate';
  if (e >= 25) return 'low';
  return 'very low';
}

export function EnergyChart({ points, now, dip, focusWindows, nap, height = 170 }: EnergyProps) {
  if (points.length < 2) return null;
  return (
    <ChartFrame height={height}>
      {(width) => <EnergyBody points={points} now={now} dip={dip} focusWindows={focusWindows} nap={nap} height={height} width={width} />}
    </ChartFrame>
  );
}

const EnergyLayer = memo(function EnergyLayer({ points, now, dip, focusWindows, nap, height, width }: Required<Omit<EnergyProps, 'dip' | 'nap' | 'focusWindows'>> & Pick<EnergyProps, 'dip' | 'nap' | 'focusWindows'> & { width: number }) {
  const start = points[0].t;
  const end = points[points.length - 1].t;
  const plotH = height - EN.axisH - EN.top;
  const x = (t: number) => ((t - start) / (end - start)) * width;
  const y = (e: number) => EN.top + plotH - (e / 100) * plotH;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.energy).toFixed(1)}`).join(' ');
  const area = `${line} L${width},${EN.top + plotH} L0,${EN.top + plotH} Z`;
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
        <Rect key={`f${i}`} x={x(w.start)} y={EN.top} width={x(w.end) - x(w.start)} height={plotH} fill={colors.good} opacity={0.08} />
      ))}
      {dip ? <Rect x={x(dip.start)} y={EN.top} width={x(dip.end) - x(dip.start)} height={plotH} fill={colors.warn} opacity={0.1} /> : null}
      {nap ? <Rect x={x(nap.start)} y={EN.top} width={Math.max(3, x(nap.end) - x(nap.start))} height={plotH} fill={colors.accent} opacity={0.25} /> : null}
      {sleepRuns.map((r, i) => (
        <Rect key={`s${i}`} x={x(r.s)} y={EN.top} width={x(r.e) - x(r.s)} height={plotH} fill={colors.deep} opacity={0.25} />
      ))}
      {[25, 50, 75].map((v) => (
        <Line key={v} x1={0} x2={width} y1={y(v)} y2={y(v)} stroke={colors.border} strokeWidth={0.5} strokeDasharray="3,4" />
      ))}
      <Path d={area} fill="url(#eg)" />
      <Path d={line} stroke={colors.energy} strokeWidth={2.2} fill="none" />
      {showNow ? (
        <G>
          <Line x1={x(now)} x2={x(now)} y1={EN.top} y2={EN.top + plotH} stroke={colors.text} strokeWidth={1} strokeDasharray="2,3" />
          <PulseCircle cx={x(nowP.t)} cy={y(nowP.energy)} r={5} color={colors.energy} />
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
});

function EnergyBody(props: Required<Omit<EnergyProps, 'dip' | 'nap' | 'focusWindows'>> & Pick<EnergyProps, 'dip' | 'nap' | 'focusWindows'> & { width: number }) {
  const { points, height, width, dip, nap, focusWindows } = props;
  const start = points[0].t;
  const end = points[points.length - 1].t;
  const plotH = height - EN.axisH - EN.top;
  const x = (t: number) => ((t - start) / (end - start)) * width;
  const y = (e: number) => EN.top + plotH - (e / 100) * plotH;
  const { selection, panHandlers } = useScrub({
    indexAt: (px) => Math.round(clamp(px / width, 0, 1) * (points.length - 1)),
    // A tick every 15 minutes of the curve rather than every 5-minute point.
    tickKey: (i) => Math.floor(points[i].t / (15 * MINUTE)),
  });
  const p = selection ? points[selection.index] : undefined;
  const within = (w?: { start: number; end: number }) => !!w && !!p && p.t >= w.start && p.t <= w.end;
  const detail = !p
    ? undefined
    : p.asleep
      ? 'sleep'
      : within(nap)
        ? 'planned nap'
        : within(dip)
          ? 'afternoon dip'
          : (focusWindows ?? []).some((w) => within(w))
            ? 'peak focus window'
            : `${energyWord(p.energy)} energy`;
  return (
    <View style={{ width, height }}>
      <Reveal width={width} height={height}>
        <EnergyLayer {...props} />
      </Reveal>
      {p ? <Cursor width={width} height={height} x={x(p.t)} top={EN.top} bottom={EN.top + plotH} dot={p.asleep ? undefined : { y: y(p.energy), color: colors.energy }} /> : null}
      <ScrubSurface panHandlers={panHandlers} label="Energy curve" />
      {p ? (
        <ScrubTooltip
          x={x(p.t)}
          width={width}
          title={formatTime(p.t)}
          value={p.asleep ? 'Asleep' : `Energy ${Math.round(p.energy)}`}
          detail={detail}
          color={p.asleep ? colors.light : colors.energy}
          bottom={!p.asleep && y(p.energy) < 62 ? EN.axisH + 2 : undefined}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Duration bars
// ---------------------------------------------------------------------------

export interface BarDatum {
  label: string;
  value?: number;
  extra?: number;
  highlight?: boolean;
  /** Longer label for the scrub tooltip (e.g. "Tue 27 Oct"); defaults to `label`. */
  title?: string;
}

const BARS = { axisH: 16, top: 14 };

/** Sleep duration bars (main + nap stacked) against a sleep-need reference line. */
export function DurationBars({ data, need, height = 160, onPressBar }: { data: BarDatum[]; need: number; height?: number; onPressBar?: (index: number) => void }) {
  return <ChartFrame height={height}>{(width) => <BarsBody data={data} need={need} height={height} width={width} onPressBar={onPressBar} />}</ChartFrame>;
}

const BarsLayer = memo(function BarsLayer({ data, need, height, width, selected }: { data: BarDatum[]; need: number; height: number; width: number; selected?: number }) {
  const plotH = height - BARS.axisH - BARS.top;
  const max = Math.max(need * 1.25, ...data.map((d) => (d.value ?? 0) + (d.extra ?? 0)));
  const slot = width / data.length;
  const bw = Math.max(3, slot * 0.62);
  const y = (v: number) => BARS.top + plotH - (v / max) * plotH;
  const every = Math.ceil(data.length / 10);
  return (
    <Svg width={width} height={height}>
      {selected !== undefined ? <Rect x={selected * slot} y={0} width={slot} height={BARS.top + plotH} rx={Math.min(6, slot / 3)} fill={colors.accentSoft} opacity={0.7} /> : null}
      {data.map((d, i) => {
        const x0 = i * slot + (slot - bw) / 2;
        if (d.value === undefined) {
          return <Rect key={i} x={x0} y={BARS.top + plotH - 2} width={bw} height={2} fill={colors.border} />;
        }
        const met = d.value + (d.extra ?? 0) >= need - 15;
        const dim = selected !== undefined && selected !== i;
        return (
          <G key={i} opacity={dim ? 0.55 : 1}>
            <Rect x={x0} y={y(d.value)} width={bw} height={BARS.top + plotH - y(d.value)} rx={Math.min(4, bw / 2)} fill={met ? colors.accent : colors.warn} opacity={d.highlight ? 1 : 0.85} />
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
          <SvgText key={`l${i}`} x={i * slot + slot / 2} y={height - 3} fill={selected === i ? colors.text : colors.textFaint} fontSize={9} textAnchor="middle">
            {d.label}
          </SvgText>
        ) : null,
      )}
    </Svg>
  );
});

function BarsBody({ data, need, height, width, onPressBar }: { data: BarDatum[]; need: number; height: number; width: number; onPressBar?: (index: number) => void }) {
  const slot = width / data.length;
  const { selection, panHandlers } = useScrub({
    indexAt: (px) => (data.length ? clamp(Math.floor(px / slot), 0, data.length - 1) : undefined),
    onTap: onPressBar
      ? (i) => {
          if (data[i]?.value === undefined) return false;
          onPressBar(i);
        }
      : undefined,
  });
  const d = selection ? data[selection.index] : undefined;
  const total = d?.value !== undefined ? d.value + (d.extra ?? 0) : undefined;
  return (
    <View style={{ width, height }}>
      <Reveal width={width} height={height}>
        <BarsLayer data={data} need={need} height={height} width={width} selected={selection?.index} />
      </Reveal>
      <ScrubSurface panHandlers={panHandlers} label="Sleep per night" />
      {d && selection ? (
        <ScrubTooltip
          x={selection.index * slot + slot / 2}
          width={width}
          title={d.title ?? d.label}
          value={total !== undefined ? formatDuration(total) : 'No data'}
          detail={
            total === undefined
              ? undefined
              : [d.extra ? `incl. ${formatDuration(d.extra)} nap` : `${total >= need - 15 ? 'met' : `${formatDuration(need - total)} short of`} need`, onPressBar ? 'tap to open' : '']
                  .filter(Boolean)
                  .join(' · ')
          }
          color={total === undefined ? colors.textDim : total >= need - 15 ? colors.accent : colors.warn}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Line chart
// ---------------------------------------------------------------------------

interface LineProps {
  values: (number | undefined)[];
  labels: string[];
  color?: string;
  height?: number;
  format?: (v: number) => string;
  band?: { lo: number; hi: number };
  reference?: { value: number; label: string };
  minY?: number;
  maxY?: number;
  /** Longer labels for the scrub tooltip; default `labels`. */
  tooltipLabels?: string[];
  /** Value format for the scrub tooltip; default `format`. */
  tooltipFormat?: (v: number) => string;
}

const LINE = { axisH: 16, top: 12, labelW: 30 };

const roundFormat = (v: number) => String(Math.round(v));

export function LineChart({ height = 140, color = colors.accent, format = roundFormat, ...rest }: LineProps) {
  const defined = rest.values.filter((v): v is number => v !== undefined);
  if (defined.length < 2) return <Text style={font.small}>Not enough data yet.</Text>;
  return <ChartFrame height={height}>{(width) => <LineBody {...rest} height={height} color={color} format={format} width={width} />}</ChartFrame>;
}

function lineScale({ values, band, reference, minY, maxY, height }: LineProps & { height: number }) {
  const defined = values.filter((v): v is number => v !== undefined);
  const plotH = height - LINE.axisH - LINE.top;
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
  return { lo, hi, pad, y: (v: number) => LINE.top + plotH - ((v - lo) / (hi - lo)) * plotH };
}

type LineBodyProps = LineProps & { height: number; color: string; format: (v: number) => string; width: number };

const LineLayer = memo(function LineLayer(props: LineBodyProps) {
  const { values, labels, color, height, format, band, reference, width } = props;
  const { lo, hi, pad, y } = lineScale(props);
  const plotW = width - LINE.labelW;
  const x = (i: number) => LINE.labelW + (values.length === 1 ? plotW / 2 : (i / (values.length - 1)) * plotW);
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
      {band ? <Rect x={LINE.labelW} y={y(band.hi)} width={plotW} height={Math.max(1, y(band.lo) - y(band.hi))} fill={color} opacity={0.1} /> : null}
      {reference ? (
        <G>
          <Line x1={LINE.labelW} x2={width} y1={y(reference.value)} y2={y(reference.value)} stroke={colors.good} strokeDasharray="4,4" />
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
});

function LineBody(props: LineBodyProps) {
  const { values, labels, color, height, format, width, tooltipLabels, tooltipFormat } = props;
  const { y } = lineScale(props);
  const plotW = width - LINE.labelW;
  const n = values.length;
  const x = (i: number) => LINE.labelW + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const { selection, panHandlers } = useScrub({
    indexAt: (px) => (n ? Math.round(clamp((px - LINE.labelW) / plotW, 0, 1) * (n - 1)) : undefined),
  });
  const i = selection?.index;
  const v = i !== undefined ? values[i] : undefined;
  const plotBottom = height - LINE.axisH;
  return (
    <View style={{ width, height }}>
      <Reveal width={width} height={height}>
        <LineLayer {...props} />
      </Reveal>
      {i !== undefined ? <Cursor width={width} height={height} x={x(i)} top={LINE.top / 2} bottom={plotBottom} dot={v !== undefined ? { y: y(v), color } : undefined} /> : null}
      <ScrubSurface panHandlers={panHandlers} label="Trend chart" />
      {i !== undefined ? (
        <ScrubTooltip
          x={x(i)}
          width={width}
          title={tooltipLabels?.[i] ?? labels[i] ?? ''}
          value={v !== undefined ? (tooltipFormat ?? format)(v) : 'No data'}
          color={v !== undefined ? color : colors.textDim}
          bottom={v !== undefined && y(v) < 56 ? LINE.axisH + 2 : undefined}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sleep timeline
// ---------------------------------------------------------------------------

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
          <Reveal width={width} height={height}>
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
          </Reveal>
        );
      }}
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Arc gauge
// ---------------------------------------------------------------------------

/** A half-circle gauge filled to `value` (0–1), with an optional tick at `marker` (0–1). */
export function ArcGauge({
  value,
  marker,
  size = 200,
  stroke = 14,
  color = colors.accent,
  markerColor = colors.text,
  children,
}: {
  value: number;
  marker?: number;
  size?: number;
  stroke?: number;
  color?: string;
  markerColor?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const height = cy + stroke / 2 + 2;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const length = Math.PI * r;
  const m = marker !== undefined ? clamp(marker, 0, 1) : undefined;
  const angle = m !== undefined ? Math.PI + Math.PI * m : 0;
  return (
    <View style={{ width: size, height, alignItems: 'center', justifyContent: 'flex-end' }}>
      <Svg width={size} height={height} style={StyleSheet.absoluteFill}>
        <Path d={arc} stroke={colors.border} strokeWidth={stroke} fill="none" strokeLinecap="round" />
        <FillPath d={arc} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" fraction={clamp(value, 0, 1)} length={length} />
        {m !== undefined ? (
          <Line
            x1={cx + (r - stroke / 2 - 3) * Math.cos(angle)}
            y1={cy + (r - stroke / 2 - 3) * Math.sin(angle)}
            x2={cx + (r + stroke / 2 + 3) * Math.cos(angle)}
            y2={cy + (r + stroke / 2 + 3) * Math.sin(angle)}
            stroke={markerColor}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}
