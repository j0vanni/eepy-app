/**
 * The sleep session on Today and the wind-down screen (engine/inBed.ts, state/inBed.ts):
 * - `InBedButton`: the big "I'm in bed" button (evening from wind-down, the night view, wind-down screen)
 *   with the small "Start sleep sounds" switch (remembered).
 * - `SessionHeader`: the night view's top while the session runs — "Sleep session started 11:42 PM ·
 *   alarm 6:52 AM (5 cycles) · sleep mode on" with Undo for a couple of minutes, then "In bed since
 *   11:42 PM" with End session / Cancel.
 * - `UpCard`: the morning's "I'm up", then "Up at 7:05 AM" with Undo.
 * - `TapsNightCard`: "Save last night from your taps" when no watch night arrived.
 * - `WindDownInBed`: the button, or the running session, on the wind-down screen.
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { sleepSoundsLabel } from '@/notifications/sleepMode';
import { usePlayback } from '@/audio/useSoundPlayer';
import type { Analysis } from '@/engine/analysis';
import { isOpen, justNow, sessionDetails, tapsLatencyMin, tapsNightOffer } from '@/engine/inBed';
import { formatDuration, formatTime, MINUTE, minutesOfDay } from '@/engine/time';
import { routineNow } from '@/notifications/fullScreenAlarm';
import { cancelInBedSession, dismissTapsNight, endInBedSession, inBedAvailable, saveTapsNight, sessionAlarm, sessionFor, startInBedSession, undoEndInBedSession } from '@/state/inBed';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { AppSwitch, Button, Card, CardTitle, Icon, Row } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { colors, font, space } from '@/ui/theme';

const NIGHT_CARD = { backgroundColor: '#0A0E1C', borderColor: '#161C33' };
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The session Today should show for this analysis (open, or ended a moment ago), with its alarm line. */
function useSession(a: Analysis) {
  const now = useNow(10_000);
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const playback = usePlayback();
  const s = sessionFor(settings.session, a);
  const details = s ? sessionDetails(s, sessionAlarm(a, settings, s, now), { soundsPlaying: playback.status === 'playing' }) : '';
  // During a two-step morning's routine the routine card is in charge (no "End session" by mistake).
  const routine = !!routineNow(a, settings, profile, now);
  return { s, now, details, routine };
}

/** Starts the session, with a confirmation buzz. */
function useStart(a: Analysis) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    if (busy) return;
    setBusy(true);
    confirmHaptic();
    await startInBedSession(a).catch((e) => console.warn('in-bed start failed', e));
    setBusy(false);
  };
  return { busy, start };
}

/** "Start sleep sounds · Brown noise · 45 min" — the remembered switch under the button. */
function SoundsSwitch() {
  const on = useStore((s) => s.settings.inBedSounds !== false);
  const audio = useStore((s) => s.settings.audio);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <Pressable onPress={() => setSettings({ inBedSounds: !on })} accessibilityRole="switch" accessibilityState={{ checked: on }} style={{ marginTop: space.sm }}>
      <Row gap={space.sm}>
        <Icon name="music-note-outline" size={18} color={colors.textFaint} />
        <View style={{ flex: 1 }}>
          <Text style={font.small}>Start sleep sounds</Text>
          <Text style={font.tiny}>{sleepSoundsLabel(audio)}</Text>
        </View>
        <AppSwitch value={on} onChange={(v) => setSettings({ inBedSounds: v })} label="Start sleep sounds" />
      </Row>
    </Pressable>
  );
}

/** The big "I'm in bed" button. `night` = the dimmed night view. */
export function InBedButton({ a, night }: { a: Analysis; night?: boolean }) {
  const { busy, start } = useStart(a);
  const autopilot = useStore((s) => s.settings.sleepMode.enabled);
  return (
    <View style={{ marginTop: space.md }}>
      <Button big kind={night ? 'secondary' : 'primary'} icon="bed" label={busy ? 'Starting…' : "I'm in bed"} disabled={busy} onPress={start} />
      <Text style={[font.tiny, { textAlign: 'center', marginTop: 6 }]}>
        Times your alarm from now{autopilot ? ', turns on sleep mode' : ''} and quiets tonight's reminders
      </Text>
      <SoundsSwitch />
    </View>
  );
}

/** Night view's top while a session runs (or just ended): the confirmation with Undo, then End session / Cancel. */
export function SessionHeader({ a }: { a: Analysis }) {
  const { s, now, details, routine } = useSession(a);
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn().catch(() => undefined);
    setBusy(false);
  };
  const ended = s.closed === 'up' && justNow(s.closedAt, now);
  if (!isOpen(s) && !ended) return null;
  const started = isOpen(s) && justNow(s.inBedAt, now);
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.lg }} accessibilityLiveRegion="polite">
      <Icon name={ended ? 'weather-sunset-up' : 'moon-waning-crescent'} size={44} color={colors.light} />
      <Text style={[font.label, { marginTop: space.sm }]}>{ended ? 'SLEEP SESSION ENDED' : 'SLEEP SESSION'}</Text>
      <Text style={[font.h2, { color: colors.textDim, marginTop: 2, textAlign: 'center' }]}>
        {ended ? `Up at ${formatTime(s.upAt!)}` : started ? `Sleep session started ${formatTime(s.inBedAt)}` : `In bed since ${formatTime(s.inBedAt)}`}
      </Text>
      {!ended ? <Text style={[font.small, { textAlign: 'center', marginTop: 4 }]}>{cap(details)}</Text> : null}
      {started ? <Text style={[font.tiny, { textAlign: 'center', marginTop: 4 }]}>Tonight's reminders are off. Sleep well.</Text> : null}
      {routine ? null : (
        <Row gap={space.sm} style={{ marginTop: space.md }}>
          {started || ended ? (
            <Button small kind="ghost" icon="undo" label="Undo" disabled={busy} onPress={() => run(ended ? undoEndInBedSession : cancelInBedSession)} />
          ) : (
            <>
              <Button small kind="ghost" icon="stop-circle-outline" label="End session" disabled={busy} onPress={() => run(() => endInBedSession('today', a))} />
              <Button small kind="ghost" icon="close" label="Cancel" disabled={busy} onPress={() => run(cancelInBedSession)} />
            </>
          )}
        </Row>
      )}
    </View>
  );
}

