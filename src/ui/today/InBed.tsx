/**
 * The sleep session on Today and the wind-down screen (engine/inBed.ts, state/inBed.ts):
 * - `InBedButton`: the one big "I'm in bed" button (evening from wind-down, the night view, the
 *   wind-down screen, the rundown's last step) with the remembered "Start sleep sounds" switch.
 * - `SessionHeader`: the night view's top while the session runs — when you went to bed, the alarm,
 *   Undo for a couple of minutes, then "I'm up" / Cancel.
 * - `UpCard`: the morning's "I'm up", then "Up at 7:05 AM" with Undo.
 * - `TapsNightCard`: "Save last night" from your taps when no watch night arrived.
 * - `WindDownInBed`: the button, or the running session, on the wind-down screen.
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { usePlayback } from '@/audio/useSoundPlayer';
import type { Analysis } from '@/engine/analysis';
import { isOpen, justNow, sessionDetails, tapsLatencyMin, tapsNightOffer } from '@/engine/inBed';
import { formatDuration, formatTime, MINUTE, minutesOfDay } from '@/engine/time';
import { routineNow } from '@/notifications/fullScreenAlarm';
import { sleepSoundsLabel } from '@/notifications/sleepMode';
import { earlyUpOffer } from '@/state/earlyUp';
import { cancelInBedSession, dismissTapsNight, endInBedSession, inBedAvailable, saveTapsNight, sessionAlarm, sessionFor, startInBedSession, undoEndInBedSession } from '@/state/inBed';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { AppSwitch, Button, Card, CardTitle, Hero, Icon, Row } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { colors, font, night as nightColors, space, touch } from '@/ui/theme';

import { NightButton } from './nightParts';

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The session Today should show for this analysis (open, or ended a moment ago), with its alarm line. */
function useSession(a: Analysis) {
  const now = useNow(10_000);
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const playback = usePlayback();
  const s = sessionFor(settings.session, a);
  const details = s ? sessionDetails(s, sessionAlarm(a, settings, s, now), { soundsPlaying: playback.status === 'playing' }) : '';
  // During a two-step morning's routine the routine card is in charge (no "I'm up" by mistake).
  const routine = !!routineNow(a, settings, profile, now);
  // Before the alarm the early "I'm up" (which also turns the alarms off) is on screen too.
  const early = !!earlyUpOffer(a, settings, profile, now);
  return { s, now, details, routine, early };
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

/** Runs one of a session's actions, with the buttons disabled meanwhile. */
function useRun() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn().catch(() => undefined);
    setBusy(false);
  };
  return { busy, run };
}

/** "Start sleep sounds · Brown noise · 45 min" — the remembered switch under the button. */
function SoundsSwitch({ dim }: { dim?: boolean }) {
  const on = useStore((s) => s.settings.inBedSounds !== false);
  const audio = useStore((s) => s.settings.audio);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <Pressable
      onPress={() => setSettings({ inBedSounds: !on })}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch.comfy, marginTop: space.xs, paddingHorizontal: space.xs }}
    >
      <Icon name="music-note-outline" color={colors.textFaint} />
      <View style={{ flex: 1 }}>
        <Text style={[font.small, { color: dim ? nightColors.text : colors.text }]}>Start sleep sounds</Text>
        <Text style={font.tiny}>{sleepSoundsLabel(audio)}</Text>
      </View>
      <AppSwitch value={on} onChange={(v) => setSettings({ inBedSounds: v })} label="Start sleep sounds" />
    </Pressable>
  );
}

/**
 * The big "I'm in bed" button. `night` = on the true-black night view (amber text, no amber block);
 * `quiet` = another action on the screen is the main one right now (the rundown): an ordinary
 * button, without the line that says what it does.
 */
export function InBedButton({ a, night, quiet }: { a: Analysis; night?: boolean; quiet?: boolean }) {
  const { busy, start } = useStart(a);
  const autopilot = useStore((s) => s.settings.sleepMode.enabled);
  const label = busy ? 'Starting…' : "I'm in bed";
  return (
    <View style={{ marginBottom: space.md }}>
      {night ? (
        <NightButton icon="bed" label={label} disabled={busy} onPress={start} />
      ) : (
        <Button big={!quiet} kind={quiet ? 'secondary' : 'primary'} icon="bed" label={label} disabled={busy} onPress={start} />
      )}
      {quiet ? null : (
        <Text style={[font.tiny, { textAlign: 'center', marginTop: space.sm }]}>
          Sets your alarm from now{autopilot ? ', turns on sleep mode' : ''} and mutes tonight's reminders.
        </Text>
      )}
      <SoundsSwitch dim={night} />
    </View>
  );
}

