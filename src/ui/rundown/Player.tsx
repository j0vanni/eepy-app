/**
 * "Start my rundown": the bedtime rundown one step at a time (engine/rundown.ts, state/rundown.ts).
 * One step on a black screen: what it is, a timer for timed steps (reading: how long until
 * lights-out), what to do and why, then Done with Back and Skip under it, and a thin progress bar
 * on top. eepy's own screen stays dim. Once the phone is down the screen-free steps move on by the
 * clock, so nobody has to pick it up again before lights-out. The last step is the big "I'm in bed"
 * (state/inBed.ts startInBedSession). Progress is kept for tonight (`settings.rundownProgress`):
 * leave and come back, and it resumes.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Text, View } from 'react-native';

import { soundPlayer } from '@/audio/player';
import { usePlayback } from '@/audio/useSoundPlayer';
import type { Analysis } from '@/engine/analysis';
import { isOpen } from '@/engine/inBed';
import { canPickUp, playerPosition, Rundown, rundownGlance, RundownStep } from '@/engine/rundown';
import { EEPY_DIM as DIM, screenTargetAt } from '@/engine/screenLight';
import { formatDuration, formatTime, MINUTE } from '@/engine/time';
import { dimEepy, getScreenBrightness, setEepyBrightness, undimEepy } from '@/integrations/screen';
import { sleepSoundsLabel } from '@/notifications/sleepMode';
import { sessionFor } from '@/state/inBed';
import { backRundown, markRundown, resetRundownProgress, startRundown, useRundown } from '@/state/rundown';
import { eepyDimOn, eepyWindowMode } from '@/state/screenDim';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { screenPlanFor } from '@/ui/cards/ScreenLightCard';
import { Button, Empty, Hero, Icon, Meter, Row, Timeline } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { colors, font, night, space } from '@/ui/theme';
import { InBedButton, SessionHeader } from '@/ui/today/InBed';
import { Caption, NightButton } from '@/ui/today/nightParts';

const clock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
const until = (ms: number) => formatDuration(Math.max(1, Math.ceil(ms / MINUTE)));
const openSettings = () => router.push({ pathname: '/settings/[section]', params: { section: 'winddown' } });

/**
 * eepy's own brightness while the player is open: wind-down level, then night level once the phone
 * is down (only if the phone is brighter); on leaving, back to what the evening dimming wants.
 */
