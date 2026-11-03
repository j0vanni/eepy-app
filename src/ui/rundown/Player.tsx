/**
 * "Start my rundown": the bedtime rundown one step at a time (engine/rundown.ts, state/rundown.ts).
 * Each step with what to do and why, a timer for timed steps (reading: how long until lights-out),
 * Done / Skip / Back and a progress bar; eepy's own screen stays dim. Once the phone is down the
 * screen-free steps move on by the clock, so nobody has to pick it up again before lights-out. The
 * last step is the big "I'm in bed" (state/inBed.ts startInBedSession). Progress is kept for
 * tonight (`settings.rundownProgress`): leave and come back, and it resumes.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Text, View } from 'react-native';

import { soundPlayer } from '@/audio/player';
import { usePlayback } from '@/audio/useSoundPlayer';
import type { Analysis } from '@/engine/analysis';
import { isOpen } from '@/engine/inBed';
import { canPickUp, playerPosition, Rundown, rundownGlance, RundownStep } from '@/engine/rundown';
import { screenTargetAt } from '@/engine/screenLight';
import { formatDuration, formatTime, MINUTE } from '@/engine/time';
import { dimEepy, getScreenBrightness, undimEepy } from '@/integrations/screen';
import { sleepSoundsLabel } from '@/notifications/sleepMode';
import { sessionFor } from '@/state/inBed';
import { backRundown, markRundown, resetRundownProgress, startRundown, useRundown } from '@/state/rundown';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { screenPlanFor } from '@/ui/cards/ScreenLightCard';
import { Button, Card, Empty, Icon, Meter, Note, Row } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { colors, font, space } from '@/ui/theme';
import { InBedButton, SessionHeader } from '@/ui/today/InBed';

const NIGHT_CARD = { backgroundColor: '#0A0E1C', borderColor: '#161C33' };
/** eepy's own brightness while the player is open: wind-down level, then night level once the phone is down. */
const DIM = { winddown: 0.3, night: 0.15 };

const clock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
const until = (ms: number) => formatDuration(Math.max(1, Math.ceil(ms / MINUTE)));

