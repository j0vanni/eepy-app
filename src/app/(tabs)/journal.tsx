import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { CAFFEINE_PRESETS } from '@/engine/caffeine';
import { TAGS } from '@/engine/tags';
import { addDays, atMinutes, dateKey, formatClock, formatDuration, formatTime, minutesOfDay, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Chip, Icon, ListRow, Row, Screen, Section, Stepper } from '@/ui/components';
import { dayLabel, nightLabel } from '@/ui/format';
import { colors, font, scoreColor, space } from '@/ui/theme';

const RATINGS = ['😫', '😕', '😐', '🙂', '😄'];
const ENERGY = ['Exhausted', 'Tired', 'OK', 'Good', 'Energised'];

export default function JournalScreen() {
  const today = dateKey(Date.now());
  const [date, setDate] = useState(today);
  const log = useStore((s) => s.dayLogs[date]);
  const logDay = useStore((s) => s.logDay);
  const toggleTag = useStore((s) => s.toggleTag);
  const caffeine = useStore((s) => s.caffeine);
  const addCaffeine = useStore((s) => s.addCaffeine);
  const removeCaffeine = useStore((s) => s.removeCaffeine);
  const a = useAnalysis();
  const [doseMin, setDoseMin] = useState(() => (date === today ? Math.round(minutesOfDay(Date.now()) / 5) * 5 : 9 * 60));

  const night = a?.nights.find((n) => n.wakeDate === date);
  const dayDoses = caffeine.filter((d) => dateKey(d.time) === date);
  const isToday = date === today;

  const changeDate = (d: string) => {
    setDate(d);
    setDoseMin(d === today ? Math.round(minutesOfDay(Date.now()) / 5) * 5 : 9 * 60);
  };

  return (
    <Screen title="Journal" subtitle="A few taps a day make every estimate personal">
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
        <Pressable onPress={() => changeDate(addDays(date, -1))} hitSlop={10} accessibilityLabel="Previous day">
          <Icon name="chevron-left" size={28} color={colors.text} />
        </Pressable>
        <Text style={font.h2}>{dayLabel(date)}</Text>
        <Pressable onPress={() => !isToday && changeDate(addDays(date, 1))} hitSlop={10} accessibilityLabel="Next day" style={{ opacity: isToday ? 0.3 : 1 }}>
          <Icon name="chevron-right" size={28} color={colors.text} />
        </Pressable>
      </Row>

      <Card>
        <CardTitle icon="weather-sunset-up" title="Morning" color={colors.energy} />
        {night?.main ? (
          <ListRow
            icon="bed-outline"
            title={`${nightLabel(night.wakeDate)}: ${formatDuration(night.main.totalSleepMin)}`}
            sub={`${formatTime(night.main.sleepOnset)} → ${formatTime(night.main.finalWake)}`}
            right={a?.scores[night.main.id] ? <Text style={[font.h3, { color: scoreColor(a.scores[night.main.id].total) }]}>{a.scores[night.main.id].total}</Text> : undefined}
            onPress={() => router.push({ pathname: '/night/[id]', params: { id: night.main!.id } })}
          />
        ) : (
          <Text style={[font.small, { marginBottom: space.sm }]}>No sleep recorded for this night yet.</Text>
        )}
        <Text style={[font.small, { marginTop: space.sm }]}>How well did you sleep?</Text>
        <Row gap={space.sm} style={{ marginTop: 6 }}>
          {RATINGS.map((r, i) => (
            <Pressable
              key={r}
              onPress={() => logDay(date, { sleepRating: i + 1 })}
              style={{ padding: 8, borderRadius: 12, backgroundColor: log?.sleepRating === i + 1 ? colors.accentSoft : 'transparent' }}
              accessibilityLabel={`Rate ${i + 1} of 5`}
            >
              <Text style={{ fontSize: 26 }}>{r}</Text>
            </Pressable>
          ))}
        </Row>
        <Text style={[font.small, { marginTop: space.md }]}>Did you wake up without an alarm?</Text>
        <Row gap={space.sm} style={{ marginTop: 6 }}>
          <Chip label="Yes, naturally" icon="weather-sunny" selected={log?.wokeNaturally === true} onPress={() => logDay(date, { wokeNaturally: true })} />
          <Chip label="Alarm / woken" icon="alarm" selected={log?.wokeNaturally === false} onPress={() => logDay(date, { wokeNaturally: false })} />
        </Row>
        <Text style={[font.tiny, { marginTop: 6 }]}>Natural wake-ups are the best evidence of how much sleep you really need.</Text>
      </Card>

      <Card>
        <CardTitle icon="lightning-bolt-outline" title="Daytime energy" color={colors.energy} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {ENERGY.map((e, i) => (
            <Chip key={e} label={`${i + 1} · ${e}`} selected={log?.energy === i + 1} onPress={() => logDay(date, { energy: i + 1 })} />
          ))}
        </View>
        <TextInput
          placeholder="Notes (optional)"
          placeholderTextColor={colors.textFaint}
          value={log?.note ?? ''}
          onChangeText={(note) => logDay(date, { note })}
          style={{ marginTop: space.md, color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, fontSize: 15 }}
          multiline
        />
      </Card>

      <Card>
        <CardTitle icon="tag-multiple-outline" title={isToday ? 'Today & this evening' : 'That day & evening'} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {TAGS.map((t) => (
            <Chip key={t.id} label={t.label} icon={t.icon} selected={log?.tags.includes(t.id)} onPress={() => toggleTag(date, t.id)} />
          ))}
        </View>
        <Text style={[font.tiny, { marginTop: space.sm }]}>Tags are matched to the night that follows, so eepy can learn what helps or hurts your sleep.</Text>
      </Card>

      <Card>
        <CardTitle icon="coffee-outline" title="Caffeine" color={colors.caffeine} right={<Text style={font.small}>{dayDoses.reduce((s, d) => s + d.mg, 0)} mg</Text>} />
        <Stepper label="Time" value={formatClock(doseMin)} onDec={() => setDoseMin(normalizeMinutes(doseMin - 15))} onInc={() => setDoseMin(normalizeMinutes(doseMin + 15))} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {CAFFEINE_PRESETS.map((p) => (
            <Chip
              key={p.label}
              label={`${p.label} · ${p.mg}`}
              onPress={() => addCaffeine({ id: `c-${Date.now()}-${p.mg}`, time: atMinutes(date, doseMin), mg: p.mg, label: p.label })}
            />
          ))}
        </View>
        {dayDoses.map((d) => (
          <Row key={d.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6 }}>
            <Text style={[font.body, { width: 56 }]}>{formatTime(d.time)}</Text>
            <Text style={[font.small, { flex: 1 }]}>
              {d.label} · {d.mg} mg
            </Text>
            <Pressable onPress={() => removeCaffeine(d.id)} hitSlop={8} accessibilityLabel="Remove drink">
              <Icon name="close" color={colors.textFaint} />
            </Pressable>
          </Row>
        ))}
      </Card>

      <Button label="Log sleep or a nap manually" icon="pencil-plus" kind="secondary" onPress={() => router.push({ pathname: '/log-sleep', params: { date } })} />

      {a ? (
        <Section title="Recent nights">
          <Card>
            {[...a.nights]
              .filter((n) => n.main)
              .reverse()
              .slice(0, 14)
              .map((n) => {
                const s = a.scores[n.main!.id];
                return (
                  <ListRow
                    key={n.wakeDate}
                    icon="bed-outline"
                    title={`${nightLabel(n.wakeDate)} · ${formatDuration(n.totalSleepMin)}`}
                    sub={`${formatTime(n.main!.sleepOnset)} → ${formatTime(n.main!.finalWake)}${n.naps.length ? ` · +${n.naps.length} nap` : ''}`}
                    right={s ? <Text style={[font.h3, { color: scoreColor(s.total) }]}>{s.total}</Text> : undefined}
                    onPress={() => router.push({ pathname: '/night/[id]', params: { id: n.main!.id } })}
                  />
                );
              })}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
