import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { formatClock, formatDuration, localizeClockText } from '@/engine/time';
import { availableWeeks, buildWeeklyReview, latestReviewWeek, reviewNightLabel, ReviewNight, weekStartOf } from '@/engine/weeklyReview';
import { selectDataset, useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { REVIEW_SEEN_MARK } from '@/ui/cards/CoachCards';
import { DurationBars } from '@/ui/charts';
import { Button, Card, CardTitle, Empty, Icon, ListRow, Meter, Note, Row, Screen, Section, Stat } from '@/ui/components';
import { weekdayInitial } from '@/ui/format';
import { colors, font, scoreColor, space } from '@/ui/theme';

const signed = (min: number) => `${min >= 0 ? '+' : '−'}${formatDuration(Math.abs(min))}`;

function NightRow({ n, kind }: { n: ReviewNight; kind: 'best' | 'worst' }) {
  return (
    <ListRow
      icon={kind === 'best' ? 'trophy-outline' : 'weather-cloudy'}
      iconColor={kind === 'best' ? colors.energy : colors.textDim}
      title={`${kind === 'best' ? 'Best' : 'Toughest'}: ${reviewNightLabel(n.date)}`}
      sub={`${n.sleepMin !== undefined ? formatDuration(n.sleepMin) : '–'} asleep`}
      right={
        <Row gap={6}>
          {n.score !== undefined ? <Text style={[font.h3, { color: scoreColor(n.score) }]}>{n.score}</Text> : null}
          <Icon name="chevron-right" color={colors.textFaint} />
        </Row>
      }
      onPress={n.sessionId ? () => router.push({ pathname: '/night/[id]', params: { id: n.sessionId! } }) : undefined}
    />
  );
}

export default function ReviewScreen() {
  const a = useAnalysis();
  const params = useLocalSearchParams<{ week?: string }>();
  const data = useStore(useShallow(selectDataset));
  const goals = useStore((s) => s.goals);
  const experiments = useStore((s) => s.experiments);
  const setMark = useStore((s) => s.setMark);
  const weeks = useMemo(() => (a ? availableWeeks(a.nights, a.day, 12) : []), [a]);
  const [week, setWeek] = useState<string | undefined>(() => (params.week ? weekStartOf(params.week) : undefined));
  const current = week && weeks.includes(week) ? week : weeks[0];
  const review = useMemo(
    () => (a && current ? buildWeeklyReview({ analysis: a, data, goals, experiments, weekStart: current }) : undefined),
    [a, data, goals, experiments, current],
  );
  const latest = a ? latestReviewWeek(a.day) : undefined;

  useEffect(() => {
    if (current && current === latest) setMark(REVIEW_SEEN_MARK, current);
  }, [current, latest, setMark]);

  if (!a || !review || !current) {
    return (
      <Screen>
        <Empty icon="calendar-week" title="No review yet" body="Your first weekly review arrives on Sunday evening once a few nights are recorded." />
      </Screen>
    );
  }

  const idx = weeks.indexOf(current);
  const older = weeks[idx + 1];
  const newer = idx > 0 ? weeks[idx - 1] : undefined;
  const sleepDelta = review.avgSleepMin !== undefined ? review.avgSleepMin - review.needMin : undefined;
  const reg = review.regularity;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
        <Pressable onPress={() => older && setWeek(older)} disabled={!older} hitSlop={10} accessibilityLabel="Previous week" style={{ opacity: older ? 1 : 0.3 }}>
          <Icon name="chevron-left" size={28} color={colors.text} />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={font.h2}>{review.label}</Text>
          <Text style={font.tiny}>
            {current === latest ? 'LATEST WEEK' : `${idx} WEEK${idx === 1 ? '' : 'S'} AGO`} · {review.nightsRecorded}/7 NIGHTS
          </Text>
        </View>
        <Pressable onPress={() => newer && setWeek(newer)} disabled={!newer} hitSlop={10} accessibilityLabel="Next week" style={{ opacity: newer ? 1 : 0.3 }}>
          <Icon name="chevron-right" size={28} color={colors.text} />
        </Pressable>
      </Row>

      <Card>
        <Row>
          <Stat
            label="Avg sleep"
            value={review.avgSleepMin !== undefined ? formatDuration(review.avgSleepMin) : '–'}
            sub={sleepDelta !== undefined ? `${signed(sleepDelta)} vs need` : undefined}
            color={sleepDelta !== undefined ? (sleepDelta >= -15 ? colors.good : sleepDelta >= -45 ? colors.warn : colors.bad) : undefined}
          />
          <Stat
            label="Avg score"
            value={review.avgScore !== undefined ? String(Math.round(review.avgScore)) : '–'}
            color={review.avgScore !== undefined ? scoreColor(review.avgScore) : undefined}
            sub={review.prevAvgScore !== undefined && review.avgScore !== undefined ? `${review.avgScore >= review.prevAvgScore ? '▲' : '▼'} ${Math.abs(Math.round(review.avgScore - review.prevAvgScore))} vs week before` : undefined}
          />
        </Row>
        <Row style={{ marginTop: space.md }}>
          <Stat
            label="Sleep debt"
            value={signed(review.debtChangeMin)}
            color={review.debtChangeMin > 15 ? colors.warn : review.debtChangeMin < -15 ? colors.good : colors.text}
            sub={`${formatDuration(review.debtStartMin)} → ${formatDuration(review.debtEndMin)}`}
          />
          <Stat
            label="Regularity"
            value={reg.sri !== undefined ? String(Math.round(reg.sri)) : reg.wakeSdMin !== undefined ? `±${Math.round(reg.wakeSdMin)}m` : '–'}
            sub={reg.sri !== undefined ? `${reg.label}${reg.wakeSdMin !== undefined ? ` · wake ±${Math.round(reg.wakeSdMin)}m` : ''}` : 'wake-time spread'}
          />
        </Row>
        {reg.avgOnsetMin !== undefined && reg.avgWakeMin !== undefined ? (
          <Text style={[font.tiny, { marginTop: space.md }]}>
            Typically asleep around {formatClock(reg.avgOnsetMin)} and up around {formatClock(reg.avgWakeMin)}.
          </Text>
        ) : null}
      </Card>

      <Section title="Night by night">
        <Card>
          <DurationBars
            need={review.needMin}
            data={review.rows.map((r) => ({
              label: weekdayInitial(r.date),
              value: r.sleepMin !== undefined ? r.sleepMin - r.napMin : undefined,
              extra: r.napMin || undefined,
              highlight: r.date === review.best?.date,
            }))}
          />
          {review.best ? <NightRow n={review.best} kind="best" /> : null}
          {review.worst ? <NightRow n={review.worst} kind="worst" /> : null}
        </Card>
      </Section>

      {review.changes.length ? (
        <Section title="What changed">
          <Card>
            {review.changes.map((c, i) => (
              <Row key={c.key} gap={space.sm} style={{ paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border, alignItems: 'flex-start' }}>
                <Icon name={c.improved ? 'trending-up' : 'trending-down'} size={18} color={c.improved ? colors.good : colors.warn} />
                <Text style={[font.body, { flex: 1 }]}>{c.text}</Text>
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}

      {review.goals.length ? (
        <Section title="Goals" action={<Button small kind="ghost" label="Edit" onPress={() => router.push('/goals')} />}>
          <Card>
            {review.goals.map((g) => (
              <View key={g.id} style={{ marginBottom: space.sm }}>
                <Row>
                  <Text style={[font.body, { flex: 1 }]}>{g.title}</Text>
                  <Text style={font.small}>{g.known ? `${g.met}/${g.known} days` : 'no data'}</Text>
                </Row>
                <View style={{ marginTop: 4 }}>
                  <Meter value={g.known ? (g.met / g.known) * 100 : 0} color={g.known && g.met / g.known >= 0.7 ? colors.good : colors.warn} height={6} />
                </View>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {review.experiment ? (
        <Section title="Experiment">
          <Card onPress={() => router.push({ pathname: '/experiments/[id]', params: { id: review.experiment!.id } })}>
            <CardTitle icon="flask-outline" title={localizeClockText(review.experiment.title)} right={<Icon name="chevron-right" color={colors.textFaint} />} />
            <Text style={font.small}>{review.experiment.text}</Text>
          </Card>
        </Section>
      ) : null}

      {review.insights.length ? (
        <Section title="Top insights">
          {review.insights.map((i) => (
            <Card key={i.id} accent={i.kind === 'negative' ? colors.warn : i.kind === 'positive' ? colors.good : undefined}>
              <Text style={font.h3}>{i.title}</Text>
              <Text style={[font.small, { marginTop: 4 }]}>{i.detail}</Text>
              {i.evidence ? <Text style={[font.tiny, { marginTop: 6 }]}>{i.evidence}</Text> : null}
            </Card>
          ))}
        </Section>
      ) : null}

      <Section title="Focus for next week">
        <Card accent={colors.accent}>
          <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
            <Icon name={review.focus.icon} size={26} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={font.h3}>{review.focus.title}</Text>
              <Text style={[font.small, { marginTop: 4 }]}>{review.focus.detail}</Text>
            </View>
          </Row>
          {review.focus.templateId ? (
            <View style={{ marginTop: space.md }}>
              <Button label="Set up this experiment" icon="flask-outline" onPress={() => router.push({ pathname: '/experiments', params: { template: review.focus.templateId! } })} />
            </View>
          ) : review.focus.experimentId ? (
            <View style={{ marginTop: space.md }}>
              <Button kind="secondary" label="Open experiment" icon="flask-outline" onPress={() => router.push({ pathname: '/experiments/[id]', params: { id: review.focus.experimentId! } })} />
            </View>
          ) : null}
        </Card>
      </Section>
      {review.nightsRecorded < 4 ? <Note tone="info">Only {review.nightsRecorded} nights were recorded this week, so treat these numbers as rough.</Note> : null}
    </Screen>
  );
}