/** Dims eepy's window while the player is open (only if the phone is brighter); on leaving, back to what the evening dimming wants. */
function useDim(a: Analysis, night: boolean) {
  const dimTo = night ? DIM.night : DIM.winddown;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    getScreenBrightness().then((b) => {
      if (b === undefined || b > dimTo) dimEepy(dimTo);
    });
  }, [dimTo]);
  useEffect(
    () => () => {
      if (Platform.OS === 'web') return;
      const { settings } = useStore.getState();
      const phase = screenTargetAt(screenPlanFor(a, settings), Date.now()).phase;
      if (settings.screenDim && (phase === 'winddown' || phase === 'night')) dimEepy(phase === 'night' ? DIM.night : DIM.winddown);
      else undimEepy();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}

/** "10:30–10:40 PM · 10 min" or the moment's time. */
function when(s: RundownStep): string {
  if (s.kind === 'moment' || s.min === 0) return formatTime(s.at);
  return `${formatTime(s.at)}–${formatTime(s.end)} · ${s.min} min${s.shortened ? ` (set: ${s.setMin})` : ''}`;
}

const PHASE_LABEL: Record<RundownStep['phase'], string> = {
  evening: 'EVENING',
  winddown: 'WIND-DOWN',
  'phone-down': 'PHONE DOWN',
  'screen-free': 'SCREEN-FREE',
  'lights-out': 'LIGHTS OUT',
};

function Timer({ step, since, now, lightsOut }: { step: RundownStep; since: number; now: number; lightsOut: number }) {
  if (step.id === 'reading') {
    return (
      <View style={{ alignItems: 'center', marginTop: space.md }}>
        <Text style={font.label}>LIGHTS OUT IN</Text>
        <Text style={[font.stat, { fontSize: 44, lineHeight: 52, fontVariant: ['tabular-nums'], color: colors.text }]}>{until(lightsOut - now)}</Text>
        <Text style={font.small}>Read until {formatTime(step.end)} · lights out {formatTime(lightsOut)}</Text>
      </View>
    );
  }
  if (step.kind !== 'do' || step.min <= 0) return null;
  // The step's own clock from when it came up; once the phone is down, the schedule's (it moves on by itself).
  const end = step.phase === 'screen-free' ? step.end : since + step.min * MINUTE;
  const left = end - now;
  return (
    <View style={{ alignItems: 'center', marginTop: space.md }}>
      <Text style={[font.label, left < 0 ? { color: colors.warn } : null]}>{left >= 0 ? 'TIME LEFT' : "TIME'S UP"}</Text>
      <Text style={[font.stat, { fontSize: 44, lineHeight: 52, fontVariant: ['tabular-nums'], color: left >= 0 ? colors.text : colors.warn }]} accessibilityLiveRegion="polite">
        {left >= 0 ? clock(left) : `+${clock(-left)}`}
      </Text>
    </View>
  );
}

/** "Start sleep sounds" on the reading and relaxing steps (the "I'm in bed" tap leaves a playing sound alone). */
function SoundsNow() {
  const playback = usePlayback();
  const audio = useStore((s) => s.settings.audio);
  if (playback.status === 'playing') return <Text style={[font.tiny, { textAlign: 'center', marginTop: space.sm }]}>Sleep sounds playing</Text>;
  return (
    <View style={{ alignItems: 'center', marginTop: space.sm }}>
      <Button small kind="ghost" icon="music-note-outline" label={`Start sleep sounds · ${sleepSoundsLabel(audio)}`} onPress={() => void soundPlayer.play(audio)} />
    </View>
  );
}

function Intro({ a, r, now }: { a: Analysis; r: Rundown; now: number }) {
  const steps = r.routine;
  return (
    <>
      <Card style={NIGHT_CARD}>
        <Text style={font.label}>TONIGHT</Text>
        <Text style={[font.h2, { marginTop: 2 }]}>{rundownGlance(r)}</Text>
        <View style={{ marginTop: space.md, gap: 6 }}>
          {steps.map((s) => (
            <Row key={s.id} gap={space.sm}>
              <Icon name={s.icon} size={18} color={colors.textDim} />
              <Text style={[font.small, { flex: 1, color: colors.text }]}>{s.title}</Text>
              <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>{s.kind === 'moment' || s.min === 0 ? formatTime(s.at) : `${formatTime(s.at)} · ${s.min}m`}</Text>
            </Row>
          ))}
        </View>
        {r.note ? (
          <View style={{ marginTop: space.md }}>
            <Note tone="warn" icon="timer-sand">
              {r.note}
            </Note>
          </View>
        ) : null}
      </Card>
      <Button big icon="play-circle-outline" label="Start my rundown" onPress={() => startRundown(a, Date.now())} />
      {canPickUp(r, now) ? (
        <View style={{ alignItems: 'center', marginTop: space.sm }}>
          <Button small kind="ghost" label="Pick up from now (earlier steps skipped)" onPress={() => startRundown(a, Date.now(), true)} />
        </View>
      ) : null}
      <Text style={[font.tiny, { textAlign: 'center', marginTop: space.md }]}>
        One step at a time with a timer. Leave whenever you like — it remembers where you are tonight. Change the steps in Settings → Wind-down & phone light.
      </Text>
    </>
  );
}

export function RundownPlayer({ a }: { a: Analysis }) {
  const now = useNow(1000);
  const r = useRundown(a, now);
  const session = useStore((s) => sessionFor(s.settings.session, a));
  const since = useStore((s) => (s.settings.rundownProgress?.wakeDate === a.tonight.wakeDate ? s.settings.rundownProgress.since : now));
  const pos = r ? playerPosition(r) : undefined;
  const step = pos?.step;
  useDim(a, !!step && step.phase !== 'winddown');

  if (!r) {
    return (
      <Empty icon="format-list-checks" title="Your bedtime rundown is off" body="Turn it on in Settings → Wind-down & phone light to get your evening step by step.">
        <Button label="Open settings" onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'winddown' } })} />
      </Empty>
    );
  }
  if (session && isOpen(session)) {
    return (
      <>
        <SessionHeader a={a} />
        <Card style={NIGHT_CARD}>
          <Text style={[font.body, { color: colors.textDim, textAlign: 'center' }]}>Rundown done — sleep well.</Text>
        </Card>
        <Button kind="secondary" label="Close" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))} />
      </>
    );
  }
  if (!r.playing || !pos || !step) return <Intro a={a} r={r} now={now} />;

  const tap = (fn: () => void) => () => {
    confirmHaptic();
    fn();
  };
  const next = r.routine[pos.index + 1];
  const last = step.id === 'lights-out';
  const tint = step.phase === 'phone-down' ? colors.warn : step.phase === 'lights-out' ? colors.accent : colors.light;
  const ahead = !last && step.at - now > 2 * MINUTE ? `Planned for ${formatTime(step.at)} — you're ${until(step.at - now)} ahead.` : '';

  return (
    <>
      <View style={{ marginBottom: space.md }}>
        <Row gap={space.sm} style={{ marginBottom: 6 }}>
          <Text style={[font.label, { flex: 1 }]}>{`STEP ${pos.index + 1} OF ${pos.total} · ${PHASE_LABEL[step.phase]}`}</Text>
          <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>lights out {formatTime(r.lightsOut)}</Text>
        </Row>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: pos.total, now: pos.marked }}>
          <Meter value={pos.marked} max={pos.total} color={tint} height={6} />
        </View>
      </View>
      {r.late && r.note ? (
        <View style={{ marginBottom: space.md }}>
          <Note tone="warn" icon="timer-sand">
            {r.note}
          </Note>
        </View>
      ) : null}
      <Card style={NIGHT_CARD} animate={false}>
        <View style={{ alignItems: 'center' }}>
          <Icon name={step.icon} size={44} color={tint} />
          <Text style={[font.h1, { textAlign: 'center', marginTop: space.sm, color: colors.text }]} accessibilityRole="header">
            {step.title}
          </Text>
          <Text style={[font.small, { textAlign: 'center', marginTop: 2, fontVariant: ['tabular-nums'] }]}>{when(step)}</Text>
        </View>
        <Timer step={step} since={since} now={now} lightsOut={r.lightsOut} />
        <Text style={[font.body, { color: colors.textDim, marginTop: space.md }]}>{step.detail}</Text>
        {step.phase === 'phone-down' ? (
          <View style={{ marginTop: space.md }}>
            <Note tone="info" icon="clock-outline">
              eepy keeps time from here: the screen-free steps move on by the clock, and at {formatTime(r.lightsOut)} the lights-out reminder brings you back for "I'm in bed".
            </Note>
          </View>
        ) : null}
        {step.id === 'reading' || step.id === 'relax' ? <SoundsNow /> : null}
        {ahead ? <Text style={[font.tiny, { textAlign: 'center', marginTop: space.md }]}>{ahead}</Text> : null}
      </Card>

      {last ? (
        <InBedButton a={a} />
      ) : (
        <Row gap={space.sm}>
          <Button kind="ghost" icon="chevron-left" label="Back" disabled={pos.marked === 0} onPress={tap(() => backRundown(a, Date.now()))} />
          <Button kind="secondary" icon="skip-next-outline" label="Skip" onPress={tap(() => markRundown(a, 'skipped', Date.now()))} />
          <Button icon="check" label={step.phase === 'phone-down' ? 'Phone is down' : 'Done'} style={{ flex: 1 }} onPress={tap(() => markRundown(a, 'done', Date.now()))} />
        </Row>
      )}
      {last && pos.marked > 0 ? (
        <View style={{ alignItems: 'center', marginTop: space.sm }}>
          <Button small kind="ghost" icon="chevron-left" label="Back" onPress={tap(() => backRundown(a, Date.now()))} />
        </View>
      ) : null}
      {next ? (
        <Text style={[font.small, { textAlign: 'center', marginTop: space.md }]}>
          Up next: {next.title}
          {next.kind === 'do' && next.min > 0 ? ` · ${next.min} min` : ''} at {formatTime(next.at)}
        </Text>
      ) : null}
      <View style={{ alignItems: 'center', marginTop: space.lg }}>
        <Button small kind="ghost" icon="restart" label="Start over" onPress={resetRundownProgress} />
      </View>
    </>
  );
}