/** Morning (and the day, until it closes by itself): "I'm up", then "Up at 7:05 AM" with Undo. */
export function UpCard({ a }: { a: Analysis }) {
  const { s, now, details, routine } = useSession(a);
  const settings = useStore((st) => st.settings);
  const [busy, setBusy] = useState(false);
  if (!s || routine) return null;
  const ended = s.closed === 'up' && justNow(s.closedAt, now);
  if (!isOpen(s) && !ended) return null;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn().catch(() => undefined);
    setBusy(false);
  };
  if (ended) {
    // An alarm still to ring this morning rings (you can stop it then); say so.
    const alarm = sessionAlarm(a, settings, s, now);
    const still = alarm.state === 'set' && alarm.at !== undefined && alarm.at > now ? `your ${formatTime(alarm.at)} alarm still rings` : undefined;
    const bits = [s.sleepModeStopped !== undefined ? 'sleep mode off' : undefined, still].filter(Boolean).join(' · ');
    // Ended in the evening (still before lights-out): no "good morning".
    const morning = minutesOfDay(s.upAt!) >= 4 * 60 && minutesOfDay(s.upAt!) < 14 * 60;
    return (
      <Card accent={colors.good}>
        <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <Icon name="check-circle-outline" size={22} color={colors.good} />
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>
              Up at {formatTime(s.upAt!)} · in bed {formatDuration((s.upAt! - s.inBedAt) / MINUTE)}
            </Text>
            <Text style={[font.small, { marginTop: 2 }]}>
              {bits ? `${cap(bits)}. ` : ''}
              {morning ? 'Good morning — get some daylight soon.' : 'Sleep session ended.'}
            </Text>
          </View>
        </Row>
        <View style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
          <Button small kind="ghost" icon="undo" label="Undo" disabled={busy} onPress={() => run(undoEndInBedSession)} />
        </View>
      </Card>
    );
  }
  return (
    <Card accent={colors.energy}>
      <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
        <Icon name="weather-sunset-up" size={22} color={colors.energy} />
        <View style={{ flex: 1 }}>
          <Text style={font.label}>SLEEP SESSION</Text>
          <Text style={[font.h2, { marginTop: 2 }]}>In bed since {formatTime(s.inBedAt)}</Text>
          <Text style={[font.small, { marginTop: 2 }]}>
            {formatDuration((now - s.inBedAt) / MINUTE)} ago · {details}
          </Text>
        </View>
      </Row>
      <View style={{ marginTop: space.md }}>
        <Button big icon="weather-sunny" label="I'm up" disabled={busy} onPress={() => run(() => endInBedSession('today', a))} />
        <Text style={[font.tiny, { textAlign: 'center', marginTop: 6 }]}>Ends the session: sleep mode off, sleep sounds stopped</Text>
      </View>
    </Card>
  );
}

/** "Save last night from your taps" — this morning's session, no watch night yet. */
export function TapsNightCard({ a }: { a: Analysis }) {
  const s = useStore((st) => st.settings.session);
  const night = tapsNightOffer(s, { day: a.day, lastNightIsCurrent: a.lastNightIsCurrent, latencyMin: a.latencyMin });
  if (!s || !night) return null;
  const lat = tapsLatencyMin(a.latencyMin);
  const asleep = (night.end - night.start) / MINUTE - lat;
  return (
    <Card accent={colors.accent}>
      <CardTitle icon="bed-outline" title="Last night from your taps" />
      <Text style={[font.h3, { fontVariant: ['tabular-nums'] }]}>
        In bed {formatTime(night.start)} → up {formatTime(night.end)}
      </Text>
      <Text style={[font.small, { marginTop: 4 }]}>
        ≈ {formatDuration(asleep)} asleep, allowing your usual {lat} min to fall asleep. Your watch's night hasn't arrived — if it does later, it replaces these times.
      </Text>
      <Row gap={space.sm} style={{ marginTop: space.md }}>
        <Button
          small
          icon="content-save-outline"
          label="Save last night"
          style={{ flex: 1 }}
          onPress={() => {
            confirmHaptic();
            saveTapsNight(a);
          }}
        />
        <Button small kind="ghost" label="Not now" onPress={dismissTapsNight} />
      </Row>
    </Card>
  );
}

/** Wind-down screen: the button in the evening and at night, or the running session. */
export function WindDownInBed({ a }: { a: Analysis }) {
  const { s, details } = useSession(a);
  const profile = useStore((st) => st.profile);
  const now = useNow(30_000);
  if (s && isOpen(s)) {
    return (
      <Card style={NIGHT_CARD}>
        <Row gap={space.sm}>
          <Icon name="moon-waning-crescent" size={20} color={colors.light} />
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>In bed since {formatTime(s.inBedAt)}</Text>
            <Text style={font.small}>{cap(details)}</Text>
          </View>
        </Row>
      </Card>
    );
  }
  if (!inBedAvailable(a, profile, now)) return null;
  return (
    <Card>
      <InBedButton a={a} />
    </Card>
  );
}

