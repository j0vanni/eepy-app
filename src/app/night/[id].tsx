/**
 * One night: how long you slept and how good it was, the night's shape, what happened in plain
 * sentences, then the details in the order people ask for them — times (with the ways to correct
 * them), stages, the body's numbers, your journal for it, and the breathing check.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { assessBreathing, breathingSummaryFor } from '@/engine/breathing';
import { buildNightStory } from '@/engine/nightStory';
import { TAG_BY_ID } from '@/engine/tags';
import { addDays, formatDuration, formatTime, MINUTE } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { BreathingNightCard } from '@/ui/cards/BreathingCard';
import { NightStoryCard } from '@/ui/cards/NightStoryCard';
import { Hypnogram, LineChart, StageBar } from '@/ui/charts';
import { Card, Empty, Fold, Hero, KeyValue, ListCard, ListRow, Meter, Row, Screen, Section } from '@/ui/components';
import { confirm } from '@/ui/confirm';
import { dayLabel, fullDate, nightLabel } from '@/ui/format';
import { RoutineCheck } from '@/ui/RoutineCheck';
import { ScoreLine } from '@/ui/sleep/parts';
import { colors, font, scoreColor, space } from '@/ui/theme';
import { NightTimelineCard } from '@/ui/WakeCheck';

const RATING_WORD = ['', 'Very bad', 'Bad', 'OK', 'Good', 'Very good'];

export default function NightScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = useAnalysis();
  const allVitals = useStore((s) => s.vitals);
  const vitals = allVitals[id];
  const dayLogs = useStore((s) => s.dayLogs);
  const caffeine = useStore((s) => s.caffeine);
  const profile = useStore((s) => s.profile);
  const workouts = useStore((s) => s.workouts);
  const deleteSession = useStore((s) => s.deleteSession);
  const m = a?.metrics.find((x) => x.id === id);
  const story = useMemo(
    () =>
      a && m
        ? a.lastNightStory?.sessionId === m.id
          ? a.lastNightStory
          : buildNightStory({ night: m, nights: a.nights, vitals: allVitals, dayLogs, caffeine, profile, workouts, insights: a.insights, scores: a.scores })
        : undefined,
    [a, m, allVitals, dayLogs, caffeine, profile, workouts],
  );
  const breathing = useMemo(() => (m ? assessBreathing(breathingSummaryFor(allVitals, m.id)) : undefined), [m, allVitals]);

  if (!a || !m) {
    return (
      <Screen>
        <Empty icon="bed-empty" title="Night not found" body="It may have been replaced by a newer sync." />
      </Screen>
    );
  }
  const score = a.scores[m.id];
  const timeline = m.isNap ? undefined : a.timelines[m.id];
  const eveningDate = addDays(m.wakeDate, -1);
  const tags = dayLogs[eveningDate]?.tags ?? [];
  const log = dayLogs[m.wakeDate];
  const curve = vitals?.hrCurve ?? [];
  const manual = m.session.source === 'manual';
  // A heart rate that bottoms out late in the night often follows a late meal, alcohol or evening exercise.
  const lateNadir = vitals?.hrNadirOffsetMin !== undefined && vitals.hrNadirOffsetMin / ((m.finalWake - m.sleepOnset) / MINUTE) > 0.6;
  const morning = [log?.sleepRating ? `You rated it ${RATING_WORD[log.sleepRating].toLowerCase()} (${log.sleepRating} of 5)` : undefined, log?.wokeNaturally !== undefined ? (log.wokeNaturally ? 'woke on your own' : 'woken by an alarm') : undefined]
    .filter(Boolean)
    .join(' · ');
  const source = [m.session.source, m.session.device, m.session.origin].filter(Boolean).join(' · ');

  return (
    <Screen>
      <Stack.Screen options={{ title: m.isNap ? 'Nap' : nightLabel(m.wakeDate) }} />
      <Hero
        // The header says "Tue night"; an older night also needs its date.
        label={m.isNap ? `Nap · ${dayLabel(m.wakeDate)}` : m.wakeDate === a.day ? 'Time asleep' : `Time asleep · night to ${fullDate(m.wakeDate)}`}
        value={formatDuration(m.totalSleepMin)}
        caption={<ScoreLine score={score} rest={`${formatDuration(m.timeInBedMin)} in bed`} />}
      >
        <View style={{ marginTop: space.md }}>
          <Hypnogram segments={m.segments} start={m.start} end={m.end} height={150} />
        </View>
      </Hero>

      {story ? <NightStoryCard story={story} /> : null}

      <Section title="Times">
        {timeline ? (
          <NightTimelineCard m={m} t={timeline} />
        ) : (
          <ListCard>
            <KeyValue label="In bed" value={formatTime(m.start)} />
            <KeyValue label="Fell asleep" value={formatTime(m.sleepOnset)} />
            <KeyValue label="Woke up" value={formatTime(m.finalWake)} />
          </ListCard>
        )}
        {!m.isNap ? <RoutineCheck m={m} t={timeline} /> : null}
      </Section>

      <Section title="Stages">
        <Card>
          <StageBar minutes={m.stageMin} />
          {!m.hasStages ? <Text style={[font.small, { marginTop: space.sm }]}>No sleep stages for this one: it was logged by hand, or the source didn't record them.</Text> : null}
        </Card>
        <ListCard>
          <KeyValue label="Fell asleep in" value={m.latencyMin >= 1 ? formatDuration(m.latencyMin) : '–'} />
          <KeyValue label="Awake in the night" sub={`${m.awakenings} wake-up${m.awakenings === 1 ? '' : 's'}`} value={formatDuration(m.wasoMin)} />
          <KeyValue label="Asleep while in bed" sub="Sleep efficiency" value={`${Math.round(m.efficiency * 100)}%`} />
          {m.cycles.length ? (
            <Fold bare title="Sleep cycles" value={`${m.cycles.length}${m.avgCycleMin ? ` · about ${Math.round(m.avgCycleMin)} min each` : ''}`}>
              {m.cycles.map((c, i) => (
                <KeyValue
                  key={i}
                  label={`Cycle ${i + 1}${c.complete ? '' : ' (partial)'}`}
                  sub={`Deep ${Math.round(c.deepMin)} min · REM ${Math.round(c.remMin)} min`}
                  value={`${Math.round(c.lengthMin)} min`}
                />
              ))}
            </Fold>
          ) : null}
          {score ? (
            <Fold bare title="What the score is made of" value={`${score.total} · ${score.label.toLowerCase()}`}>
              {score.components.map((c, i) => (
                <View key={c.key} style={{ marginTop: i ? space.md : 0 }}>
                  <Row gap={space.sm}>
                    <Text style={[font.body, { flex: 1 }]}>{c.label}</Text>
                    <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>{c.value}</Text>
                  </Row>
                  <View style={{ marginVertical: space.xs }}>
                    <Meter value={c.score} max={1} color={scoreColor(c.score * 100)} />
                  </View>
                  <Text style={font.tiny}>{c.detail}</Text>
                </View>
              ))}
            </Fold>
          ) : null}
        </ListCard>
      </Section>

      {vitals ? (
        <Section title="Body">
          <ListCard>
            <KeyValue label="Lowest heart rate" sub={vitals.hrAvg ? `Average ${vitals.hrAvg} bpm` : undefined} value={vitals.hrMin ? `${vitals.hrMin} bpm` : '–'} />
            {vitals.hrNadirOffsetMin !== undefined ? (
              <KeyValue
                label="Heart rate lowest after"
                sub={lateNadir ? 'Late in the night: often a late meal, alcohol or evening exercise' : 'Since you fell asleep'}
                value={formatDuration(vitals.hrNadirOffsetMin)}
                color={lateNadir ? colors.warn : colors.text}
              />
            ) : null}
            <KeyValue label="HRV" sub="Heart rate variability overnight" value={vitals.hrvRmssd ? `${vitals.hrvRmssd} ms` : '–'} />
            <KeyValue label="Oxygen" sub={vitals.spo2Min ? `Lowest ${vitals.spo2Min}%` : undefined} value={vitals.spo2Avg ? `${vitals.spo2Avg}%` : '–'} />
            {vitals.respRate ? <KeyValue label="Breathing rate" value={`${vitals.respRate} a min`} /> : null}
            {curve.length > 3 ? (
              <Fold bare title="Heart rate through the night">
                <LineChart values={curve.map((p) => p[1])} labels={curve.map((p) => formatTime(m.start + p[0] * MINUTE))} color={colors.bad} height={130} />
              </Fold>
            ) : null}
          </ListCard>
        </Section>
      ) : null}

      <Section title="Your journal">
        <ListCard>
          <ListRow
            icon="tag-multiple-outline"
            title="The evening before"
            sub={tags.length ? tags.map((t) => TAG_BY_ID[t]?.label ?? t).join(' · ') : 'No tags. Add what you did that evening.'}
            onPress={() => router.push({ pathname: '/journal', params: { date: eveningDate } })}
          />
          {!m.isNap ? (
            <ListRow
              icon="weather-sunset-up"
              title="The morning after"
              sub={morning ? `${morning.charAt(0).toUpperCase()}${morning.slice(1)}` : 'Rate the night and say how you woke up.'}
              onPress={() => router.push({ pathname: '/journal', params: { date: m.wakeDate } })}
            />
          ) : null}
          <ListRow icon={manual ? 'pencil-outline' : 'watch-variant'} title={manual ? 'Logged by you' : 'Recorded by'} sub={source} />
          {manual ? (
            <ListRow
              icon="delete-outline"
              iconColor={colors.bad}
              title="Delete this entry"
              sub="Removes the sleep you logged by hand"
              onPress={async () => {
                if (await confirm('Delete this entry?', 'This removes the manually logged sleep.', 'Delete', true)) {
                  deleteSession(m.session.id);
                  router.back();
                }
              }}
            />
          ) : null}
        </ListCard>
      </Section>

      {breathing ? (
        <Section title="Breathing check">
          <BreathingNightCard night={breathing} curve={vitals?.spo2Curve} start={m.start} stopBang={profile.screenings.stopbang} />
        </Section>
      ) : null}
    </Screen>
  );
}
