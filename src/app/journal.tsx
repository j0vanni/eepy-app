/**
 * Journal: one day at a time — how you slept, how the day felt, what you did, what you drank.
 * Everything saves as you tap. Param `date` opens a past day (e.g. the evening a night's story
 * points to).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { drinkOptions } from '@/engine/caffeineHabits';
import { TAGS } from '@/engine/tags';
import { addDays, atMinutes, dateKey, formatClock, formatDuration, formatTime, minutesOfDay, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Card, Chip, Divider, IconButton, ListCard, ListRow, Row, Screen, Section, Stepper } from '@/ui/components';
import { dayLabel, nightLabel } from '@/ui/format';
import { Question, RatingFaces } from '@/ui/sleep/parts';
import { colors, font, radius, space } from '@/ui/theme';

const ENERGY = ['Exhausted', 'Tired', 'OK', 'Good', 'Energised'];

const wrap = { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm } as const;

export default function JournalScreen() {
  const today = dateKey(Date.now());
  const params = useLocalSearchParams<{ date?: string }>();
  const [date, setDate] = useState(() => (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && params.date <= today ? params.date : today));
  const log = useStore((s) => s.dayLogs[date]);
  const logDay = useStore((s) => s.logDay);
  const toggleTag = useStore((s) => s.toggleTag);
  const caffeine = useStore((s) => s.caffeine);
  const addCaffeine = useStore((s) => s.addCaffeine);
  const removeCaffeine = useStore((s) => s.removeCaffeine);
  const customDrinks = useStore((s) => s.settings.customDrinks);
  const a = useAnalysis();
  const [doseMin, setDoseMin] = useState(() => (date === today ? Math.round(minutesOfDay(Date.now()) / 5) * 5 : 9 * 60));

  const night = a?.nights.find((n) => n.wakeDate === date)?.main;
  const score = night ? a?.scores[night.id] : undefined;
  const dayDoses = caffeine.filter((d) => dateKey(d.time) === date);
  const totalMg = dayDoses.reduce((s, d) => s + d.mg, 0);
  const isToday = date === today;

  const changeDate = (d: string) => {
    setDate(d);
    setDoseMin(d === today ? Math.round(minutesOfDay(Date.now()) / 5) * 5 : 9 * 60);
  };

  return (
    <Screen>
      {/* Which day: the form's first question. */}
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
        <IconButton icon="chevron-left" label="Previous day" color={colors.text} onPress={() => changeDate(addDays(date, -1))} />
        <View style={{ alignItems: 'center' }}>
          <Text style={font.h2}>{dayLabel(date)}</Text>
          <Text style={font.tiny}>Saved as you tap</Text>
        </View>
        <View style={{ opacity: isToday ? 0.3 : 1 }}>
          <IconButton icon="chevron-right" label="Next day" color={colors.text} onPress={() => !isToday && changeDate(addDays(date, 1))} />
        </View>
      </Row>

      <Section title="Morning">
        <Card>
          {night ? (
            <ListRow
              title={`${nightLabel(date)}: ${formatDuration(night.totalSleepMin)}`}
              sub={`${formatTime(night.sleepOnset)} → ${formatTime(night.finalWake)}${score ? ` · score ${score.total}` : ''}`}
              onPress={() => router.push({ pathname: '/night/[id]', params: { id: night.id } })}
            />
          ) : (
            <ListRow title="No sleep recorded for this night" sub="Slept without the watch? Log it." onPress={() => router.push({ pathname: '/log-sleep', params: { date } })} />
          )}
          <Divider spacing={space.sm} />
          <Question first>How did you sleep?</Question>
          <RatingFaces value={log?.sleepRating} onChange={(r) => logDay(date, { sleepRating: r })} />
          <Question>Did you wake up on your own?</Question>
          <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
            <Chip label="Yes" icon="weather-sunny" selected={log?.wokeNaturally === true} onPress={() => logDay(date, { wokeNaturally: true })} />
            <Chip label="No, alarm or woken" icon="alarm" selected={log?.wokeNaturally === false} onPress={() => logDay(date, { wokeNaturally: false })} />
          </Row>
          <Text style={[font.tiny, { marginTop: space.sm }]}>Mornings without an alarm are how eepy learns how much sleep you need.</Text>
        </Card>
      </Section>

      <Section title="Energy during the day">
        <Card>
          <View style={wrap}>
            {ENERGY.map((e, i) => (
              <Chip key={e} label={`${i + 1} · ${e}`} selected={log?.energy === i + 1} onPress={() => logDay(date, { energy: i + 1 })} />
            ))}
          </View>
          <TextInput
            placeholder="Notes (optional)"
            placeholderTextColor={colors.textFaint}
            value={log?.note ?? ''}
            onChangeText={(note) => logDay(date, { note })}
            style={[font.body, { marginTop: space.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: space.md, minHeight: 48 }]}
            accessibilityLabel="Notes"
            multiline
          />
        </Card>
      </Section>

      <Section title={isToday ? 'Today and this evening' : 'That day and evening'}>
        <Card>
          <View style={wrap}>
            {TAGS.map((t) => (
              <Chip key={t.id} label={t.label} icon={t.icon} selected={log?.tags.includes(t.id)} onPress={() => toggleTag(date, t.id)} />
            ))}
          </View>
          <Text style={[font.tiny, { marginTop: space.md }]}>Tags are matched to the night that follows, so eepy can learn what helps or hurts your sleep.</Text>
        </Card>
      </Section>

      <Section title="Caffeine" action={<Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>{`${totalMg} mg`}</Text>}>
        <Card style={{ paddingBottom: space.xs }}>
          <Stepper label="Had at" sub="Then tap what you had" value={formatClock(doseMin)} onDec={() => setDoseMin(normalizeMinutes(doseMin - 15))} onInc={() => setDoseMin(normalizeMinutes(doseMin + 15))} />
          <View style={[wrap, { marginTop: space.xs, marginBottom: space.md }]}>
            {drinkOptions(customDrinks).map((p) => (
              <Chip
                key={p.label}
                label={`${p.label} · ${p.mg} mg`}
                onPress={() => addCaffeine({ id: `c-${Date.now()}-${p.mg}`, time: atMinutes(date, doseMin), mg: p.mg, label: p.label })}
              />
            ))}
          </View>
          {dayDoses.map((d) => (
            <View key={d.id}>
              <Divider spacing={0} />
              <ListRow
                title={`${formatTime(d.time)} · ${d.label}`}
                sub={`${d.mg} mg · tap to change`}
                onPress={() => router.push({ pathname: '/caffeine', params: { id: d.id } })}
                right={<IconButton icon="close" label="Remove drink" color={colors.textFaint} onPress={() => removeCaffeine(d.id)} />}
              />
            </View>
          ))}
          <Divider spacing={0} />
          <ListRow title="Log a drink with an exact time" onPress={() => router.push({ pathname: '/caffeine', params: { date } })} />
        </Card>
      </Section>

      <Section title="More">
        <ListCard>
          <ListRow icon="pencil-plus-outline" title="Log sleep or a nap yourself" sub="For sleep your watch didn't record" onPress={() => router.push({ pathname: '/log-sleep', params: { date } })} />
          {a ? <ListRow icon="moon-waning-crescent" title="All nights" sub="Every night, newest first" onPress={() => router.navigate({ pathname: '/sleep', params: { view: 'nights' } })} /> : null}
        </ListCard>
      </Section>
    </Screen>
  );
}
