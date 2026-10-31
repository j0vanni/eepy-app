/** Breathing check cards (breathing.ts): one night on the night screen, the 30-night trend on Trends. */
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { BREATHING_DISCLAIMER, BREATHING_RULES, BreathingLevel, BreathingNight, BreathingTrend, confidenceLabel } from '@/engine/breathing';
import type { ScreeningResult } from '@/engine/types';
import { formatDuration, formatTime, MINUTE } from '@/engine/time';
import { LineChart } from '@/ui/charts';
import { Button, Card, CardTitle, Row, Stat } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

export function levelColor(level: BreathingLevel): string {
  return { normal: colors.good, some: colors.info, frequent: colors.warn, unknown: colors.textDim }[level];
}

const rate = (x?: number) => (x === undefined ? '–' : `${x < 10 ? x.toFixed(1) : Math.round(x)}/h`);

function StopBangButton({ result }: { result?: ScreeningResult }) {
  return (
    <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
      <Button
        small
        kind="secondary"
        icon="clipboard-pulse-outline"
        label={result ? `Retake the STOP-Bang check (last ${result.score}/8)` : 'Take the STOP-Bang check'}
        onPress={() => router.push({ pathname: '/quiz/[id]', params: { id: 'stopbang' } })}
      />
    </View>
  );
}

/** One night: indices, the overnight curve (lowest reading per 5 min) and how much to trust it. */
export function BreathingNightCard({ night, curve, start, stopBang }: { night: BreathingNight; curve?: [number, number][]; start: number; stopBang?: ScreeningResult }) {
  const s = night.summary;
  const dense = night.confidence === 'medium' || night.confidence === 'high';
  // A full 5-minute grid so gaps (strap loose, awake) show as breaks rather than being squeezed out.
  const grid: { t: number; v?: number }[] = [];
  if (curve && curve.length > 3) {
    const step = BREATHING_RULES.curveBinMin;
    const byOffset = new Map(curve.map(([o, v]) => [o, v]));
    for (let o = curve[0][0]; o <= curve[curve.length - 1][0]; o += step) grid.push({ t: start + o * MINUTE, v: byOffset.get(o) });
  }
  return (
    <Card accent={night.level === 'frequent' ? colors.warn : undefined}>
      <CardTitle icon="lungs" title={`Breathing · ${night.title}`} color={levelColor(night.level)} />
      {dense ? (
        <Row>
          <Stat label="Dips ≥3%" value={rate(night.odi3)} sub={`≥4%: ${rate(night.odi4)}`} />
          <Stat label="Lowest" value={s.lowest !== undefined ? `${s.lowest}%` : '–'} sub={s.avg !== undefined ? `avg ${s.avg}%` : undefined} />
          <Stat label="Below 90%" value={night.below90Min !== undefined ? formatDuration(night.below90Min) : '–'} />
        </Row>
      ) : (
        <Row>
          <Stat label="Readings" value={String(s.n)} sub={`≈${Math.round(night.readingsPerHour)}/h`} />
          <Stat label="Lowest" value={s.lowest !== undefined ? `${s.lowest}%` : '–'} sub={s.avg !== undefined ? `avg ${s.avg}%` : undefined} />
        </Row>
      )}
      {grid.length > 3 ? (
        <View style={{ marginTop: space.md }}>
          <Text style={[font.small, { marginBottom: 4 }]}>Lowest SpO₂ per 5 minutes</Text>
          <LineChart
            values={grid.map((g) => g.v)}
            labels={grid.map((g) => formatTime(g.t))}
            reference={{ value: 90, label: '90%' }}
            color={colors.info}
            height={120}
            format={(v) => `${Math.round(v)}%`}
            tooltipFormat={(v) => `${v}%`}
          />
        </View>
      ) : null}
      <Text style={[font.small, { marginTop: space.sm }]}>{night.detail}</Text>
      <Text style={[font.tiny, { marginTop: space.sm }]}>
        {s.n} readings · about {Math.round(night.readingsPerHour)} an hour
        {night.readingsPerHour >= BREATHING_RULES.denseReadingsPerHour || night.gappy ? ` · ${Math.round(night.coverage * 100)}% of sleep covered` : ''} · confidence{' '}
        {confidenceLabel(night.confidence)}
        {s.glitches ? ` · ${s.glitches} glitch reading${s.glitches === 1 ? '' : 's'} ignored` : ''}
      </Text>
      <Text style={[font.tiny, { marginTop: 4 }]}>{BREATHING_DISCLAIMER}</Text>
      {night.level === 'some' || night.level === 'frequent' ? <StopBangButton result={stopBang} /> : null}
    </Card>
  );
}

/** 30-night trend: median dips, nights checked and a per-night dips chart for the selected range. */
export function BreathingTrendCard({
  trend,
  values,
  labels,
  tooltipLabels,
  stopBang,
}: {
  trend: BreathingTrend;
  values: (number | undefined)[];
  labels: string[];
  tooltipLabels: string[];
  stopBang?: ScreeningResult;
}) {
  const hasData = trend.nights.length > 0;
  return (
    <Card accent={trend.level === 'frequent' ? colors.warn : undefined}>
      <CardTitle icon="lungs" title={`Breathing · ${trend.title}`} color={levelColor(trend.level)} />
      {hasData ? (
        <Row>
          <Stat label="Dips ≥3%" value={rate(trend.medianOdi3)} sub={trend.medianOdi4 !== undefined ? `≥4%: ${rate(trend.medianOdi4)}` : 'median'} />
          <Stat label="Lowest" value={trend.medianLowest !== undefined ? `${trend.medianLowest}%` : '–'} sub="typical night" />
          <Stat label="Nights" value={String(trend.analysable)} sub={`checked of ${trend.nightsInWindow}`} />
        </Row>
      ) : null}
      {values.filter((v) => v !== undefined).length >= 2 ? (
        <View style={{ marginTop: space.md }}>
          <Text style={[font.small, { marginBottom: 4 }]}>Oxygen dips ≥3% per hour</Text>
          <LineChart
            values={values}
            labels={labels}
            tooltipLabels={tooltipLabels}
            tooltipFormat={(v) => `${v.toFixed(1)} dips/h`}
            color={colors.info}
            height={110}
            minY={0}
            reference={{ value: BREATHING_RULES.someOdi3, label: '5/h' }}
            format={(v) => v.toFixed(0)}
          />
        </View>
      ) : null}
      <Text style={[font.small, { marginTop: space.sm }]}>{trend.detail}</Text>
      <Text style={[font.tiny, { marginTop: space.sm }]}>
        Last {trend.days} days · dips are counted only on nights with at least one reading every 5 minutes. {BREATHING_DISCLAIMER}
      </Text>
      {hasData ? <StopBangButton result={stopBang} /> : null}
    </Card>
  );
}
