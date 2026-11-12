/**
 * An evening nudge into the wind-down routine with one-tap sleep sounds: shown from two hours before
 * wind-down until lights-out, and for as long as a sound is playing.
 */
import { router } from 'expo-router';
import { View } from 'react-native';

import { PlaybackStatus, PlayButton, soundName } from '@/audio/ui/SoundControls';
import { useSoundPlayer } from '@/audio/useSoundPlayer';
import { showWindDownCard, windDownStatus } from '@/audio/windDown';
import type { Analysis } from '@/engine/analysis';
import { formatDuration, formatTime } from '@/engine/time';
import { useNow } from '@/state/useAnalysis';
import { Card, ListRow } from '@/ui/components';
import { colors, space } from '@/ui/theme';

export function WindDownCard({ analysis }: { analysis: Analysis }) {
  const now = useNow();
  const sound = useSoundPlayer();
  const t = analysis.tonight;
  if (!showWindDownCard(now, t) && !sound.playing) return null;

  const s = windDownStatus(now, t);
  const title = s.phase === 'before' ? `Wind-down starts ${formatTime(t.windDownStart)}` : s.phase === 'during' ? 'Wind down now' : 'Past lights-out';
  const sub = s.phase === 'before' ? `In ${formatDuration(s.minToWindDown)}` : s.phase === 'during' ? `Lights out ${formatTime(t.bedtime)}, in ${formatDuration(s.minToBedtime)}` : 'Open your routine';

  return (
    <Card style={{ paddingVertical: space.xs }}>
      <ListRow
        icon="weather-night"
        iconColor={colors.sleep}
        title={title}
        sub={sub}
        onPress={() => router.push('/winddown')}
        right={<PlayButton playing={sound.playing} size={44} onPress={() => sound.toggle()} label={sound.playing ? 'Stop sleep sound' : `Play ${soundName(sound.settings.sound)}`} />}
      />
      {sound.playback.status !== 'idle' ? (
        <View style={{ paddingBottom: space.md }}>
          <PlaybackStatus controls={sound} />
        </View>
      ) : null}
    </Card>
  );
}
