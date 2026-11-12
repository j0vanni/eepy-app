/**
 * "Your usual week": which days are workdays and when you wake up on workdays and other days —
 * the weekly pattern every coming night is planned from. Under it, as rows: a time of its own for
 * single weekdays, two-step mornings, and planning around your calendar. (One date is changed in
 * the week above or the month view.)
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { formatClock, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { TwoStepMorningCard } from '@/ui/cards/TwoStepMorningCard';
import { Button, Card, ListCard, ListRow, Stepper } from '@/ui/components';
import { Toggle } from '@/ui/settings/Toggle';
import { font, space } from '@/ui/theme';

import { Caption, DayPicker, WEEK_ORDER } from './parts';
import { DAY_NAMES, DAY_SHORT } from './planText';

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
    <>
      <Card>
        <Caption>Workdays</Caption>
        <Text style={[font.small, { marginTop: space.xxs, marginBottom: space.md }]}>The days you have to be up at a fixed time.</Text>
        <DayPicker days={workdays} onToggle={toggleDay} short={DAY_SHORT} label={(d, on) => `${DAY_NAMES[d]}: ${on ? 'workday' : 'not a workday'}`} />
        <View style={{ marginTop: space.sm }}>
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
        </View>
        {!freeAuto ? (
          <View style={{ alignItems: 'flex-start' }}>
            <Button small kind="ghost" label="Back to automatic" onPress={() => setProfile({ freeWakeMin: undefined })} />
          </View>
        ) : null}
        <Text style={[font.tiny, { marginTop: space.sm }]}>Other days still get an alarm, just later. For no alarm at all, tap that day in the week above and choose “Free day”.</Text>
      </Card>

      <ListCard>
        <View>
          <Toggle
            label="Different times on different days"
            sub="Give single weekdays their own wake-up time."
            value={perDay}
            onChange={(on) => {
              setPerDay(on);
              if (!on) setProfile({ dayWake: undefined });
            }}
          />
          {perDay ? (
            <View style={{ paddingBottom: space.md }}>
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
                      <View style={{ alignItems: 'flex-start' }}>
                        <Button small kind="ghost" label={`Use the usual ${kind} time (${formatClock(usualFor(d))})`} onPress={() => resetDay(d)} />
                      </View>
                    ) : null}
                  </View>
                );
              })}
              <Text style={[font.tiny, { marginTop: space.xs }]}>Days you don't change keep the time above.</Text>
            </View>
          ) : null}
        </View>
        <TwoStepMorningCard embedded />
        <ListRow
          title={calendarOn ? 'Planning around your calendar' : 'Plan around your calendar'}
          sub={calendarOn ? 'An early first event moves that morning’s alarm earlier' : 'Let tomorrow’s first event set your alarm and bedtime'}
          onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'you' } })}
        />
      </ListCard>
    </>
  );
}
