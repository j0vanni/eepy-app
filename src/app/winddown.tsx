/**
 * Wind-down: the countdown to lights-out, the one thing to start now (the bedtime rundown, or
 * "I'm in bed"), tonight's steps as a timeline, and the helpers you can open right here —
 * breathing, sleep sounds, a light check and the phone's light.
 */
import { View } from 'react-native';

import { lightContextAt } from '@/audio/light';
import { Breathing } from '@/audio/ui/Breathing';
import { LightCheck, useLightSensorAvailable } from '@/audio/ui/LightCheck';
import { SleepSounds, useSoundsSummary } from '@/audio/ui/SoundControls';
import { Checklist, CountdownHero } from '@/audio/ui/WindDownParts';
import { isOpen } from '@/engine/inBed';
import { dateKey } from '@/engine/time';
import { sessionFor } from '@/state/inBed';
import { useRundown } from '@/state/rundown';
import { useStore } from '@/state/store';
import { useAnalysis, useNow } from '@/state/useAnalysis';
import { ScreenLightCard } from '@/ui/cards/ScreenLightCard';
import { WindDownTimelineCard } from '@/ui/cards/WindDownTimeline';
import { Fold, ListCard, Screen, Section } from '@/ui/components';
import { RundownStartButtons } from '@/ui/rundown/RundownCard';
import { space } from '@/ui/theme';
import { WindDownInBed } from '@/ui/today/InBed';

export default function WindDownScreen() {
  const analysis = useAnalysis();
  const rundownOn = useStore((s) => s.settings.rundown.enabled);
  const now = useNow(30_000);
  const rundown = useRundown(analysis, now);
  const inBed = useStore((s) => !!analysis && isOpen(sessionFor(s.settings.session, analysis)));
  const sounds = useSoundsSummary();
  const lightSensor = useLightSensorAvailable();
  const nightKey = analysis?.tonight.wakeDate ?? dateKey(now);
  const lightContext = lightContextAt(now, {
    wakeTime: analysis?.wakeTime,
    windDownStart: analysis?.tonight.windDownStart,
    bedtime: analysis?.tonight.bedtime,
  });
  // Until lights-out the rundown is the thing to start; after it (or with the rundown off), "I'm in bed".
  const rundownFirst = !!rundown && !inBed && now < rundown.lightsOut;

  return (
    <Screen>
      <CountdownHero analysis={analysis} />
      {analysis ? (
        <>
          {rundown && rundownFirst ? (
            <View style={{ gap: space.sm, marginBottom: space.md }}>
              <RundownStartButtons a={analysis} r={rundown} now={now} look="main" />
            </View>
          ) : null}
          <WindDownInBed a={analysis} quiet={rundownFirst} />
          {rundown && !rundownFirst && !inBed ? (
            <View style={{ gap: space.sm, marginBottom: space.md }}>
              <RundownStartButtons a={analysis} r={rundown} now={now} look="quiet" />
            </View>
          ) : null}
          <WindDownTimelineCard a={analysis} />
        </>
      ) : null}
      {/* The rundown has these steps (and more); the checklist is for the plain wind-down. */}
      {rundownOn ? null : <Checklist key={nightKey} nightKey={nightKey} />}
      <Section title="Help falling asleep">
        <ListCard>
          <Fold bare icon="meditation" title="Breathe" sub="A slow, paced breath for a few minutes">
            <Breathing />
          </Fold>
          <Fold bare icon="music-note-outline" title="Sleep sounds" value={sounds}>
            <SleepSounds />
          </Fold>
          {lightSensor ? (
            <Fold bare icon="brightness-6" title="Light check" sub="Is the room dim enough?">
              <LightCheck context={lightContext} />
            </Fold>
          ) : null}
          {analysis ? (
            <Fold bare icon="cellphone" title="Phone light" sub="How bright your screen should be now">
              <ScreenLightCard a={analysis} full embedded />
            </Fold>
          ) : null}
        </ListCard>
      </Section>
    </Screen>
  );
}
