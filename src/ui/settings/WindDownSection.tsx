// Settings slot: default sleep sound, volume and sleep-timer length.
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { soundPlayer } from '@/audio/player';
import { PlayButton, SoundPicker, TimerPicker, VolumeSlider } from '@/audio/ui/SoundControls';
import { useSoundPlayer } from '@/audio/useSoundPlayer';
import { useStore } from '@/state/store';
import { SCREENS_OFF_OPTIONS } from '@/engine/windDownPlan';
import { Card, CardTitle, ListRow, Section, Segmented } from '@/ui/components';
import { Toggle } from '@/ui/settings/Toggle';
import { colors, font, space } from '@/ui/theme';

export function WindDownSection() {
  const sound = useSoundPlayer();
  const { settings } = sound;
  const screenDim = useStore((s) => s.settings.screenDim);
  const screensOffMin = useStore((s) => s.settings.screensOffMin);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <Section title="Wind-down">
      <Card>
        <CardTitle icon="music-note-outline" title="Sleep sounds" color={colors.rem} right={<PlayButton playing={sound.playing} size={36} onPress={() => sound.toggle()} label={sound.playing ? 'Stop preview' : 'Preview sound'} />} />
        <Text style={[font.small, { marginBottom: space.md }]}>
          The default for your wind-down routine and the evening card on Today. Plays with the screen off and fades out gently at the end of the timer.
        </Text>
        <SoundPicker value={settings.sound} onChange={sound.setSound} playing={sound.playing} />
        <Text style={[font.tiny, { marginTop: space.lg, marginBottom: space.sm, fontWeight: '600' }]}>VOLUME</Text>
        <VolumeSlider value={settings.volume} onChange={(v) => soundPlayer.setVolume(v)} onCommit={sound.setVolume} />
        <Text style={[font.tiny, { marginTop: space.lg, marginBottom: space.sm, fontWeight: '600' }]}>SLEEP TIMER</Text>
        <TimerPicker value={settings.timerMin} onChange={sound.setTimer} />
        <Text style={[font.tiny, { marginTop: space.lg, marginBottom: space.sm, fontWeight: '600' }]}>SCREENS OFF BEFORE LIGHTS-OUT</Text>
        <Segmented
          value={screensOffMin}
          onChange={(v) => setSettings({ screensOffMin: v })}
          options={SCREENS_OFF_OPTIONS.map((m) => ({ label: `${m} min`, value: m as number }))}
        />
        <Toggle
          label="Dim & warm eepy in the evening"
          sub="A warm tint from the evening, and eepy's own screen dimmed from wind-down (your phone's settings stay as they are)"
          value={screenDim}
          onChange={(v) => setSettings({ screenDim: v })}
        />
        <View style={{ marginTop: space.md, borderTopWidth: 1, borderTopColor: colors.border }}>
          <ListRow icon="weather-night" title="Open wind-down routine" sub="Countdown, checklist, breathing and a light check" onPress={() => router.push('/winddown')} />
        </View>
      </Card>
    </Section>
  );
}
