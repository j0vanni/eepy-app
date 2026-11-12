/**
 * Breathing check (engine/breathing.ts): oxygen dips in one night (the night screen) and over the
 * last 30 nights (Sleep → Trends). Each panel says the verdict first, then the numbers and the
 * curve; how far to trust a wrist sensor is folded away under them.
 */
import { router } from 'expo-router';
import { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { BREATHING_DISCLAIMER, BREATHING_RULES, BreathingLevel, BreathingNight, BreathingTrend, confidenceLabel } from '@/engine/breathing';
import type { ScreeningResult } from '@/engine/types';
import { formatDuration, formatTime, MINUTE } from '@/engine/time';
import { LineChart } from '@/ui/charts';
import { Card, CardTitle, Divider, Fold, ListRow, Row, Stat } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

export function levelColor(level: BreathingLevel): string {
  return { normal: colors.good, some: colors.info, frequent: colors.warn, unknown: colors.textDim }[level];
}

const rate = (x?: number) => (x === undefined ? '–' : `${x < 10 ? x.toFixed(1) : Math.round(x)}/h`);

function ChartCaption({ children }: { children: string }) {
  return <Text style={[font.small, { marginTop: space.md, marginBottom: space.xs }]}>{children}</Text>;
}

/** The rows that close a breathing panel: the fine print (folded) and, when it is worth it, the risk questionnaire. */
function Footer({ trust, children, stopBang, offerCheck }: { trust: string; children: ReactNode; stopBang?: ScreeningResult; offerCheck: boolean }) {
  return (
    <View style={{ marginTop: space.md, marginBottom: -space.md }}>
      <Divider spacing={0} />
      <Fold bare title="How far to trust this" value={trust}>
        {children}
        <Text style={[font.tiny, { marginTop: space.sm }]}>{BREATHING_DISCLAIMER}</Text>
      </Fold>
      {offerCheck ? (
        <>
          <Divider spacing={0} />
          {/* STOP-Bang: eight questions about sleep-apnoea risk. */}
          <ListRow
            title={stopBang ? 'Retake the apnoea risk check' : 'Take the apnoea risk check'}
            sub={`8 questions (STOP-Bang)${stopBang ? ` · last time ${stopBang.score} of 8` : ''}`}
            onPress={() => router.push({ pathname: '/quiz/[id]', params: { id: 'stopbang' } })}
          />
        </>
      ) : null}
    </View>
  );
}

/** One night: the verdict, dips per hour, the overnight curve (lowest reading per 5 min) and how much to trust it. */
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
  const lowest = <Stat label="Lowest oxygen" value={s.lowest !== undefined ? `${s.lowest}%` : '–'} sub={s.avg !== undefined ? `average ${s.avg}%` : undefined} />;
  return (
    <Card accent={night.level === 'frequent' ? colors.warn : undefined}>
      <CardTitle icon="lungs" title={night.title} color={levelColor(night.level)} />
      {dense ? (
        <Row>
          <Stat label="Dips of 3%+" value={rate(night.odi3)} sub={`4%+: ${rate(night.odi4)}`} />
          {lowest}
          <Stat label="Below 90%" value={night.below90Min !== undefined ? formatDuration(night.below90Min) : '–'} />
        </Row>
      ) : (
        <Row>
          <Stat label="Readings" value={String(s.n)} sub={`about ${Math.round(night.readingsPerHour)} an hour`} />
          {lowest}
        </Row>
      )}
      {grid.length > 3 ? (
        <View>
          <ChartCaption>Lowest oxygen every 5 minutes</ChartCaption>
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
      <Text style={[font.small, { marginTop: space.md }]}>{night.detail}</Text>
      <Footer trust={`Confidence ${confidenceLabel(night.confidence)}`} stopBang={stopBang} offerCheck={night.level === 'some' || night.level === 'frequent'}>
        <Text style={font.small}>
          {s.n} readings · about {Math.round(night.readingsPerHour)} an hour
          {night.readingsPerHour >= BREATHING_RULES.denseReadingsPerHour || night.gappy ? ` · ${Math.round(night.coverage * 100)}% of sleep covered` : ''} · confidence{' '}
          {confidenceLabel(night.confidence)}
          {s.glitches ? ` · ${s.glitches} glitch reading${s.glitches === 1 ? '' : 's'} ignored` : ''}
        </Text>
      </Footer>
    </Card>
  );
}

/** 30 nights: the verdict, the typical night, nights checked and dips per night for the selected range. */
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
      <CardTitle icon="lungs" title={trend.title} color={levelColor(trend.level)} />
      {hasData ? (
        <Row>
          <Stat label="Dips of 3%+" value={rate(trend.medianOdi3)} sub={trend.medianOdi4 !== undefined ? `4%+: ${rate(trend.medianOdi4)}` : 'typical night'} />
          <Stat label="Lowest oxygen" value={trend.medianLowest !== undefined ? `${trend.medianLowest}%` : '–'} sub="typical night" />
          <Stat label="Nights" value={String(trend.analysable)} sub={`checked of ${trend.nightsInWindow}`} />
        </Row>
      ) : null}
      {values.filter((v) => v !== undefined).length >= 2 ? (
        <View>
          <ChartCaption>Oxygen dips of 3% or more, per hour</ChartCaption>
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
      <Text style={[font.small, { marginTop: hasData ? space.md : 0 }]}>{trend.detail}</Text>
      <Footer trust={`Last ${trend.days} days`} stopBang={stopBang} offerCheck={hasData}>
        <Text style={font.small}>Dips are counted only on nights with at least one reading every 5 minutes.</Text>
      </Footer>
    </Card>
  );
}