/** Night view's top while a session runs (or just ended): what is set, with Undo, then "I'm up" / Cancel. */
export function SessionHeader({ a }: { a: Analysis }) {
  const { s, now, details, routine, early } = useSession(a);
  const { busy, run } = useRun();
  if (!s) return null;
  const ended = s.closed === 'up' && justNow(s.closedAt, now);
  if (!isOpen(s) && !ended) return null;
  const started = isOpen(s) && justNow(s.inBedAt, now);
  return (
    <View accessibilityLiveRegion="polite">
      <Hero
        dim
        label={ended ? 'Sleep session ended' : started ? 'Sleep session started' : 'Sleep session'}
        value={ended ? `Up at ${formatTime(s.upAt!)}` : `In bed since ${formatTime(s.inBedAt)}`}
        caption={ended ? undefined : cap(details)}
      >
        {started ? <Text style={[font.small, { color: nightColors.textDim, marginTop: space.xs }]}>Tonight's reminders are off. Sleep well.</Text> : null}
        {routine ? null : (
          <Row gap={space.sm} style={{ marginTop: space.lg }}>
            {started || ended ? (
              <Button kind="secondary" icon="undo" label="Undo" disabled={busy} style={{ flex: 1 }} onPress={() => run(ended ? undoEndInBedSession : cancelInBedSession)} />
            ) : (
              <>
                {/* With the early "I'm up" above (it also turns the alarms off), this one says what it does. */}
                <Button
                  kind="secondary"
                  icon="weather-sunny"
                  label={early ? 'End session' : "I'm up"}
                  disabled={busy}
                  style={{ flex: 1 }}
                  onPress={() => run(() => endInBedSession('today', a))}
                />
                <Button kind="ghost" label="Cancel" disabled={busy} onPress={() => run(cancelInBedSession)} />
              </>
            )}
          </Row>
        )}
      </Hero>
    </View>
  );
}

/** Morning (and the day, until it closes by itself): "I'm up", then "Up at 7:05 AM" with Undo. */
export function UpCard({ a }: { a: Analysis }) {
  const { s, now, details, routine } = useSession(a);
  const settings = useStore((st) => st.settings);
  const { busy, run } = useRun();
  if (!s || routine) return null;
  const ended = s.closed === 'up' && justNow(s.closedAt, now);
  if (!isOpen(s) && !ended) return null;
  if (ended) {
    // An alarm still to ring this morning rings (you can stop it then); say so.
    const alarm = sessionAlarm(a, settings, s, now);
    const still = alarm.state === 'set' && alarm.at !== undefined && alarm.at > now ? `your ${formatTime(alarm.at)} alarm still rings` : undefined;
    const bits = [s.sleepModeStopped !== undefined ? 'sleep mode off' : undefined, still].filter(Boolean).join(' · ');
    // Ended in the evening (still before lights-out): no "good morning".
    const morning = minutesOfDay(s.upAt!) >= 4 * 60 && minutesOfDay(s.upAt!) < 14 * 60;
    return (
      <Card>
        <Row gap={space.md}>
          <Icon name="check-circle-outline" size={22} color={colors.good} />
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>
              Up at {formatTime(s.upAt!)} · in bed {formatDuration((s.upAt! - s.inBedAt) / MINUTE)}
            </Text>
            <Text style={font.small}>
              {bits ? `${cap(bits)}. ` : ''}
              {morning ? 'Get some daylight soon.' : 'Sleep session ended.'}
            </Text>
          </View>
          <Button small kind="ghost" icon="undo" label="Undo" disabled={busy} onPress={() => run(undoEndInBedSession)} />
        </Row>
      </Card>
    );
  }
  return (
    <Card>
      <Text style={font.h3}>In bed since {formatTime(s.inBedAt)}</Text>
      <Text style={[font.small, { marginBottom: space.md }]}>
        {formatDuration((now - s.inBedAt) / MINUTE)} ago · {details}
      </Text>
      <Button big icon="weather-sunny" label="I'm up" disabled={busy} onPress={() => run(() => endInBedSession('today', a))} />
      <Text style={[font.tiny, { textAlign: 'center', marginTop: space.sm }]}>Turns sleep mode and sleep sounds off.</Text>
    </Card>
  );
}

/** "Save last night" from your taps — this morning's session, no watch night yet. */
export function TapsNightCard({ a }: { a: Analysis }) {
  const s = useStore((st) => st.settings.session);
  const night = tapsNightOffer(s, { day: a.day, lastNightIsCurrent: a.lastNightIsCurrent, latencyMin: a.latencyMin });
  if (!s || !night) return null;
  const lat = tapsLatencyMin(a.latencyMin);
  const asleep = (night.end - night.start) / MINUTE - lat;
  return (
    <Card>
      <CardTitle icon="bed-outline" title="Last night from your taps" color={colors.sleep} />
      <Text style={[font.h2, { fontVariant: ['tabular-nums'] }]}>
        In bed {formatTime(night.start)} → up {formatTime(night.end)}
      </Text>
      <Text style={[font.small, { marginTop: space.xs }]}>
        About {formatDuration(asleep)} asleep, allowing {lat} min to fall asleep. If your watch's night arrives later, it replaces this.
      </Text>
      <Row gap={space.sm} style={{ marginTop: space.md }}>
        <Button
          icon="content-save-outline"
          label="Save last night"
          style={{ flex: 1 }}
          onPress={() => {
            confirmHaptic();
            saveTapsNight(a);
          }}
        />
        <Button kind="ghost" label="Not now" onPress={dismissTapsNight} />
      </Row>
    </Card>
  );
}

/**
 * Wind-down screen: the button in the evening and at night, or the running session. `quiet` when
 * the rundown is the main action there.
 */
export function WindDownInBed({ a, quiet }: { a: Analysis; quiet?: boolean }) {
  const { s, details } = useSession(a);
  const profile = useStore((st) => st.profile);
  const now = useNow(30_000);
  if (s && isOpen(s)) {
    return (
      <Card>
        <Row gap={space.md}>
          <Icon name="moon-waning-crescent" size={22} color={colors.sleep} />
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>In bed since {formatTime(s.inBedAt)}</Text>
            <Text style={font.small}>{cap(details)}</Text>
          </View>
        </Row>
      </Card>
    );
  }
  if (!inBedAvailable(a, profile, now)) return null;
  return <InBedButton a={a} quiet={quiet} />;
}
