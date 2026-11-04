/**
 * "I'm up" before this morning's alarm (state/earlyUp.ts): from 3am until the alarm, on the night view
 * and the morning, with or without a sleep session, on two-step mornings too. Then "Up at 4:42 AM —
 * this morning's 5:00 AM and 6:00 AM alarms are off" with Undo, for a few hours.
 */
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { dateKey, formatTime } from '@/engine/time';
import type { Profile } from '@/engine/types';
import { WAKE_FINAL_SKIP_MARK } from '@/notifications/fullScreenAlarm';
import { EarlyUpUndo, earlyUpConfirmShows, earlyUpOffer, imUpEarly, undoEarlyUp, upEarlyAt } from '@/state/earlyUp';
import { Settings, useStore } from '@/state/store';
import { Button, Card, Icon, Row } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { colors, font, space } from '@/ui/theme';

const NIGHT_CARD = { backgroundColor: '#0A0E1C', borderColor: '#161C33' };

/** Whether Today shows the early "I'm up" (or its confirmation) right now. */
export function earlyUpShows(a: Analysis, settings: Settings, profile: Profile, now: number): boolean {
  return earlyUpConfirmShows(upEarlyAt(settings, now), now) || !!earlyUpOffer(a, settings, profile, now);
}

export function EarlyUpCard({ a, now, night }: { a: Analysis; now: number; night?: boolean }) {
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<EarlyUpUndo>();
  const upAt = upEarlyAt(settings, now);

  if (earlyUpConfirmShows(upAt, now)) {
    const alarmsOff = settings.marks[WAKE_FINAL_SKIP_MARK] === dateKey(upAt);
    const back = async () => {
      setBusy(true);
      // After a restart the details are gone: put back what "I'm up" could have changed this morning.
      const fallback: EarlyUpUndo = { upAt, date: dateKey(upAt), marks: {}, sessionEnded: settings.session?.closed === 'up' && settings.session.upAt === upAt };
      await undoEarlyUp(undo ?? fallback, a).catch(() => undefined);
      setUndo(undefined);
      setBusy(false);
    };
    return (
      <Card accent={colors.good}>
        <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <Icon name="weather-sunset-up" size={22} color={colors.energy} />
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>Up at {formatTime(upAt)}</Text>
            <Text style={[font.small, { marginTop: 2 }]}>
              {alarmsOff ? "This morning's alarms are off. " : ''}Good morning — get some daylight soon.
            </Text>
          </View>
        </Row>
        <View style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
          <Button small kind="ghost" icon="undo" label="Undo — I'm going back to sleep" disabled={busy} onPress={back} />
        </View>
      </Card>
    );
  }

  const offer = earlyUpOffer(a, settings, profile, now);
  if (!offer) return null;
  const alarms = offer.routineAt !== undefined ? `${formatTime(offer.routineAt)} and ${formatTime(offer.wakeAt)} alarms` : `${formatTime(offer.wakeAt)} alarm`;
  const what = offer.eepyAlarm
    ? `Ends the night and turns off this morning's ${alarms}.`
    : `Ends the night — remember to turn off your own ${formatTime(offer.wakeAt)} alarm.`;
  const up = async () => {
    setBusy(true);
    confirmHaptic();
    setUndo(await imUpEarly(a, Date.now()).catch(() => undefined));
    setBusy(false);
  };
  return (
    <Card style={night ? NIGHT_CARD : undefined} accent={night ? '#1F2647' : colors.energy}>
      <Text style={font.label}>UP BEFORE YOUR ALARM?</Text>
      <Text style={[font.small, { marginTop: 4 }]}>{what}</Text>
      <View style={{ marginTop: space.md }}>
        <Button big kind={night ? 'secondary' : 'primary'} icon="weather-sunny" label="I'm up" disabled={busy} onPress={up} />
      </View>
    </Card>
  );
}
