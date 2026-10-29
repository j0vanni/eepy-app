import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { trendRows } from '@/engine/analysis';
import { CHRONOTYPE_LABELS } from '@/engine/chronotype';
import { mean } from '@/engine/stats';
import { formatClock, formatDuration } from '@/engine/time';
import { selectDataset, useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { DurationBars, LineChart, SleepTimeline } from '@/ui/charts';
import { Button, Card, CardTitle, Empty, Row, Screen, Section, Segmented, Stat } from '@/ui/components';
import { dayLabel, shortDate, weekdayInitial } from '@/ui/format';
import { colors, font, scoreColor, space } from '@/ui/theme';

export default function TrendsScreen() {
  const a = useAnalysis();
  const data = useStore(useShallow(selectDataset));
  const [days, setDays] = useState(14);
  const rows = useMemo(() => (a ? trendRows(a, data, days) : []), [a, data, days]);

  if (!a) {
    return (
      <Screen title="Trends">
        <Empty icon="chart-timeline-variant" title="No trends yet" body="Trends appear after a few nights of data." />
      </Screen>
    );
  }

  const label = (d: string) => (days <= 14 ? weekdayInitial(d) : shortDate(d));
  const tips = rows.map((r) => dayLabel(r.date));
  const openNight = (i: number) => {
    const id = a.nights.find((n) => n.wakeDate === rows[i]?.date)?.main?.id;
    if (id) router.push({ pathname: '/night/[id]', params: { id } });
  };
  const withSleep = rows.filter((r) => r.sleepMin !== undefined);
  const avgSleep = withSleep.length ? mean(withSleep.map((r) => r.sleepMin!)) : undefined;
  const scored = rows.filter((r) => r.score !== undefined);
  const avgScore = scored.length ? Math.round(mean(scored.map((r) => r.score!))) : undefined;
  const chrono = a.chronotype;
  const hrvBase = a.readiness?.hrvBaseline;

  return (
    <Screen title="Trends" subtitle={`${withSleep.length} of ${days} nights recorded`}>
      <Segmented
        value={days}
        onChange={setDays}
        options={[
          { label: '7d', value: 7 },
          { label: '14d', value: 14 },
          { label: '30d', value: 30 },
          { label: '60d', value: 60 },
        ]}
      />

      <Card style={{ marginTop: space.md }}>
        <Row>
          <Stat label="Avg sleep" value={avgSleep ? formatDuration(avgSleep) : '–'} sub={`need ${formatDuration(a.need.needMin)}`} />
          <Stat label="Avg score" value={avgScore ? String(avgScore) : '–'} color={avgScore ? scoreColor(avgScore) : undefined} />
          <Stat label="Debt now" value={formatDuration(a.debt.debtMin)} />
        </Row>
      </Card>

      <Section title="Sleep vs. need">
        <Card>
          <DurationBars
            need={a.need.needMin}
            data={rows.map((r, i) => ({ label: label(r.date), title: tips[i], value: r.sleepMin !== undefined ? r.sleepMin - r.napMin : undefined, extra: r.napMin || undefined }))}
            onPressBar={openNight}
          />
          <Text style={[font.tiny, { marginTop: 6 }]}>Purple = met your need · amber = short · blue cap = naps · drag to compare, tap a night to open it</Text>
        </Card>
      </Section>

      <Section title="Sleep debt">
        <Card>
          <LineChart
            values={rows.map((r) => r.debtMin / 60)}
            labels={rows.map((r) => label(r.date))}
            tooltipLabels={tips}
            color={colors.warn}
            minY={0}
            format={(v) => `${v.toFixed(0)}h`}
            tooltipFormat={(v) => formatDuration(v * 60)}
          />
          <Text style={[font.small, { marginTop: space.sm }]}>
            Rolling 14-night debt, recent nights weighted more. Under 2h is low; above 5h measurably dulls reaction time and mood.
          </Text>
        </Card>
      </Section>

      <Section title="Sleep score">
        <Card>
          <LineChart values={rows.map((r) => r.score)} labels={rows.map((r) => label(r.date))} tooltipLabels={tips} tooltipFormat={(v) => `Score ${Math.round(v)}`} color={colors.accent} minY={30} maxY={100} />
        </Card>
      </Section>

      <Section title="Timing & consistency">
        <Card>
          <SleepTimeline rows={rows.map((r) => ({ label: label(r.date), onsetMin: r.onsetMin, wakeMin: r.wakeMin }))} />
          <Row style={{ marginTop: space.md }}>
            <Stat label="Regularity" value={a.regularity.sri !== undefined ? String(Math.round(a.regularity.sri)) : '–'} sub={a.regularity.label} />
            <Stat
              label="Bedtime spread"
              value={chrono.habitual?.onsetSdMin !== undefined ? `±${Math.round(chrono.habitual.onsetSdMin)}m` : '–'}
              sub={chrono.habitual ? `avg ${formatClock(chrono.habitual.onsetMin)}` : undefined}
            />
            <Stat
              label="Wake spread"
              value={chrono.habitual?.wakeSdMin !== undefined ? `±${Math.round(chrono.habitual.wakeSdMin)}m` : '–'}
              sub={chrono.habitual ? `avg ${formatClock(chrono.habitual.wakeMin)}` : undefined}
            />
          </Row>
          <Text style={[font.tiny, { marginTop: space.sm }]}>
            Regularity is the Sleep Regularity Index (0–100): the chance you're in the same state (asleep/awake) at the same time on consecutive days.
          </Text>
        </Card>
      </Section>

      <Section title="Chronotype">
        <Card>
          <CardTitle icon="owl" title={chrono.category ? CHRONOTYPE_LABELS[chrono.category].label : 'Not enough data yet'} />
          {chrono.category ? <Text style={font.small}>{CHRONOTYPE_LABELS[chrono.category].description}</Text> : null}
          <Row style={{ marginTop: space.md }}>
            <Stat label="Mid-sleep (free days)" value={chrono.msfScMin !== undefined ? formatClock(chrono.msfScMin) : '–'} sub="corrected for oversleep" />
            <Stat label="Social jet lag" value={chrono.socialJetlagMin !== undefined ? formatDuration(chrono.socialJetlagMin) : '–'} />
          </Row>
          <Text style={[font.tiny, { marginTop: space.sm }]}>
            Based on {chrono.nWork} workday and {chrono.nFree} free-day nights{chrono.quizScore !== undefined ? ` · quiz score ${chrono.quizScore}` : ''}.
          </Text>
          <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
            <Button small kind="secondary" label={chrono.quizScore !== undefined ? 'Retake chronotype quiz' : 'Take the chronotype quiz'} onPress={() => router.push({ pathname: '/quiz/[id]', params: { id: 'rmeq' } })} />
          </View>
        </Card>
      </Section>

      <Section title="Sleep stages">
        <Card>
          <Text style={[font.small, { marginBottom: 4 }]}>Deep sleep %</Text>
          <LineChart values={rows.map((r) => (r.deepPct !== undefined ? r.deepPct * 100 : undefined))} labels={rows.map((r) => label(r.date))} tooltipLabels={tips} color={colors.deep} height={110} format={(v) => `${Math.round(v)}%`} tooltipFormat={(v) => `${Math.round(v)}% deep`} />
          <Text style={[font.small, { marginVertical: 4 }]}>REM sleep %</Text>
          <LineChart values={rows.map((r) => (r.remPct !== undefined ? r.remPct * 100 : undefined))} labels={rows.map((r) => label(r.date))} tooltipLabels={tips} color={colors.rem} height={110} format={(v) => `${Math.round(v)}%`} tooltipFormat={(v) => `${Math.round(v)}% REM`} />
          <Text style={[font.tiny, { marginTop: 6 }]}>Wrist-based staging is an estimate — trends matter more than single nights.</Text>
        </Card>
      </Section>

      <Section title="Recovery">
        <Card>
          <Text style={[font.small, { marginBottom: 4 }]}>HRV (RMSSD, ms)</Text>
          <LineChart
            values={rows.map((r) => r.hrv)}
            labels={rows.map((r) => label(r.date))}
            tooltipLabels={tips}
            tooltipFormat={(v) => `${Math.round(v)} ms`}
            color={colors.good}
            height={120}
            band={hrvBase ? { lo: Math.exp(hrvBase.mean - hrvBase.sd), hi: Math.exp(hrvBase.mean + hrvBase.sd) } : undefined}
          />
          <Text style={[font.small, { marginVertical: 4 }]}>Lowest sleeping heart rate (bpm)</Text>
          <LineChart values={rows.map((r) => r.hrMin)} labels={rows.map((r) => label(r.date))} tooltipLabels={tips} tooltipFormat={(v) => `${Math.round(v)} bpm`} color={colors.bad} height={120} />
          <Text style={[font.tiny, { marginTop: 6 }]}>Shaded band = your normal HRV range (30-day baseline ± 1 SD).</Text>
        </Card>
      </Section>

      <Section title="Insights" action={<Button small kind="ghost" label="How need is estimated" onPress={() => router.push('/need')} />}>
        {a.insights.length === 0 ? (
          <Card>
            <Text style={font.small}>Tag your days in the Journal (alcohol, late meals, exercise…) and eepy will find what helps or hurts your sleep.</Text>
          </Card>
        ) : (
          a.insights.map((i) => (
            <Card key={i.id} accent={i.kind === 'negative' ? colors.warn : i.kind === 'positive' ? colors.good : undefined}>
              <Text style={font.h3}>{i.title}</Text>
              <Text style={[font.small, { marginTop: 4 }]}>{i.detail}</Text>
              {i.evidence ? <Text style={[font.tiny, { marginTop: 6 }]}>{i.evidence}</Text> : null}
            </Card>
          ))
        )}
      </Section>
    </Screen>
  );
}
