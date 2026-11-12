/**
 * Sleep tab → Trends: the charts that answer "is it getting better?" (hours against need, debt,
 * score, bed and wake times), the rarer ones folded under them, the 30-night breathing check, and
 * what eepy has found affects your sleep.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import type { Analysis } from '@/engine/analysis';
import { trendRows } from '@/engine/analysis';
import { CHRONOTYPE_LABELS } from '@/engine/chronotype';
import { mean } from '@/engine/stats';
import { formatClock, formatDuration } from '@/engine/time';
import { selectDataset, useStore } from '@/state/store';
import { BreathingTrendCard } from '@/ui/cards/BreathingCard';
import { DurationBars, LineChart, SleepTimeline } from '@/ui/charts';
import { Card, Chip, Fold, KeyValue, ListCard, ListRow, Row, Section, Stat } from '@/ui/components';
import { dayLabel, shortDate, weekdayInitial } from '@/ui/format';
import { InsightRow } from '@/ui/InsightCard';
import { colors, font, scoreColor, space } from '@/ui/theme';

const RANGES = [7, 14, 30, 60];

function ChartCaption({ children, first }: { children: string; first?: boolean }) {
  return <Text style={[font.small, { marginTop: first ? 0 : space.md, marginBottom: space.xs }]}>{children}</Text>;
}

export function TrendsView({ a }: { a: Analysis }) {
  const data = useStore(useShallow(selectDataset));
  const [days, setDays] = useState(14);
  const rows = useMemo(() => trendRows(a, data, days), [a, data, days]);

  const label = (d: string) => (days <= 14 ? weekdayInitial(d) : shortDate(d));
  const labels = rows.map((r) => label(r.date));
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
  const habit = chrono.habitual;
  const hrvBase = a.readiness?.hrvBaseline;

  return (
    <>
      {/* A filter, so it looks lighter than the Nights / Trends switch above it. */}
      <Row gap={space.sm} style={{ flexWrap: 'wrap', marginBottom: space.md }}>
        {RANGES.map((d) => (
          <Chip key={d} label={`${d} days`} selected={days === d} onPress={() => setDays(d)} />
        ))}
      </Row>

      <Card>
        <Row>
          <Stat label="Average sleep" value={avgSleep ? formatDuration(avgSleep) : '–'} sub={`need ${formatDuration(a.need.needMin)}`} />
          <Stat label="Average score" value={avgScore ? String(avgScore) : '–'} color={avgScore ? scoreColor(avgScore) : undefined} />
          <Stat label="Nights" value={String(withSleep.length)} sub={`of ${days}`} />
        </Row>
        <View style={{ marginTop: space.lg }}>
          <DurationBars
            need={a.need.needMin}
            data={rows.map((r, i) => ({ label: labels[i], title: tips[i], value: r.sleepMin !== undefined ? r.sleepMin - r.napMin : undefined, extra: r.napMin || undefined }))}
            onPressBar={openNight}
          />
        </View>
        <Text style={[font.tiny, { marginTop: space.sm }]}>The dashed line is your sleep need. Orange nights were short; a blue cap is naps. Drag to compare, tap a night to open it.</Text>
      </Card>

      <Section title="Sleep debt">
        <Card>
          <LineChart
            values={rows.map((r) => r.debtMin / 60)}
            labels={labels}
            tooltipLabels={tips}
            color={colors.warn}
            minY={0}
            format={(v) => `${v.toFixed(0)}h`}
            tooltipFormat={(v) => formatDuration(v * 60)}
          />
          <Text style={[font.small, { marginTop: space.sm }]}>What you still owe from the last 14 nights; recent nights count more. Under 2h is low. Above 5h it dulls your reactions and mood.</Text>
        </Card>
      </Section>

      <Section title="Sleep score">
        <Card>
          <LineChart values={rows.map((r) => r.score)} labels={labels} tooltipLabels={tips} tooltipFormat={(v) => `Score ${Math.round(v)}`} color={colors.accent} minY={30} maxY={100} />
        </Card>
      </Section>

      <Section title="Bed and wake times">
        <Card>
          <SleepTimeline rows={rows.map((r, i) => ({ label: labels[i], onsetMin: r.onsetMin, wakeMin: r.wakeMin }))} />
          <Row style={{ marginTop: space.md }}>
            <Stat label="Regularity" value={a.regularity.sri !== undefined ? String(Math.round(a.regularity.sri)) : '–'} sub={a.regularity.label} />
            <Stat label="Asleep around" value={habit ? formatClock(habit.onsetMin) : '–'} sub={habit?.onsetSdMin !== undefined ? `± ${Math.round(habit.onsetSdMin)} min` : undefined} />
            <Stat label="Awake around" value={habit ? formatClock(habit.wakeMin) : '–'} sub={habit?.wakeSdMin !== undefined ? `± ${Math.round(habit.wakeSdMin)} min` : undefined} />
          </Row>
          <Text style={[font.tiny, { marginTop: space.sm }]}>Regularity (0–100) is how often you're asleep or awake at the same time on two days in a row — the Sleep Regularity Index.</Text>
        </Card>
      </Section>

      <Section title="More charts">
        <ListCard>
          <Fold bare title="Deep and REM sleep" sub="Share of the night in each">
            <ChartCaption first>Deep sleep, % of the night</ChartCaption>
            <LineChart
              values={rows.map((r) => (r.deepPct !== undefined ? r.deepPct * 100 : undefined))}
              labels={labels}
              tooltipLabels={tips}
              color={colors.deep}
              height={110}
              format={(v) => `${Math.round(v)}%`}
              tooltipFormat={(v) => `${Math.round(v)}% deep`}
            />
            <ChartCaption>REM sleep, % of the night</ChartCaption>
            <LineChart
              values={rows.map((r) => (r.remPct !== undefined ? r.remPct * 100 : undefined))}
              labels={labels}
              tooltipLabels={tips}
              color={colors.rem}
              height={110}
              format={(v) => `${Math.round(v)}%`}
              tooltipFormat={(v) => `${Math.round(v)}% REM`}
            />
            <Text style={[font.tiny, { marginTop: space.sm }]}>A wrist can only estimate stages. The trend matters more than any one night.</Text>
          </Fold>
          <Fold bare title="Heart rate and HRV" sub="How recovered your body is overnight">
            <ChartCaption first>Heart rate variability (HRV, ms) — higher usually means better recovered</ChartCaption>
            <LineChart
              values={rows.map((r) => r.hrv)}
              labels={labels}
              tooltipLabels={tips}
              tooltipFormat={(v) => `${Math.round(v)} ms`}
              color={colors.good}
              height={120}
              band={hrvBase ? { lo: Math.exp(hrvBase.mean - hrvBase.sd), hi: Math.exp(hrvBase.mean + hrvBase.sd) } : undefined}
            />
            <ChartCaption>Lowest sleeping heart rate (bpm)</ChartCaption>
            <LineChart values={rows.map((r) => r.hrMin)} labels={labels} tooltipLabels={tips} tooltipFormat={(v) => `${Math.round(v)} bpm`} color={colors.bad} height={120} />
            <Text style={[font.tiny, { marginTop: space.sm }]}>The shaded band is your normal HRV range over the last 30 days.</Text>
          </Fold>
          <Fold bare title="Early bird or night owl" sub="Where your body clock sits" value={chrono.category ? CHRONOTYPE_LABELS[chrono.category].label : 'Not enough data yet'}>
            <Text style={font.h3}>{chrono.category ? CHRONOTYPE_LABELS[chrono.category].label : 'Not enough data yet'}</Text>
            {chrono.category ? <Text style={[font.small, { marginTop: space.xs }]}>{CHRONOTYPE_LABELS[chrono.category].description}</Text> : null}
            <KeyValue label="Middle of your sleep on free days" sub="Corrected for catching up on sleep" value={chrono.msfScMin !== undefined ? formatClock(chrono.msfScMin) : '–'} />
            <KeyValue label="Social jet lag" sub="Workdays against days off" value={chrono.socialJetlagMin !== undefined ? formatDuration(chrono.socialJetlagMin) : '–'} />
            <Text style={font.tiny}>
              From {chrono.nWork} workday and {chrono.nFree} free-day nights{chrono.quizScore !== undefined ? ` · quiz score ${chrono.quizScore}` : ''}. The technical word is chronotype.
            </Text>
            <ListRow
              title={chrono.quizScore !== undefined ? 'Retake the body-clock quiz' : 'Take the body-clock quiz'}
              sub="A few questions about when you feel best"
              onPress={() => router.push({ pathname: '/quiz/[id]', params: { id: 'rmeq' } })}
            />
          </Fold>
        </ListCard>
      </Section>

      {a.breathing ? (
        <Section title="Breathing check">
          <BreathingTrendCard trend={a.breathing} values={rows.map((r) => r.spo2Dips)} labels={labels} tooltipLabels={tips} stopBang={data.profile.screenings.stopbang} />
        </Section>
      ) : null}

      <Section title="What affects your sleep">
        <ListCard>
          {a.insights.map((i) => (
            <InsightRow key={i.id} insight={i} />
          ))}
          {a.insights.length === 0 ? (
            <ListRow
              icon="tag-multiple-outline"
              title="Nothing found yet"
              sub="Tag your days in the Journal (alcohol, late meals, exercise…) and eepy works out what helps or hurts."
              onPress={() => router.push('/journal')}
            />
          ) : null}
        </ListCard>
      </Section>
    </>
  );
}
