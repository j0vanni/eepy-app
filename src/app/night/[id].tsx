import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { TAG_BY_ID } from '@/engine/tags';
import { addDays, formatDuration, formatTime } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Hypnogram, LineChart, StageBar } from '@/ui/charts';
import { Button, Card, CardTitle, Chip, Empty, Meter, Note, Ring, Row, Screen, Section, Stat } from '@/ui/components';
import { confirm } from '@/ui/confirm';
import { nightLabel } from '@/ui/format';
import { colors, font, scoreColor, space } from '@/ui/theme';

export default function NightScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = useAnalysis();
  const vitals = useStore((s) => s.vitals[id]);
  const dayLogs = useStore((s) => s.dayLogs);
  const deleteSession = useStore((s) => s.deleteSession);
  const m = a?.metrics.find((x) => x.id === id);

  if (!a || !m) {
    return (
      <Screen>
        <Empty icon="bed-empty" title="Night not found" body="It may have been replaced by a newer sync." />
      </Screen>
    );
  }
  const score = a.scores[m.id];
  const tags = dayLogs[addDays(m.wakeDate, -1)]?.tags ?? [];
  const log = dayLogs[m.wakeDate];
  const curve = vitals?.hrCurve ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: m.isNap ? 'Nap' : nightLabel(m.wakeDate) }} />
      <Card>
        <Row gap={space.lg}>
          {score ? (
            <Ring value={score.total} color={scoreColor(score.total)} size={96}>
              <Text style={[font.stat, { fontSize: 28 }]}>{score.total}</Text>
              <Text style={font.tiny}>{score.label.toUpperCase()}</Text>
            </Ring>
          ) : null}
          <View style={{ flex: 1, gap: space.sm }}>
            <Row>
              <Stat label="Asleep" value={formatDuration(m.totalSleepMin)} />
              <Stat label="In bed" value={formatDuration(m.timeInBedMin)} />
            </Row>
            <Text style={font.small}>
              {formatTime(m.start)} in bed · asleep {formatTime(m.sleepOnset)} · up {formatTime(m.finalWake)}
            </Text>
          </View>
        </Row>
      </Card>

      <Card>
        <CardTitle icon="chart-gantt" title="Hypnogram" />
        <Hypnogram segments={m.segments} start={m.start} end={m.end} height={150} />
        <View style={{ marginTop: space.md }}>
          <StageBar minutes={m.stageMin} />
        </View>
        {!m.hasStages ? <Note tone="info">This session has no stage data (manual log or unstaged source).</Note> : null}
      </Card>

      <Card>
        <Row>
          <Stat label="Fell asleep in" value={m.latencyMin >= 1 ? `${Math.round(m.latencyMin)}m` : '–'} />
          <Stat label="Awake at night" value={`${Math.round(m.wasoMin)}m`} sub={`${m.awakenings} wake-ups`} />
          <Stat label="Efficiency" value={`${Math.round(m.efficiency * 100)}%`} />
        </Row>
        {m.cycles.length ? (
          <View style={{ marginTop: space.md }}>
            <Text style={font.tiny}>SLEEP CYCLES{m.avgCycleMin ? ` · AVG ${Math.round(m.avgCycleMin)} MIN` : ''}</Text>
            <Row gap={6} style={{ flexWrap: 'wrap', marginTop: 6 }}>
              {m.cycles.map((c, i) => (
                <View key={i} style={{ backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 8, minWidth: 64 }}>
                  <Text style={[font.small, { color: colors.text }]}>
                    #{i + 1} {Math.round(c.lengthMin)}m
                  </Text>
                  <Text style={font.tiny}>
                    deep {Math.round(c.deepMin)} · REM {Math.round(c.remMin)}
                    {c.complete ? '' : ' · partial'}
                  </Text>
                </View>
              ))}
            </Row>
          </View>
        ) : null}
      </Card>

      {score ? (
        <Section title="Score breakdown">
          <Card>
            {score.components.map((c) => (
              <View key={c.key} style={{ marginBottom: space.md }}>
                <Row>
                  <Text style={[font.body, { flex: 1 }]}>{c.label}</Text>
                  <Text style={font.small}>{c.value}</Text>
                </Row>
                <View style={{ marginTop: 5 }}>
                  <Meter value={c.score} max={1} color={scoreColor(c.score * 100)} height={6} />
                </View>
                <Text style={[font.tiny, { marginTop: 4 }]}>{c.detail}</Text>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {vitals ? (
        <Section title="Body">
          <Card>
            <Row>
              <Stat label="Lowest HR" value={vitals.hrMin ? `${vitals.hrMin}` : '–'} sub={vitals.hrAvg ? `avg ${vitals.hrAvg} bpm` : undefined} />
              <Stat label="HRV" value={vitals.hrvRmssd ? `${vitals.hrvRmssd} ms` : '–'} />
              <Stat
                label="SpO₂"
                value={vitals.spo2Avg ? `${vitals.spo2Avg}%` : '–'}
                sub={vitals.spo2Min ? `min ${vitals.spo2Min}%${vitals.spo2DipsPerHour !== undefined ? ` · ${vitals.spo2DipsPerHour}/h dips` : ''}` : undefined}
              />
            </Row>
            {curve.length > 3 ? (
              <View style={{ marginTop: space.md }}>
                <Text style={[font.small, { marginBottom: 4 }]}>Heart rate through the night</Text>
                <LineChart values={curve.map((p) => p[1])} labels={curve.map((p) => formatTime(m.start + p[0] * 60000))} color={colors.bad} height={130} />
              </View>
            ) : null}
            {vitals.hrNadirOffsetMin !== undefined ? (
              <Text style={[font.small, { marginTop: space.sm }]}>
                Heart rate bottomed out {formatDuration(vitals.hrNadirOffsetMin)} after falling asleep
                {vitals.hrNadirOffsetMin / ((m.finalWake - m.sleepOnset) / 60000) > 0.6 ? ' — late in the night, often a sign of a late meal, alcohol or evening exercise.' : '.'}
              </Text>
            ) : null}
            {vitals.respRate ? <Text style={font.small}>Breathing rate {vitals.respRate}/min.</Text> : null}
          </Card>
        </Section>
      ) : null}

      <Section title="Context">
        <Card>
          {tags.length ? (
            <Row gap={6} style={{ flexWrap: 'wrap' }}>
              {tags.map((t) => (
                <Chip key={t} label={TAG_BY_ID[t]?.label ?? t} icon={TAG_BY_ID[t]?.icon} />
              ))}
            </Row>
          ) : (
            <Text style={font.small}>No tags for the evening before.</Text>
          )}
          {log?.sleepRating ? <Text style={[font.small, { marginTop: space.sm }]}>You rated this night {log.sleepRating}/5.</Text> : null}
          {log?.wokeNaturally !== undefined ? <Text style={font.small}>{log.wokeNaturally ? 'Woke up naturally.' : 'Woken by an alarm.'}</Text> : null}
          <Text style={[font.tiny, { marginTop: space.sm }]}>
            Source: {m.session.source}
            {m.session.device ? ` · ${m.session.device}` : ''}
            {m.session.origin ? ` · ${m.session.origin}` : ''}
          </Text>
        </Card>
        <Row gap={space.sm}>
          <Button small kind="secondary" icon="notebook-edit-outline" label="Edit journal" onPress={() => router.push('/journal')} />
          {m.session.source === 'manual' ? (
            <Button
              small
              kind="danger"
              icon="delete-outline"
              label="Delete"
              onPress={async () => {
                if (await confirm('Delete this entry?', 'This removes the manually logged sleep.', 'Delete', true)) {
                  deleteSession(m.session.id);
                  router.back();
                }
              }}
            />
          ) : null}
        </Row>
      </Section>
    </Screen>
  );
}
