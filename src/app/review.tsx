/**
 * Weekly review: one week in numbers. Opens with the week's average sleep against your need, the
 * score, debt and regularity beside it, and the one thing to focus on next; then the nights, what
 * changed, goals, the experiment and the insights. The arrows at the top move between weeks.
 *
 * Param `week`: any date in the week to open (default: the latest).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { formatClock, formatDuration, localizeClockText } from '@/engine/time';
import { availableWeeks, buildWeeklyReview, latestReviewWeek, reviewNightLabel, ReviewNight, weekStartOf } from '@/engine/weeklyReview';
import { selectDataset, useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { DurationBars } from '@/ui/charts';
import { REVIEW_SEEN_MARK } from '@/ui/coach/hooks';
import { Banner, Button, Card, Empty, Hero, Icon, IconButton, KeyValue, Link, ListCard, ListRow, Row, Screen, Section, Stat } from '@/ui/components';
import { weekdayInitial } from '@/ui/format';
import { InsightCard } from '@/ui/InsightCard';
import { colors, font, scoreColor, space } from '@/ui/theme';

const signed = (min: number) => `${min >= 0 ? '+' : '−'}${formatDuration(Math.abs(min))}`;

function NightRow({ n, kind }: { n: ReviewNight; kind: 'best' | 'worst' }) {
  return (
    <ListRow
      icon={kind === 'best' ? 'trophy-outline' : 'weather-cloudy'}
      title={`${kind === 'best' ? 'Best' : 'Toughest'}: ${reviewNightLabel(n.date)}`}
      sub={`${n.sleepMin !== undefined ? formatDuration(n.sleepMin) : '–'} asleep`}
      right={
        <Row gap={space.xs}>
          {n.score !== undefined ? <Text style={[font.h3, { color: scoreColor(n.score), fontVariant: ['tabular-nums'] }]}>{n.score}</Text> : null}
          {n.sessionId ? <Icon name="chevron-right" color={colors.textFaint} /> : null}
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
  const focus = review.focus;

  return (
    <Screen>
      <Row style={{ marginBottom: space.md }}>
        <View style={{ opacity: older ? 1 : 0.3 }}>
          <IconButton icon="chevron-left" label="Previous week" color={colors.text} onPress={() => older && setWeek(older)} />
        </View>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={font.h3}>{review.label}</Text>
          <Text style={font.tiny}>
            {current === latest ? 'Latest week' : `${idx} week${idx === 1 ? '' : 's'} ago`} · {review.nightsRecorded} of 7 nights
          </Text>
        </View>
        <View style={{ opacity: newer ? 1 : 0.3 }}>
          <IconButton icon="chevron-right" label="Next week" color={colors.text} onPress={() => newer && setWeek(newer)} />
        </View>
      </Row>

      {review.nightsRecorded < 4 ? <Banner text={`Only ${review.nightsRecorded} night${review.nightsRecorded === 1 ? ' was' : 's were'} recorded this week, so treat these numbers as rough.`} /> : null}

      <Hero
        label="Average sleep"
        value={review.avgSleepMin !== undefined ? formatDuration(review.avgSleepMin) : '–'}
        unit="a night"
        color={sleepDelta !== undefined ? (sleepDelta >= -15 ? colors.good : sleepDelta >= -45 ? colors.warn : colors.bad) : colors.text}
        caption={sleepDelta !== undefined ? `${signed(sleepDelta)} against the ${formatDuration(review.needMin)} you need.` : `You need ${formatDuration(review.needMin)}.`}
      />
      <Card>
        <Row>
          <Stat
            label="Score"
            value={review.avgScore !== undefined ? String(Math.round(review.avgScore)) : '–'}
            color={review.avgScore !== undefined ? scoreColor(review.avgScore) : undefined}
            sub={review.prevAvgScore !== undefined && review.avgScore !== undefined ? `${review.avgScore >= review.prevAvgScore ? '▲' : '▼'} ${Math.abs(Math.round(review.avgScore - review.prevAvgScore))} vs week before` : undefined}
          />
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
          <Text style={[font.small, { marginTop: space.md }]}>
            Usually asleep around {formatClock(reg.avgOnsetMin)}, up around {formatClock(reg.avgWakeMin)}.
          </Text>
        ) : null}
      </Card>

      <Section title="Focus for next week">
        <Card>
          <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
            <Icon name={focus.icon} size={22} />
            <View style={{ flex: 1 }}>
              <Text style={font.h3}>{focus.title}</Text>
              <Text style={[font.small, { marginTop: space.xs }]}>{focus.detail}</Text>
            </View>
          </Row>
          {focus.templateId ? (
            <Button label="Set up this experiment" icon="flask-outline" onPress={() => router.push({ pathname: '/experiments', params: { template: focus.templateId! } })} style={{ marginTop: space.md }} />
          ) : focus.experimentId ? (
            <Button kind="secondary" label="Open experiment" icon="flask-outline" onPress={() => router.push({ pathname: '/experiments/[id]', params: { id: focus.experimentId! } })} style={{ marginTop: space.md }} />
          ) : null}
        </Card>
      </Section>

      <Section title="Night by night">
        <Card style={{ paddingBottom: space.xs }}>
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
          <ListCard>
            {review.changes.map((c) => (
              <ListRow key={c.key} icon={c.improved ? 'trending-up' : 'trending-down'} iconColor={c.improved ? colors.good : colors.warn} title={c.text} />
            ))}
          </ListCard>
        </Section>
      ) : null}

      {review.goals.length ? (
        <Section title="Goals" action={<Link label="Edit" onPress={() => router.push('/goals')} />}>
          <ListCard>
            {review.goals.map((g) => (
              <KeyValue key={g.id} label={g.title} value={g.known ? `${g.met} of ${g.known} days` : 'No data'} color={!g.known ? colors.textDim : g.met / g.known >= 0.7 ? colors.good : colors.warn} />
            ))}
          </ListCard>
        </Section>
      ) : null}

      {review.experiment ? (
        <Section title="Experiment">
          <ListCard>
            <ListRow
              icon="flask-outline"
              title={localizeClockText(review.experiment.title)}
              sub={review.experiment.text}
              onPress={() => router.push({ pathname: '/experiments/[id]', params: { id: review.experiment!.id } })}
            />
          </ListCard>
        </Section>
      ) : null}

      {review.insights.length ? (
        <Section title="What affected your sleep">
          {review.insights.map((i) => (
            <InsightCard key={i.id} insight={i} />
          ))}
        </Section>
      ) : null}

      {review.breathing ? (
        <Section title="Breathing">
          <ListCard>
            <ListRow icon="lungs" iconColor={colors.warn} title={review.breathing.title} sub={review.breathing.detail} />
            <ListRow icon="clipboard-check-outline" title="Take the breathing check" sub="Eight questions (STOP-Bang)" onPress={() => router.push({ pathname: '/quiz/[id]', params: { id: 'stopbang' } })} />
          </ListCard>
        </Section>
      ) : null}
    </Screen>
  );
}
