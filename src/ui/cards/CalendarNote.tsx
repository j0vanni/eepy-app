// OWNER: calendar & workouts workstream. Today-screen note: tomorrow's first event and its effect on
// the alarm/bedtime, plus tonight's events that cut into the wind-down. Renders nothing when off.
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { EveningConflict, eveningConflicts, shortTitle } from '@/engine/calendarEvents';
import type { TonightPlan } from '@/engine/schedule';
import { formatDuration, formatTime } from '@/engine/time';
import { CalendarEvent, useEventsTonight, useFirstEventTomorrowDetails } from '@/state/calendar';
import { useStore } from '@/state/store';
import { Card, CardTitle, Icon, ListRow, Row } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

/** One-line summary of how tomorrow's first event shapes the plan. */
export function firstEventSummary(tonight: TonightPlan, first: CalendarEvent | undefined): { text: string; tone: 'info' | 'warn' | 'good' } {
  const cal = tonight.calendar;
  const start = first?.start ?? cal?.eventStart;
  if (start === undefined) return { text: `No timed events tomorrow morning — usual ${formatTime(tonight.wake)} wake-up.`, tone: 'good' };
  const title = shortTitle(first?.title ?? cal?.eventTitle);
  const what = `${title ? `“${title}”` : 'Your first event'} at ${formatTime(start)}`;
  // The engine may still be catching up with a just-changed event: only trust its verdict for this one.
  if (!cal || cal.eventStart !== start) return { text: `${what} tomorrow.`, tone: 'info' };
  if (!cal.fits) {
    const gap = Math.round((start - tonight.wake) / 60000);
    return {
      text: gap > 0 ? `${what} is only ${formatDuration(gap)} after your ${formatTime(tonight.wake)} wake-up.` : `${what} is before your ${formatTime(tonight.wake)} wake-up — set a separate alarm.`,
      tone: 'warn',
    };
  }
  if (!cal.drove) return { text: `${what} fits your usual ${formatTime(tonight.wake)} wake-up.`, tone: 'good' };
  const earlier = Math.round((cal.usualBedtime - tonight.bedtime) / 60000);
  const bed = `lights out ${formatTime(tonight.bedtime)}${earlier >= 10 ? ` (${formatDuration(earlier)} earlier)` : ''}`;
  if (cal.shortByMin > 0) {
    return { text: `${what}: alarm ${formatTime(tonight.wake)}, ${bed} — about ${formatDuration(cal.shortByMin)} short of your sleep need.`, tone: 'warn' };
  }
  return { text: `${what}: alarm moves to ${formatTime(tonight.wake)} (usually ${formatTime(cal.usualWake)}), ${bed}.`, tone: 'info' };
}

/** Tonight's events that cut into the wind-down or the night. */
export function useEveningConflicts(a: Analysis | undefined): EveningConflict[] {
  const settings = useStore((s) => s.settings.calendar);
  const events = useEventsTonight(settings);
  return a ? eveningConflicts(events, a.tonight, a.now) : [];
}

function Line({ icon, color, title, body, compact }: { icon: string; color: string; title: string; body?: string; compact?: boolean }) {
  return (
    <Row gap={space.sm} style={{ alignItems: 'flex-start', marginTop: compact ? 6 : space.sm }}>
      <Icon name={icon} color={color} size={compact ? 17 : 18} />
      <View style={{ flex: 1 }}>
        <Text style={compact ? [font.small, { color: colors.text }] : font.body}>{title}</Text>
        {body ? <Text style={[font.small, { marginTop: 2 }]}>{body}</Text> : null}
      </View>
    </Row>
  );
}

export function CalendarNote({ analysis }: { analysis: Analysis }) {
  const settings = useStore((s) => s.settings.calendar);
  const first = useFirstEventTomorrowDetails(settings);
  const conflicts = useEveningConflicts(analysis);
  if (!settings.enabled) return null;

  const summary = firstEventSummary(analysis.tonight, first);
  const toneColor = { info: colors.info, warn: colors.warn, good: colors.good }[summary.tone];
  return (
    <Card onPress={() => router.push('/plan')} accent={conflicts.length || summary.tone === 'warn' ? colors.warn : undefined}>
      <CardTitle icon="calendar-clock" title="Your calendar" right={<Icon name="chevron-right" color={colors.textFaint} />} />
      <Line icon="weather-sunset-up" color={toneColor} title={summary.text} />
      {conflicts.map((c) => (
        <Line key={c.event.id} icon={c.kind === 'past-bedtime' ? 'weather-night' : 'timer-sand'} color={colors.warn} title={c.headline} body={c.advice} />
      ))}
    </Card>
  );
}

/** Calendar lines for the Plan tab's Tonight card, or an entry to turn the calendar on. */
export function PlanCalendarLines({ analysis }: { analysis: Analysis }) {
  const settings = useStore((s) => s.settings.calendar);
  const first = useFirstEventTomorrowDetails(settings);
  const conflicts = useEveningConflicts(analysis);
  if (!settings.enabled) {
    return (
      <View style={{ marginTop: space.md, borderTopWidth: 1, borderTopColor: colors.border }}>
        <ListRow icon="calendar-sync" title="Plan around your calendar" sub="Let tomorrow’s first event set your alarm and bedtime" onPress={() => router.push('/settings')} />
      </View>
    );
  }
  const cal = analysis.tonight.calendar;
  // When the event set the plan, the rationale above already explains it.
  const explained = !!cal?.drove && (first === undefined || first.start === cal.eventStart);
  const summary = firstEventSummary(analysis.tonight, first);
  const toneColor = { info: colors.info, warn: colors.warn, good: colors.good }[summary.tone];
  return (
    <View style={{ marginTop: space.sm }}>
      {explained ? null : <Line compact icon="calendar-clock" color={toneColor} title={summary.text} />}
      {conflicts.map((c) => (
        <Line compact key={c.event.id} icon={c.kind === 'past-bedtime' ? 'weather-night' : 'timer-sand'} color={colors.warn} title={c.headline} body={c.advice} />
      ))}
    </View>
  );
}
