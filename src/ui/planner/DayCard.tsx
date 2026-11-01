/**
 * The day tapped in the Planner's week strip, in plain words ("Thursday: lights out 11:05 PM →
 * alarm 6:05 AM · 7h 10m sleep"), with the same controls as the month calendar.
 */
import { Text, View } from 'react-native';

import { formatDuration, formatTime, weekdayOfKey } from '@/engine/time';
import type { UpcomingNight } from '@/engine/weekPlan';
import { Card, Icon, Row } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

import { AdjustTonightButton, NightNotes, WakePlanPicker } from './DayPlan';
import { DAY_NAMES, morningKind, nightBefore, planLine } from './planText';
import { KIND_ICON } from './WeekStrip';

export function DayCard({ night, needMin, isTonight, skippedDate }: { night: UpcomingNight; needMin: number; isTonight: boolean; skippedDate?: string }) {
  const kind = morningKind(night, skippedDate);
  const label = dayLabel(night.wakeDate);
  const weekday = DAY_NAMES[weekdayOfKey(night.wakeDate)];
  const title = label === 'Today' || label === 'Tomorrow' ? `${label}, ${weekday}` : `${weekday} ${label.split(' ').slice(1).join(' ')}`;
  const meta = KIND_ICON[kind];
  const cycleTimed = !night.noAlarm && night.alarm !== undefined && Math.abs(night.alarm - night.wake) >= 60_000;
  return (
    <Card>
      <Text style={font.tiny}>{isTonight ? 'TONIGHT’S PLAN' : `${nightBefore(night.wakeDate).toUpperCase()} → ${weekday.toUpperCase()} MORNING`}</Text>
      <Text style={[font.h2, { marginTop: 2 }]}>{title}</Text>
      <Row gap={space.sm} style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
        <Icon name={meta.icon} size={20} color={meta.color} />
        <Text style={[font.body, { flex: 1, fontWeight: '600' }]}>{planLine(night, kind)}</Text>
      </Row>
      <Text style={[font.small, { marginTop: 4 }]}>
        {`${formatDuration(night.sleepMin)} sleep (you need ${formatDuration(needMin)}) · wind down from ${formatTime(night.windDownStart)}.`}
      </Text>
      {cycleTimed ? <Text style={[font.tiny, { marginTop: 4 }]}>{`The alarm is cycle-timed: it rings at the end of a sleep cycle, a little before your ${formatTime(night.wake)} wake-up, so you feel less groggy.`}</Text> : null}
      {kind === 'skipped' ? <Text style={[font.small, { marginTop: 4, color: colors.text }]}>You skipped this alarm — it comes back the morning after.</Text> : null}
      <View style={{ marginTop: space.sm }}>
        <NightNotes night={night} needMin={needMin} />
      </View>
      <Text style={[font.tiny, { marginTop: space.sm, marginBottom: 6 }]}>WAKE-UP THAT MORNING</Text>
      <WakePlanPicker date={night.wakeDate} />
      {isTonight ? <AdjustTonightButton /> : null}
    </Card>
  );
}