function useDim(a: Analysis, late: boolean) {
  const dimTo = late ? DIM.night : DIM.winddown;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    // "Brighter" (or the setting off) wins here too.
    if (!eepyDimOn(useStore.getState().settings, Date.now())) return;
    getScreenBrightness().then((b) => {
      if (b === undefined || b > dimTo) dimEepy(dimTo);
    });
  }, [dimTo]);
  useEffect(
    () => () => {
      if (Platform.OS === 'web') return;
      const { settings } = useStore.getState();
      const phase = screenTargetAt(screenPlanFor(a, settings), Date.now()).phase;
      // Back to what eepy's screen should be: auto-dimmed, the brightness you set, or the phone's.
      const mode = eepyWindowMode(settings, Date.now(), phase === 'night' ? DIM.night : phase === 'winddown' ? DIM.winddown : undefined);
      if (mode.kind === 'auto') dimEepy(mode.slider);
      else if (mode.kind === 'manual') setEepyBrightness(mode.slider);
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
  evening: 'Evening',
  winddown: 'Wind-down',
  'phone-down': 'Phone down',
  'screen-free': 'Screen-free',
  'lights-out': 'Lights out',
};

/** The step's big number: its time left (reading: time to lights-out). Nothing for a moment. */
function Timer({ step, since, now, lightsOut }: { step: RundownStep; since: number; now: number; lightsOut: number }) {
  if (step.id === 'reading') {
    return (
      <View style={{ marginTop: space.lg }}>
        <Caption>Lights out in</Caption>
        <Text style={[font.display, { color: night.text }]}>{until(lightsOut - now)}</Text>
        <Text style={[font.small, { color: night.textDim }]}>
          Read until {formatTime(step.end)} · lights out {formatTime(lightsOut)}
        </Text>
      </View>
    );
  }
  if (step.kind !== 'do' || step.min <= 0) return null;
  // The step's own clock from when it came up; once the phone is down, the schedule's (it moves on by itself).
  const end = step.phase === 'screen-free' ? step.end : since + step.min * MINUTE;
  const left = end - now;
  return (
    <View style={{ marginTop: space.lg }}>
      <Caption color={left < 0 ? colors.warn : undefined}>{left >= 0 ? 'Time left' : "Time's up"}</Caption>
      <Text style={[font.display, { color: left >= 0 ? night.text : colors.warn }]} accessibilityLiveRegion="polite">
        {left >= 0 ? clock(left) : `+${clock(-left)}`}
      </Text>
    </View>
  );
}

/** "Start sleep sounds" on the reading and relaxing steps (the "I'm in bed" tap leaves a playing sound alone). */
function SoundsNow() {
  const playback = usePlayback();
  const audio = useStore((s) => s.settings.audio);
  if (playback.status === 'playing') return <Text style={[font.small, { color: night.textDim, marginTop: space.md }]}>Sleep sounds playing</Text>;
  return (
    <View style={{ alignItems: 'flex-start', marginTop: space.sm }}>
      <Button small kind="ghost" icon="music-note-outline" label={`Start sleep sounds · ${sleepSoundsLabel(audio)}`} onPress={() => void soundPlayer.play(audio)} />
    </View>
  );
}

/** A warning about tonight (a short evening, a late start), in dim text: no bright panel on black. */
function Warning({ text }: { text: string }) {
  return (
    <Row gap={space.sm} style={{ alignItems: 'flex-start', marginBottom: space.lg }}>
      <Icon name="timer-sand" size={18} color={colors.warn} />
      <Text style={[font.small, { flex: 1, color: night.text }]}>{text}</Text>
    </Row>
  );
}

/** Before starting: tonight at a glance, the one button, and the steps to come. */
function Intro({ a, r, now }: { a: Analysis; r: Rundown; now: number }) {
  return (
    <>
      <Hero dim label="Tonight's rundown" value={`${r.routine.length} steps · ${formatDuration(r.plannedMin)}`} caption={rundownGlance(r)} />
      {r.note ? <Warning text={r.note} /> : null}
      <NightButton icon="play-circle-outline" label="Start my rundown" onPress={() => startRundown(a, Date.now())} />
      {canPickUp(r, now) ? (
        <View style={{ alignItems: 'center', marginTop: space.sm }}>
          <Button kind="ghost" label="Pick up from now (earlier steps skipped)" onPress={() => startRundown(a, Date.now(), true)} />
        </View>
      ) : null}
      <View style={{ marginTop: space.xl }}>
        <Timeline dim items={r.routine.map((s) => ({ key: s.id, time: formatTime(s.at), title: s.title, sub: s.kind === 'do' && s.min > 0 ? `${s.min} min` : undefined }))} />
      </View>
      <Text style={[font.small, { color: night.textDim, marginTop: space.sm }]}>One step at a time. Leave whenever you like: it remembers where you are tonight.</Text>
      <View style={{ alignItems: 'flex-start' }}>
        <Button small kind="ghost" icon="tune-variant" label="Change the steps" onPress={openSettings} />
      </View>
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
      <Empty icon="format-list-checks" title="Your bedtime rundown is off" body="Turn it on in settings to get your evening step by step.">
        <Button kind="secondary" label="Open settings" onPress={openSettings} />
      </Empty>
    );
  }
  if (session && isOpen(session)) {
    return (
      <>
        <SessionHeader a={a} />
        <Text style={[font.body, { color: night.textDim, marginBottom: space.lg }]}>Rundown done. Sleep well.</Text>
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
  const ahead = !last && step.at - now > 2 * MINUTE ? `Planned for ${formatTime(step.at)}. You're ${until(step.at - now)} ahead.` : '';

  return (
    <>
      <Row gap={space.sm} style={{ marginBottom: space.sm }}>
        <Caption style={{ flex: 1 }}>{`Step ${pos.index + 1} of ${pos.total} · ${PHASE_LABEL[step.phase]}`}</Caption>
        <Text style={[font.tiny, { fontVariant: ['tabular-nums'] }]}>lights out {formatTime(r.lightsOut)}</Text>
      </Row>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: pos.total, now: pos.marked }} style={{ marginBottom: space.xl }}>
        <Meter value={pos.marked} max={pos.total} color={colors.sleep} height={4} />
      </View>
      {r.late && r.note ? <Warning text={r.note} /> : null}

      {/* The step: straight on black, nothing around it. */}
      <View style={{ marginBottom: space.xl }}>
        <Icon name={step.icon} size={40} color={night.textDim} />
        <Text style={[font.h1, { color: night.text, marginTop: space.md }]} accessibilityRole="header">
          {step.title}
        </Text>
        <Text style={[font.small, { color: night.textDim, marginTop: space.xxs, fontVariant: ['tabular-nums'] }]}>{when(step)}</Text>
        <Timer step={step} since={since} now={now} lightsOut={r.lightsOut} />
        <Text style={[font.body, { color: night.textDim, marginTop: space.lg }]}>{step.detail}</Text>
        {step.phase === 'phone-down' ? (
          <Text style={[font.small, { color: night.textDim, marginTop: space.md }]}>
            eepy keeps time from here: the screen-free steps move on by the clock, and at {formatTime(r.lightsOut)} the lights-out reminder brings you back for "I'm in bed".
          </Text>
        ) : null}
        {step.id === 'reading' || step.id === 'relax' ? <SoundsNow /> : null}
        {ahead ? <Text style={[font.tiny, { marginTop: space.md }]}>{ahead}</Text> : null}
      </View>

      {last ? <InBedButton a={a} night /> : <NightButton icon="check" label={step.phase === 'phone-down' ? 'Phone is down' : 'Done'} onPress={tap(() => markRundown(a, 'done', Date.now()))} />}
      <Row gap={space.sm} style={{ marginTop: space.sm }}>
        <Button kind="secondary" icon="chevron-left" label="Back" disabled={pos.marked === 0} style={{ flex: 1 }} onPress={tap(() => backRundown(a, Date.now()))} />
        {last ? null : <Button kind="secondary" icon="skip-next-outline" label="Skip" style={{ flex: 1 }} onPress={tap(() => markRundown(a, 'skipped', Date.now()))} />}
      </Row>
      {next ? (
        <Text style={[font.small, { color: night.textDim, textAlign: 'center', marginTop: space.lg }]}>
          Up next: {next.title}
          {next.kind === 'do' && next.min > 0 ? ` · ${next.min} min` : ''} at {formatTime(next.at)}
        </Text>
      ) : null}
      <View style={{ alignItems: 'center', marginTop: space.md }}>
        <Button small kind="ghost" icon="restart" label="Start over" onPress={resetRundownProgress} />
      </View>
    </>
  );
}
