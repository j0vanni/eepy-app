// Settings → Wind-down & phone light: how long the wind-down is, the default sleep sound, and what
// happens to screens in the evening.
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { soundPlayer } from '@/audio/player';
import { PlayButton, SoundPicker, soundName, TimerPicker, VolumeSlider } from '@/audio/ui/SoundControls';
import { useSoundPlayer } from '@/audio/useSoundPlayer';
import { formatTime } from '@/engine/time';
import { SCREENS_OFF_OPTIONS } from '@/engine/windDownPlan';
import { usePhoneDown } from '@/state/rundown';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Card, Fold, ListCard, ListRow, Row, Section, Stepper } from '@/ui/components';
import { font, space, touch } from '@/ui/theme';

import { Caption, ChoiceRow, Para } from './parts';
import { Toggle } from './Toggle';

/** How long the wind-down before lights-out is (it sets when wind-down starts every evening). */
export function WindDownLengthSection() {
  const windDownMin = useStore((s) => s.profile.windDownMin);
  const setProfile = useStore((s) => s.setProfile);
  return (
    <Section title="Wind-down">
      <ListCard>
        <Stepper
          label="Wind-down length"
          sub="Time to dim the lights and put screens away"
          value={`${windDownMin} min`}
          onDec={() => setProfile({ windDownMin: Math.max(15, windDownMin - 15) })}
          onInc={() => setProfile({ windDownMin: Math.min(120, windDownMin + 15) })}
        />
        <ListRow title="Open wind-down" sub="Your steps, breathing and a light check" onPress={() => router.push('/winddown')} />
      </ListCard>
    </Section>
  );
}

/** The default sleep sound, its volume and timer. */
export function SleepSoundsSection() {
  const sound = useSoundPlayer();
  const { settings } = sound;
  return (
    <Section title="Sleep sounds">
      <Card>
        <Row gap={space.md} style={{ marginBottom: space.md }}>
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>{soundName(settings.sound)}</Text>
            <Text style={font.small}>The default for wind-down and Today's evening. Plays with the screen off.</Text>
          </View>
          <PlayButton playing={sound.playing} size={touch.min} onPress={() => sound.toggle()} label={sound.playing ? 'Stop preview' : 'Preview sound'} />
        </Row>
        <SoundPicker value={settings.sound} onChange={sound.setSound} playing={sound.playing} />
        <View style={{ marginTop: space.lg }}>
          <Caption>Volume</Caption>
          <VolumeSlider value={settings.volume} onChange={(v) => soundPlayer.setVolume(v)} onCommit={sound.setVolume} />
        </View>
        <View style={{ marginTop: space.lg }}>
          <Caption>Sleep timer</Caption>
          <TimerPicker value={settings.timerMin} onChange={sound.setTimer} />
          <Text style={[font.tiny, { marginTop: space.sm }]}>Fades out gently at the end of the timer.</Text>
        </View>
      </Card>
    </Section>
  );
}

/** When screens go away, and eepy's own dimming. */
export function ScreensSection() {
  const screenDim = useStore((s) => s.settings.screenDim);
  const pausedUntil = useStore((s) => s.settings.screenDimPausedUntil);
  const screensOffMin = useStore((s) => s.settings.screensOffMin);
  const rundownOn = useStore((s) => s.settings.rundown.enabled);
  const setSettings = useStore((s) => s.setSettings);
  const phoneDown = usePhoneDown(useAnalysis());
  return (
    <Section title="Screens">
      <ListCard>
        {rundownOn ? (
          // With the bedtime rundown, phone-down comes from its screen-free steps (teeth, reading…).
          <ListRow title="Phone down" sub="When your bedtime rundown's screen-free steps start. Change them (and reading time) under Bedtime rundown." value={phoneDown !== undefined ? formatTime(phoneDown) : undefined} />
        ) : (
          <ChoiceRow
            title="Screens off before lights-out"
            value={screensOffMin}
            onChange={(v) => setSettings({ screensOffMin: v })}
            options={SCREENS_OFF_OPTIONS.map((m) => ({ label: `${m} min`, value: m as number }))}
          />
        )}
        <Toggle label="Dim and warm eepy in the evening" sub="Only inside eepy. Your phone's settings stay as they are." value={screenDim} onChange={(v) => setSettings({ screenDim: v, screenDimPausedUntil: undefined })} />
        {screenDim && pausedUntil !== undefined && pausedUntil > Date.now() ? (
          <ListRow title={`Brighter until ${formatTime(pausedUntil)}`} sub="eepy isn't dimming itself" value="Dim again" onPress={() => setSettings({ screenDimPausedUntil: undefined })} />
        ) : null}
        <ListRow title="Phone light" sub="How bright your screen should be this evening · Plan › Tools" onPress={() => router.navigate({ pathname: '/planner', params: { show: 'light' } })} />
        <Fold bare title="How the dimming works">
          <Para first>A warm tint from the evening, and eepy's own screen dimmed from wind-down. Never too dark to read.</Para>
          <Para>Too dark anyway? Tap Brighter (bottom left) for the rest of the night.</Para>
        </Fold>
      </ListCard>
    </Section>
  );
}
