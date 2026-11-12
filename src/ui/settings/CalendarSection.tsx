// Settings → You & schedule → Calendar: access, prep time before the first event, which calendars.
import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';

import { formatClock, formatDuration, formatTime, MINUTE } from '../../engine/time';
import {
  CalendarAccess,
  calendarSupported,
  DeviceCalendar,
  effectiveCalendarIds,
  getCalendarAccess,
  invalidateCalendarCache,
  listDeviceCalendars,
  requestCalendarAccess,
  useFirstEventTomorrowDetails,
  usingDemoCalendar,
} from '../../state/calendar';
import { useStore } from '../../state/store';
import { Button, Fold, Icon, ListCard, ListRow, Note, Row, Section, Stepper } from '../components';
import { notify } from '../confirm';
import { colors, iconSize, space } from '../theme';
import { Para } from './parts';
import { Toggle } from './Toggle';

export const PREP_MIN = 15;
export const PREP_MAX = 180;

/** "1h", "45 min", "1h 30m". */
export function prepLabel(min: number): string {
  if (min < 60) return `${min} min`;
  return min % 60 === 0 ? `${min / 60}h` : formatDuration(min);
}

export function CalendarSection() {
  const cal = useStore((s) => s.settings.calendar);
  const dataMode = useStore((s) => s.settings.dataMode);
  const setCal = useStore((s) => s.setCalendarSettings);
  const [access, setAccess] = useState<CalendarAccess>();
  const [calendars, setCalendars] = useState<DeviceCalendar[]>();
  const [busy, setBusy] = useState(false);
  const first = useFirstEventTomorrowDetails(cal);
  const supported = calendarSupported();
  const demo = usingDemoCalendar();

  useEffect(() => {
    let cancelled = false;
    getCalendarAccess().then((a) => !cancelled && setAccess(a));
    return () => {
      cancelled = true;
    };
  }, [dataMode, cal.enabled]);

  useEffect(() => {
    let cancelled = false;
    if (!cal.enabled || access !== 'granted') {
      setCalendars(undefined);
      return;
    }
    listDeviceCalendars().then((c) => !cancelled && setCalendars(c));
    return () => {
      cancelled = true;
    };
  }, [cal.enabled, access, dataMode]);

  const toggle = async (on: boolean) => {
    if (!on) {
      setCal({ enabled: false });
      return;
    }
    setBusy(true);
    const a = await requestCalendarAccess();
    setBusy(false);
    setAccess(a);
    if (a === 'granted') {
      invalidateCalendarCache();
      setCal({ enabled: true });
    } else if (a === 'unsupported') {
      notify('Calendar needs the app', 'Calendar access works in the Android app (not in the browser or Expo Go).');
    } else if (a === 'blocked') {
      notify('Calendar access is blocked', 'Allow Calendar for eepy in Android Settings → Apps → eepy → Permissions, then turn this on again.');
    } else {
      notify('Calendar access is off', 'eepy needs to read your calendar to plan around tomorrow’s first event.');
    }
  };

  const selected = calendars ? effectiveCalendarIds(cal.calendarIds, calendars) : cal.calendarIds;
  const isOn = (id: string) => selected.length === 0 || selected.includes(id);
  const toggleCalendar = (id: string) => {
    if (!calendars) return;
    const current = selected.length === 0 ? calendars.map((c) => c.id) : selected;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    if (next.length === 0) {
      notify('Keep at least one', 'To stop using your calendar, turn off "Use my calendar" instead.');
      return;
    }
    invalidateCalendarCache();
    // Everything selected is stored as "all", so calendars added later are included too.
    setCal({ calendarIds: next.length === calendars.length ? [] : next });
  };

  const prepRounded = Math.round(cal.prepMin / 15) * 15;
  const upBy = first ? Math.floor((first.start - cal.prepMin * MINUTE) / (5 * MINUTE)) * 5 * MINUTE : undefined;
  const lostAccess = cal.enabled && (access === 'denied' || access === 'blocked');

  return (
    <>
      <Section title="Calendar">
        {lostAccess ? (
          <>
            <Note tone="warn">Calendar permission was turned off, so eepy can’t see your events.</Note>
            <Row gap={space.sm} style={{ flexWrap: 'wrap', marginBottom: space.md }}>
              {access === 'denied' ? <Button small kind="secondary" icon="calendar-check" label="Allow calendar" onPress={() => toggle(true)} /> : null}
              {Platform.OS !== 'web' ? <Button small kind="secondary" icon="cog-outline" label="Open Android settings" onPress={() => Linking.openSettings()} /> : null}
            </Row>
          </>
        ) : null}
        <ListCard>
          <Toggle label="Use my calendar" sub={busy ? 'Asking for access…' : 'Tomorrow’s first event sets your alarm and bedtime'} value={cal.enabled} onChange={toggle} />
          {cal.enabled ? (
            <Stepper
              label="Time before my first event"
              sub="Getting ready, breakfast, commute"
              value={prepLabel(prepRounded)}
              onDec={() => setCal({ prepMin: Math.max(PREP_MIN, prepRounded - 15) })}
              onInc={() => setCal({ prepMin: Math.min(PREP_MAX, prepRounded + 15) })}
            />
          ) : null}
          {cal.enabled ? (
            first && upBy !== undefined ? (
              <ListRow title={`Tomorrow: “${first.title || 'Event'}” at ${formatTime(first.start)}`} sub={`eepy makes sure you’re up by ${formatTime(upBy)}`} />
            ) : (
              <ListRow title="No timed events tomorrow" sub="Your usual wake-up applies" />
            )
          ) : null}
          <Fold bare title="What eepy reads">
            <Para first>Only event times and titles, on this phone. All-day events and invitations you declined are ignored.</Para>
            <Para>Tomorrow’s first event sets your alarm and bedtime. Late events tonight get flagged.</Para>
          </Fold>
        </ListCard>
        {!supported ? (
          <Note tone="info" icon="cellphone">
            Calendar access works in the Android app. In the browser, load the demo data to try it with sample events.
          </Note>
        ) : null}
        {demo ? (
          <Note tone="info" icon="flask-outline">
            Demo: {cal.enabled ? 'showing' : 'turn this on to try it with'} sample events (dinner tonight, a {formatClock(7 * 60 + 30)} stand-up tomorrow). On your phone eepy reads your real calendars.
          </Note>
        ) : null}
      </Section>

      {cal.enabled && calendars && calendars.length > 0 ? (
        <Section title="Calendars to read">
          <ListCard>
            {calendars.map((c) => (
              <ListRow
                key={c.id}
                icon="calendar-blank"
                iconColor={c.color ?? colors.textDim}
                title={c.title}
                sub={c.account}
                onPress={() => toggleCalendar(c.id)}
                right={<Icon name={isOn(c.id) ? 'checkbox-marked' : 'checkbox-blank-outline'} color={isOn(c.id) ? colors.accent : colors.textFaint} size={iconSize.lg} />}
              />
            ))}
          </ListCard>
        </Section>
      ) : cal.enabled && calendars && access === 'granted' ? (
        <Note tone="info">No calendars found on this phone. Add an account in your calendar app first.</Note>
      ) : null}
    </>
  );
}
