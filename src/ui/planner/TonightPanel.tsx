/**
 * The Planner's "Tonight": lights-out in big type, wind-down and alarm, one clear "Can't make it?"
 * button, the alarm (with Skip), and — folded — why these times were picked.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { formatDuration, formatTime, weekdayOfKey } from '@/engine/time';
import { AlarmControl } from '@/ui/cards/AlarmControl';
import { PlanCalendarLines } from '@/ui/cards/CalendarNote';
import { Card, Icon, Note, Row, Stat } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

import { AdjustTonightButton, NightNotes } from './DayPlan';
import { DAY_NAMES, ordinal } from './planText';

export function TonightPanel({ a }: { a: Analysis }) {
  const [why, setWhy] = useState(false);
  const t = a.tonight;
  const first = a.upcoming[0];
  const morning = `${DAY_NAMES[weekdayOfKey(t.wakeDate)]} morning`;
  const kind = t.noAlarm ? 'free day — no alarm' : t.isWorkday ? 'workday' : 'not a workday';
  return (
    <Card accent={colors.accent}>
      <Text style={font.label}>{`TONIGHT → ${morning.toUpperCase()} · ${kind.toUpperCase()}`}</Text>
      <Text style={[font.small, { marginTop: space.sm }]}>Lights out</Text>
      <Text style={[font.stat, { fontSize: 44, lineHeight: 52, color: colors.accent, fontVariant: ['tabular-nums'] }]}>{formatTime(t.bedtime)}</Text>
      <Row style={{ marginTop: space.sm }}>
        <Stat label="Wind down" value={formatTime(t.windDownStart)} sub="lights low" />
        <Stat
          label={t.noAlarm ? 'Wake up' : t.twoStep ? 'Routine alarm' : 'Alarm'}
          value={t.noAlarm ? formatTime(t.wake) : formatTime(a.alarm.alarm)}
          sub={t.noAlarm ? 'no alarm' : t.twoStep ? `then up ${formatTime(t.wake)}` : a.alarm.onBoundary ? 'cycle-timed' : undefined}
        />
        <Stat label="Sleep" value={first ? formatDuration(first.sleepMin) : formatDuration(t.inBedMin)} sub={`need ${formatDuration(a.need.needMin)}`} />
      </Row>

      {t.adjusted ? (
        <Note tone="info" icon="clock-edit-outline">
          {`Changed for tonight only — the plan was lights out ${formatTime(t.adjusted.plannedBedtime)}, up ${formatTime(t.adjusted.plannedWake)}.`}
        </Note>
      ) : null}
      <AdjustTonightButton primary />

      <AlarmControl a={a} />
      {!t.noAlarm ? (
        <Text style={[font.tiny, { marginTop: 6 }]}>
          {a.alarm.onBoundary
            ? `Rings at the end of your ${ordinal(a.alarm.cycles)} sleep cycle, in the 30 min before ${formatTime(t.twoStep?.firstWake ?? t.wake)}, so you wake less groggy (${a.cycleMin}-min cycles, ~${Math.round(a.latencyMin)} min to fall asleep).`
            : `No sleep cycle ends in the 30 min before ${formatTime(t.twoStep?.firstWake ?? t.wake)}, so the alarm stays at ${formatTime(a.alarm.alarm)}.`}
          {t.twoStep ? ` Then back to bed — the final alarm rings at ${formatTime(t.wake)}.` : ''}
        </Text>
      ) : null}
      <Pressable
        onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'alarms' } })}
        hitSlop={6}
        accessibilityRole="link"
        style={({ pressed }) => [{ marginTop: space.sm, minHeight: 32, justifyContent: 'center' }, pressed ? { opacity: 0.7 } : null]}
      >
        <Row gap={6}>
          <Icon name="cog-outline" size={16} color={colors.accent} />
          <Text style={[font.small, { color: colors.accent, fontWeight: '600', flex: 1 }]}>Alarm sound, watch buzz and backup</Text>
          <Icon name="chevron-right" size={18} color={colors.accent} />
        </Row>
      </Pressable>

      {first ? (
        <View style={{ marginTop: space.sm }}>
          <NightNotes night={first} needMin={a.need.needMin} />
        </View>
      ) : null}

      <Pressable
        onPress={() => setWhy(!why)}
        accessibilityRole="button"
        accessibilityState={{ expanded: why }}
        style={{ marginTop: space.sm, minHeight: 32, justifyContent: 'center' }}
        hitSlop={6}
      >
        <Row gap={4}>
          <Icon name="help-circle-outline" size={17} color={colors.accent} />
          <Text style={[font.small, { color: colors.accent, fontWeight: '600', flex: 1 }]}>Why these times?</Text>
          <Icon name={why ? 'chevron-up' : 'chevron-down'} size={18} color={colors.accent} />
        </Row>
      </Pressable>
      {why ? (
        <View style={{ marginTop: space.sm }}>
          {t.rationale.map((r) => {
            const fromCalendar = !!t.calendar?.reasons.includes(r);
            return (
              <Row key={r} gap={space.sm} style={{ alignItems: 'flex-start', marginTop: 4 }}>
                <Icon name={fromCalendar ? 'calendar-clock' : 'circle-small'} color={colors.accent} size={fromCalendar ? 17 : 20} />
                <Text style={[font.small, { flex: 1 }, fromCalendar ? { color: colors.text } : null]}>{r}</Text>
              </Row>
            );
          })}
          <Text style={[font.small, { marginTop: space.sm }]}>
            Time in bed {formatDuration(t.inBedMin)} · last big meal by {formatTime(t.lastMeal)} · hard exercise done by {formatTime(t.lastExercise)}.
          </Text>
        </View>
      ) : null}
      <PlanCalendarLines analysis={a} />
    </Card>
  );
}
