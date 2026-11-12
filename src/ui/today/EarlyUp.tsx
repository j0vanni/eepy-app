/**
 * "I'm up" before this morning's alarm (state/earlyUp.ts): from 3am until the alarm, on the night view
 * and the morning, with or without a sleep session, on two-step mornings too. Then "Up at 4:42 AM ·
 * this morning's alarms are off" with Undo and "Change the time", for a few hours.
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
import { Button, Card, Chip, Divider, Row, Stepper } from '@/ui/components';
import { confirmHaptic, selectionTick } from '@/ui/haptics';
import { font, night as nightColors, space } from '@/ui/theme';

import { Caption, NIGHT_PANEL, NightButton } from './nightParts';

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
  const shortcuts = EARLIER.map((m) => ({ m, v: fit(initial - m * MINUTE) })).filter((x) => x.v < initial);
  return (
    <View>
      <Stepper label="Woke up at" sub="5-minute steps" value={formatTime(t)} onDec={() => move(t - 5 * MINUTE)} onInc={() => move(t + 5 * MINUTE)} />
      {shortcuts.length ? (
        <Row gap={space.sm} style={{ flexWrap: 'wrap', marginTop: space.xs }}>
          {shortcuts.map(({ m, v }) => (
            <Chip key={m} label={m === 60 ? '1 h earlier' : `${m} min earlier`} selected={t === v} onPress={() => move(v)} />
          ))}
        </Row>
      ) : null}
      <Row gap={space.sm} style={{ marginTop: space.md }}>
        <Button icon="check" label="Save" style={{ flex: 1 }} onPress={save} />
        <Button kind="ghost" label="Cancel" onPress={() => onDone()} />
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
  const panel = night ? NIGHT_PANEL : undefined;
  const main = night ? { color: nightColors.text } : null;

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
      <Card style={panel}>
        <Text style={[font.h2, main]}>Up at {formatTime(upAt)}</Text>
        <Text style={font.small}>{alarmsOff ? "This morning's alarms are off. " : ''}Get some daylight soon.</Text>
        {editing ? (
          <>
            <Divider spacing={space.sm} />
            <WakeTimeEditor initial={upAt} now={Math.max(now, Date.now())} onDone={() => setEditing(false)} />
          </>
        ) : (
          <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
            {/* Before the planned wake-up, Undo means going back to sleep: the alarms ring again. */}
            <Button small kind="secondary" icon="undo" label={now < planned ? 'Undo, back to sleep' : 'Undo'} disabled={busy} onPress={back} />
            <Button small kind="ghost" icon="clock-edit-outline" label="Woke earlier? Change the time" disabled={busy} onPress={() => setEditing(true)} />
          </Row>
        )}
      </Card>
    );
  }

  const offer = earlyUpOffer(a, settings, profile, now);
  if (!offer) return null;
  const alarms = offer.routineAt !== undefined ? `${formatTime(offer.routineAt)} and ${formatTime(offer.wakeAt)} alarms` : `${formatTime(offer.wakeAt)} alarm`;
  const what = offer.eepyAlarm ? `Ends the night and turns off this morning's ${alarms}.` : `Ends the night. Remember to turn off your own ${formatTime(offer.wakeAt)} alarm.`;
  const up = async () => {
    setBusy(true);
    confirmHaptic();
    setUndo(await imUpEarly(a, Date.now()).catch(() => undefined));
    setBusy(false);
  };
  return (
    <Card style={panel}>
      <Caption>Up before your alarm?</Caption>
      <Text style={[font.small, { marginTop: space.xs, marginBottom: space.md }]}>{what}</Text>
      {night ? <NightButton icon="weather-sunny" label="I'm up" disabled={busy} onPress={up} /> : <Button big icon="weather-sunny" label="I'm up" disabled={busy} onPress={up} />}
    </Card>
  );
}

/**
 * On the morning check-in until last night syncs: "You were up at 4:45 AM · Change" — or, with no
 * "I'm up" tapped, "Woke up before 6:00 AM? Set the time". Hidden while the "Up at …" card (with its
 * own change) is on Today, and once the night has synced (the night's own corrections take over).
 * A plain row: it sits inside the check-in panel.
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
    <View>
      {editing ? (
        <WakeTimeEditor initial={known ?? planned} now={now} onDone={() => setEditing(false)} />
      ) : (
        <Row gap={space.sm}>
          <Text style={[font.body, { flex: 1 }]}>{known !== undefined ? `You were up at ${formatTime(known)}.` : `Woke up before ${formatTime(planned)}?`}</Text>
          <Button small kind="secondary" icon="clock-edit-outline" label={known !== undefined ? 'Change' : 'Set the time'} onPress={() => setEditing(true)} />
        </Row>
      )}
      <Divider spacing={space.md} />
    </View>
  );
}
