/**
 * "I'm up" before this morning's alarm (state/earlyUp.ts): from 3am until the alarm, on the night view
 * and the morning, with or without a sleep session, on two-step mornings too. Then "Up at 4:42 AM —
 * this morning's 5:00 AM and 6:00 AM alarms are off" with Undo, for a few hours.
 */
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { wakeTargetFor } from '@/engine/schedule';
import { atMinutes, dateKey, formatTime, MINUTE } from '@/engine/time';
import type { Profile } from '@/engine/types';
import { WAKE_FINAL_SKIP_MARK } from '@/notifications/fullScreenAlarm';
import { EarlyUpUndo, earlyUpConfirmShows, earlyUpOffer, imUpEarly, setMorningWakeTime, undoEarlyUp, upEarlyAt, wakeTimeRange } from '@/state/earlyUp';
import { Settings, useStore } from '@/state/store';
import { Button, Card, Chip, Icon, Row, Stepper } from '@/ui/components';
import { confirmHaptic, selectionTick } from '@/ui/haptics';
import { colors, font, space } from '@/ui/theme';

const NIGHT_CARD = { backgroundColor: '#0A0E1C', borderColor: '#161C33' };

/** Whether Today shows the early "I'm up" (or its confirmation) right now. */
export function earlyUpShows(a: Analysis, settings: Settings, profile: Profile, now: number): boolean {
  return earlyUpConfirmShows(upEarlyAt(settings, now), now) || !!earlyUpOffer(a, settings, profile, now);
}

const EARLIER = [15, 30, 60];

/**
 * "Woke up at [−] 4:30 AM [+]" with 15 / 30 / 60 min earlier shortcuts — for a wake-up earlier than
 * you tapped "I'm up" (or one you never tapped). Saves with state/earlyUp.setMorningWakeTime.
 */
export function WakeTimeEditor({ initial, now, onDone }: { initial: number; now: number; onDone: (saved?: number) => void }) {
  const settings = useStore((s) => s.settings);
  const { min, max } = wakeTimeRange(settings, now);
  const fit = (t: number) => Math.min(max, Math.max(min, t));
  const [t, setT] = useState(() => fit(initial));
  const move = (v: number) => {
    selectionTick();
    setT(fit(v));
  };
  const save = () => {
    confirmHaptic();
    onDone(setMorningWakeTime(t, now));
  };
  return (
    <View style={{ marginTop: space.sm }}>
      <Stepper label="Woke up at" sub="5-minute steps" value={formatTime(t)} onDec={() => move(t - 5 * MINUTE)} onInc={() => move(t + 5 * MINUTE)} />
      <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
        {EARLIER.map((m) => {
          const v = fit(initial - m * MINUTE);
          return v < initial ? <Chip key={m} label={m === 60 ? '1 h earlier' : `${m} min earlier`} selected={t === v} onPress={() => move(v)} /> : null;
        })}
      </Row>
      <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
        <Button small icon="check" label="Save" onPress={save} />
        <Button small kind="ghost" label="Cancel" onPress={() => onDone()} />
      </Row>
    </View>
  );
}

export function EarlyUpCard({ a, now, night }: { a: Analysis; now: number; night?: boolean }) {
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<EarlyUpUndo>();
  const [editing, setEditing] = useState(false);
  const upAt = upEarlyAt(settings, now);

  const planned = atMinutes(dateKey(now), wakeTargetFor(profile, dateKey(now)).wakeMin);
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
        {editing ? (
          <WakeTimeEditor initial={upAt} now={Math.max(now, Date.now())} onDone={() => setEditing(false)} />
        ) : (
          <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
            <Button small kind="ghost" icon="clock-edit-outline" label="Woke up earlier? Change time" disabled={busy} onPress={() => setEditing(true)} />
            <Button small kind="ghost" icon="undo" label={now < planned ? "Undo — I'm going back to sleep" : 'Undo'} disabled={busy} onPress={back} />
          </Row>
        )}
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

/**
 * On the morning check-in until last night syncs: "Up at 4:45 AM · Change" — or, with no "I'm up"
 * tapped, "Woke up before 6:00 AM? Set the time". Hidden while the "Up at …" card (with its own
 * Change) is on Today, and once the night has synced (the night's own corrections take over).
 */
export function MorningWakeRow({ a, now }: { a: Analysis; now: number }) {
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const [editing, setEditing] = useState(false);
  if (a.lastNightIsCurrent) return null;
  const upAt = upEarlyAt(settings, now);
  if (earlyUpConfirmShows(upAt, now)) return null;
  const s = settings.session;
  const sessionUp = s?.closed === 'up' && s.upAt !== undefined && dateKey(s.upAt) === dateKey(now) ? s.upAt : undefined;
  const known = upAt ?? sessionUp;
  const planned = atMinutes(dateKey(now), wakeTargetFor(profile, dateKey(now)).wakeMin);
  if (known === undefined && now < planned) return null;
  return (
    <View style={{ marginBottom: space.md }}>
      <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
        <Text style={[font.small, { color: colors.text, flex: 1, minWidth: 160 }]}>
          {known !== undefined ? `You were up at ${formatTime(known)}.` : `Woke up before ${formatTime(planned)}?`}
        </Text>
        {editing ? null : (
          <Button small kind="ghost" icon="clock-edit-outline" label={known !== undefined ? 'Change' : 'Set the time'} onPress={() => setEditing(true)} />
        )}
      </Row>
      {editing ? <WakeTimeEditor initial={known ?? planned} now={now} onDone={() => setEditing(false)} /> : null}
    </View>
  );
}

