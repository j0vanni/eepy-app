/**
 * Tonight on the Plan tab.
 *
 *   TonightHero     lights-out as the big number; under it wind-down and the alarm (on a two-step
 *                   morning the routine alarm, then when you are up for good), and a line when
 *                   tonight is not eepy's plan: an option in use, or your own times
 *   TonightDetails  one panel of rows: the alarm with Skip, the routine alarm for this morning,
 *                   why these times, your calendar, paying back debt, and the way to the wind-down
 *                   and the alarm settings
 */
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { BODY_CLOCK } from '@/engine/schedule';
import { formatDuration, formatTime, weekdayOfKey } from '@/engine/time';
import { useStore } from '@/state/store';
import { AlarmControl } from '@/ui/cards/AlarmControl';
import { PlanCalendarLines } from '@/ui/cards/CalendarNote';
import { Fold, Hero, Icon, KeyValue, styles as kit, ListCard, ListRow, Row, Section, Stat } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

import { nightNotes, NightNotes, RoutineChoice, useRoutineChoice } from './DayPlan';
import { Bullet } from './parts';
import { clockParts, DAY_NAMES, DAY_SHORT, morningWord, ordinal } from './planText';
import { hasRecovery, RecoveryFold } from './Recovery';

export function TonightHero({ a }: { a: Analysis }) {
  const t = a.tonight;
  const first = a.upcoming[0];
  const clock = clockParts(t.bedtime);
  const weekday = weekdayOfKey(t.wakeDate);
  const kind = morningWord(t);
  // One of "Options for tonight" in use, or your own times from "Adjust tonight".
  const choice = useStore((s) => (s.settings.tonight?.wakeDate === t.wakeDate ? s.settings.tonight.choice : undefined));
  const changed = choice
    ? `Using “${choice.title}” tonight.`
    : t.adjusted
      ? `Changed for tonight only. The plan was lights out ${formatTime(t.adjusted.plannedBedtime)}, up ${formatTime(t.adjusted.plannedWake)}.`
      : undefined;
  return (
    <Hero
      label="Lights out tonight"
      value={clock.value}
      unit={clock.unit}
      caption={`${formatDuration(first ? first.sleepMin : t.inBedMin)} of sleep · you need ${formatDuration(a.need.needMin)}`}
    >
      {changed ? <Text style={[font.small, { marginTop: space.xs }]}>{changed}</Text> : null}
      <Row style={{ marginTop: space.lg }}>
        <Stat label="Wind down" value={formatTime(t.windDownStart)} sub="lights low" />
        {t.noAlarm ? (
          <Stat label="Wake up" value={formatTime(t.wake)} sub={`${DAY_NAMES[weekday]} · no alarm`} />
        ) : t.twoStep ? (
          <>
            <Stat label="Routine alarm" value={formatTime(a.alarm.alarm)} sub="then back to bed" />
            <Stat label="Up" value={formatTime(t.wake)} sub={`${DAY_SHORT[weekday]} · ${kind}`} />
          </>
        ) : (
          <Stat label="Alarm" value={formatTime(a.alarm.alarm)} sub={`${DAY_NAMES[weekday]} · ${kind}`} />
        )}
      </Row>
    </Hero>
  );
}

/** The alarm in a sentence: which sleep cycle it ends, or why it stays where it is. */
function alarmSentence(a: Analysis): string | undefined {
  const t = a.tonight;
  if (t.noAlarm) return undefined;
  const target = formatTime(t.twoStep?.firstWake ?? t.wake);
  const line = a.alarm.onBoundary
    ? `The alarm rings at the end of your ${ordinal(a.alarm.cycles)} sleep cycle, in the 30 min before ${target}, so you wake less groggy (${a.cycleMin}-min cycles, about ${Math.round(a.latencyMin)} min to fall asleep).`
    : `No sleep cycle ends in the 30 min before ${target}, so the alarm stays at ${formatTime(a.alarm.alarm)}.`;
  return t.twoStep ? `${line} Then back to bed: the final alarm rings at ${formatTime(t.wake)}.` : line;
}

export function TonightDetails({ a }: { a: Analysis }) {
  const t = a.tonight;
  const first = a.upcoming[0];
  const calendarOn = useStore((s) => s.settings.calendar.enabled);
  const routine = useRoutineChoice(t.wakeDate);
  const alarm = alarmSentence(a);
  const notes = first ? nightNotes(first, a.need.needMin, a.advance?.rampMinPerNight ?? BODY_CLOCK.rampMinPerNight) : [];
  return (
    <Section title="Tonight in detail">
      <ListCard>
        <AlarmControl a={a} />
        {routine ? (
          <Row gap={space.md}>
            <View style={kit.listIcon}>
              <Icon name="weather-sunset-up" size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <RoutineChoice date={t.wakeDate} />
            </View>
          </Row>
        ) : null}
        {first && notes.length ? (
          <View style={{ paddingBottom: space.md }}>
            <NightNotes night={first} needMin={a.need.needMin} />
          </View>
        ) : null}
        <Fold bare icon="help-circle-outline" title="Why these times?">
          <View style={{ gap: space.sm }}>
            {t.rationale.map((r) => {
              const fromCalendar = !!t.calendar?.reasons.includes(r);
              return (
                <Bullet key={r} icon={fromCalendar ? 'calendar-clock' : 'circle-small'} color={fromCalendar ? colors.text : colors.textFaint} strong={fromCalendar}>
                  {r}
                </Bullet>
              );
            })}
            {alarm ? <Bullet icon="alarm">{alarm}</Bullet> : null}
          </View>
          <View style={{ marginTop: space.sm }}>
            <KeyValue label="Time in bed" value={formatDuration(t.inBedMin)} />
            <KeyValue label="Last big meal by" value={formatTime(t.lastMeal)} />
            <KeyValue label="Hard exercise done by" value={formatTime(t.lastExercise)} />
          </View>
        </Fold>
        {calendarOn ? <PlanCalendarLines analysis={a} /> : null}
        {hasRecovery(a.debt.debtMin) ? <RecoveryFold bare nights={a.upcoming} debtMin={a.debt.debtMin} /> : null}
        <ListRow icon="weather-night" title="Wind-down" sub={`From ${formatTime(t.windDownStart)}, step by step`} onPress={() => router.push('/winddown')} />
        <ListRow icon="cog-outline" title="Alarm settings" sub="Sound, watch buzz and backup" onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'alarms' } })} />
      </ListCard>
    </Section>
  );
}
