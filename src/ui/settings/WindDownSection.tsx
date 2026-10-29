// Settings slot: default sleep sound, volume and sleep-timer length.
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { soundPlayer } from '@/audio/player';
import { PlayButton, SoundPicker, TimerPicker, VolumeSlider } from '@/audio/ui/SoundControls';
import { useSoundPlayer } from '@/audio/useSoundPlayer';
import { Card, CardTitle, ListRow, Section } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

export function WindDownSection() {
  const sound = useSoundPlayer();
  const { settings } = sound;
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
        <View style={{ marginTop: space.md, borderTopWidth: 1, borderTopColor: colors.border }}>
          <ListRow icon="weather-night" title="Open wind-down routine" sub="Countdown, checklist, breathing and a light check" onPress={() => router.push('/winddown')} />
        </View>
      </Card>
    </Section>
  );
}
