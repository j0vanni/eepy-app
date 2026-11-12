/**
 * Your calendar and tonight's plan: tomorrow's first event and what it does to the alarm and
 * lights-out, plus tonight's events that cut into the wind-down.
 *
 *   CalendarNote        Today: one quiet block that opens the Plan tab. Nothing when the calendar is off.
 *   PlanCalendarLines   Plan → Tonight in detail: the same lines as rows, or the row that turns the calendar on.
 */
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { EveningConflict, eveningConflicts, shortTitle } from '@/engine/calendarEvents';
import type { TonightPlan } from '@/engine/schedule';
import { formatDuration, formatTime } from '@/engine/time';
import { CalendarEvent, useEventsTonight, useFirstEventTomorrowDetails } from '@/state/calendar';
import { useStore } from '@/state/store';
import { Icon, styles as kit, ListRow } from '@/ui/components';
import { colors, font, iconSize, space } from '@/ui/theme';

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

const TONE = { info: colors.textDim, warn: colors.warn, good: colors.good };
const conflictIcon = (c: EveningConflict) => (c.kind === 'past-bedtime' ? 'weather-night' : 'timer-sand');

/** Today: tomorrow's first event in one line; an evening clash adds a line each. Opens the Plan tab. */
export function CalendarNote({ analysis }: { analysis: Analysis }) {
  const settings = useStore((s) => s.settings.calendar);
  const first = useFirstEventTomorrowDetails(settings);
  const conflicts = useEveningConflicts(analysis);
  if (!settings.enabled) return null;

  const summary = firstEventSummary(analysis.tonight, first);
  return (
    <Pressable
      onPress={() => router.push('/planner')}
      accessibilityRole="button"
      style={({ pressed }) => [kit.banner, { alignItems: 'flex-start' }, pressed ? { opacity: 0.75 } : null]}
    >
      <View style={{ marginTop: 1 }}>
        <Icon name="calendar-clock" size={iconSize.md - 2} color={conflicts.length ? colors.warn : TONE[summary.tone]} />
      </View>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={[font.small, { color: colors.text }]}>{summary.text}</Text>
        {conflicts.map((c) => (
          <Text key={c.event.id} style={font.small}>
            <Text style={{ color: colors.warn }}>{c.headline}</Text>
            {c.advice ? ` ${c.advice}` : ''}
          </Text>
        ))}
      </View>
      <Icon name="chevron-right" color={colors.textFaint} />
    </Pressable>
  );
}

/** Calendar rows for the Plan tab's "Tonight in detail", or the row that turns the calendar on. */
export function PlanCalendarLines({ analysis }: { analysis: Analysis }) {
  const settings = useStore((s) => s.settings.calendar);
  const first = useFirstEventTomorrowDetails(settings);
  const conflicts = useEveningConflicts(analysis);
  if (!settings.enabled) {
    return (
      <ListRow
        icon="calendar-sync"
        title="Plan around your calendar"
        sub="Let tomorrow’s first event set your alarm and bedtime"
        onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'you' } })}
      />
    );
  }
  const summary = firstEventSummary(analysis.tonight, first);
  return (
    <View>
      <ListRow icon="calendar-clock" iconColor={TONE[summary.tone]} title="Your calendar" sub={summary.text} />
      {conflicts.map((c) => (
        <View key={c.event.id}>
          <View style={kit.listSep} />
          <ListRow icon={conflictIcon(c)} iconColor={colors.warn} title={c.headline} sub={c.advice} />
        </View>
      ))}
    </View>
  );
}
