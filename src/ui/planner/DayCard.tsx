/**
 * The day tapped in the Plan tab's week, in plain words ("Lights out 11:05 PM → alarm 6:05 AM"),
 * why the night is what it is, and the wake-up choice for that morning.
 */
import { Text, View } from 'react-native';

import { formatDuration, formatTime, weekdayOfKey } from '@/engine/time';
import type { UpcomingNight } from '@/engine/weekPlan';
import { Card, Divider, Icon, Row } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { font, iconSize, space } from '@/ui/theme';

import { AdjustTonightButton, NightNotes, WakePlanPicker } from './DayPlan';
import { Caption } from './parts';
import { DAY_NAMES, morningKind, nightBefore, planLine } from './planText';
import { KIND_ICON } from './WeekStrip';

export function DayCard({ night, needMin, isTonight, skippedDate }: { night: UpcomingNight; needMin: number; isTonight: boolean; skippedDate?: string }) {
  const kind = morningKind(night, skippedDate);
  const label = dayLabel(night.wakeDate);
  const weekday = DAY_NAMES[weekdayOfKey(night.wakeDate)];
  const title = label === 'Today' || label === 'Tomorrow' ? `${label}, ${weekday}` : `${weekday} ${label.split(' ').slice(1).join(' ')}`;
  const meta = KIND_ICON[kind];
  const cycleTimed = !night.noAlarm && night.alarm !== undefined && Math.abs(night.alarm - night.wake) >= 60_000;
  const why =
    kind === 'skipped'
      ? 'You skipped this alarm. It comes back the morning after.'
      : night.twoStep
        ? `The routine alarm (${formatTime(night.alarm ?? night.twoStep.firstWake)}) rings at the end of a sleep cycle. After your routine it is back to bed until the final alarm at ${formatTime(night.wake)}.`
        : cycleTimed
          ? `The alarm rings at the end of a sleep cycle, a little before your ${formatTime(night.wake)} wake-up, so you feel less groggy.`
          : undefined;
  return (
    <Card>
      <Caption>{isTonight ? 'Tonight' : `${nightBefore(night.wakeDate)} → ${weekday} morning`}</Caption>
      <Text style={[font.h2, { marginTop: space.xxs }]}>{title}</Text>
      <Row gap={space.sm} style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
        <View style={{ marginTop: 1 }}>
          <Icon name={meta.icon} size={iconSize.md} color={meta.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={font.body}>{planLine(night, kind)}</Text>
          <Text style={font.small}>{`${formatDuration(night.sleepMin)} of sleep · you need ${formatDuration(needMin)} · wind down from ${formatTime(night.windDownStart)}`}</Text>
        </View>
      </Row>
      {why ? <Text style={[font.small, { marginTop: space.sm }]}>{why}</Text> : null}
      <NightNotes night={night} needMin={needMin} />
      <Divider spacing={space.lg} />
      <View style={{ marginBottom: space.sm }}>
        <Caption>Wake-up that morning</Caption>
      </View>
      <WakePlanPicker date={night.wakeDate} />
      {isTonight ? <AdjustTonightButton /> : null}
    </Card>
  );
}
