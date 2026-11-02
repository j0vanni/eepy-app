/**
 * "Your usual week": which days are workdays and when you wake up on workdays and other days.
 * The weekly pattern every coming night is planned from (single mornings can still be changed
 * in the week strip or the month view).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatClock, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { Button, Card, CardTitle, ListRow, Row, Stepper } from '@/ui/components';
import { Toggle } from '@/ui/settings/Toggle';
import { colors, font, radius, space } from '@/ui/theme';

import { DAY_NAMES, DAY_SHORT } from './planText';

/** Monday first, the way most people read a week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function UsualWeekCard() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const calendarOn = useStore((s) => s.settings.calendar.enabled);
  const freeAuto = profile.freeWakeMin === undefined;
  const freeWake = profile.freeWakeMin ?? profile.workWakeMin + 60;
  const workdays = profile.workdays;
  const toggleDay = (i: number) => setProfile({ workdays: workdays.includes(i) ? workdays.filter((x) => x !== i) : [...workdays, i].sort() });
  const otherDays = WEEK_ORDER.filter((d) => !workdays.includes(d));
  // Different wake-up times on different days (Profile.dayWake): e.g. Tuesdays 7:30, Thursdays 8:00.
  const ownTimes = profile.dayWake ?? {};
  const hasOwn = Object.keys(ownTimes).length > 0;
  const [perDay, setPerDay] = useState(hasOwn);
  const usualFor = (d: number) => (workdays.includes(d) ? profile.workWakeMin : freeWake);
  const setDay = (d: number, min: number) => setProfile({ dayWake: { ...ownTimes, [d]: normalizeMinutes(min) } });
  const resetDay = (d: number) => {
    const next = { ...ownTimes };
    delete next[d];
    setProfile({ dayWake: Object.keys(next).length ? next : undefined });
  };

  return (
    <Card>
      <CardTitle icon="calendar-week" title="Workdays and wake-up times" />
      <Text style={font.small}>Tap the days you have to be up at a fixed time (work, school, kids).</Text>
      <Row gap={4} style={{ marginTop: space.sm, marginBottom: space.sm }}>
        {WEEK_ORDER.map((i) => {
          const on = workdays.includes(i);
          return (
            <Pressable
              key={i}
              onPress={() => toggleDay(i)}
              style={({ pressed }) => [styles.day, on ? styles.dayOn : null, pressed ? { opacity: 0.7 } : null]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${DAY_NAMES[i]}: ${on ? 'workday' : 'not a workday'}`}
            >
              <Text style={[styles.dayText, on ? { color: '#140F33' } : null]}>{DAY_SHORT[i]}</Text>
            </Pressable>
          );
        })}
      </Row>
      <Stepper
        label="Workday wake-up"
        sub={workdays.length ? `${workdays.length} workday${workdays.length > 1 ? 's' : ''} a week` : 'No workdays picked'}
        value={formatClock(profile.workWakeMin)}
        onDec={() => setProfile({ workWakeMin: normalizeMinutes(profile.workWakeMin - 15) })}
        onInc={() => setProfile({ workWakeMin: normalizeMinutes(profile.workWakeMin + 15) })}
      />
      <Stepper
        label="Wake-up on other days"
        sub={freeAuto ? 'Automatic: 1 h after workdays' : otherDays.length ? otherDays.map((d) => DAY_SHORT[d]).join(', ') : 'Every day is a workday'}
        value={formatClock(freeWake)}
        onDec={() => setProfile({ freeWakeMin: normalizeMinutes(freeWake - 15) })}
        onInc={() => setProfile({ freeWakeMin: normalizeMinutes(freeWake + 15) })}
      />
      {!freeAuto ? (
        <View style={{ alignItems: 'flex-start' }}>
          <Button small kind="ghost" label="Back to automatic" onPress={() => setProfile({ freeWakeMin: undefined })} />
        </View>
      ) : null}
      <Toggle
        label="Different times on different days"
        sub="Up at 6:05 on Mondays but 7:30 on Tuesdays? Give each day its own time."
        value={perDay}
        onChange={(on) => {
          setPerDay(on);
          if (!on) setProfile({ dayWake: undefined });
        }}
      />
      {perDay ? (
        <View style={styles.perDay}>
          {WEEK_ORDER.map((d) => {
            const own = ownTimes[d];
            const value = own ?? usualFor(d);
            const kind = workdays.includes(d) ? 'workday' : 'day off';
            return (
              <View key={d}>
                <Stepper
                  label={DAY_NAMES[d]}
                  sub={own === undefined ? `${kind} · usual time` : `${kind} · its own time`}
                  value={formatClock(value)}
                  onDec={() => setDay(d, value - 15)}
                  onInc={() => setDay(d, value + 15)}
                />
                {own !== undefined ? (
                  <Pressable onPress={() => resetDay(d)} hitSlop={6} accessibilityRole="button" style={{ marginTop: -6, marginBottom: 4 }}>
                    <Text style={[font.tiny, { color: colors.accent }]}>Use the usual {kind} time ({formatClock(usualFor(d))})</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          <Text style={font.tiny}>Days you don't change keep the workday or day-off time above. A single date can still be changed in the week strip.</Text>
        </View>
      ) : null}
      <Text style={[font.tiny, { marginTop: space.sm }]}>
        eepy's alarm rings on other days too, just later — sleeping in more than an hour or so shifts your body clock. For a morning with no alarm at all, tap that day above and
        choose "Free day".
      </Text>
      <View style={{ marginTop: space.md, borderTopWidth: 1, borderTopColor: colors.border }}>
        <ListRow
          icon="calendar-sync"
          title={calendarOn ? 'Planning around your calendar' : 'Plan around your calendar'}
          sub={calendarOn ? 'An early first event moves that morning’s alarm earlier' : 'Let tomorrow’s first event set your alarm and bedtime'}
          onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'you' } })}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  day: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  dayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  perDay: { marginTop: space.xs, paddingLeft: space.sm, borderLeftWidth: 2, borderLeftColor: colors.accentSoft },
});
