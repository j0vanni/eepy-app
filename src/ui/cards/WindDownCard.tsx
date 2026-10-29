// Today-screen slot: evening-only nudge into the wind-down routine, with one-tap sleep sounds.
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { showWindDownCard, windDownStatus } from '@/audio/windDown';
import { soundInfo } from '@/audio/sounds';
import { PlaybackStatus, PlayButton } from '@/audio/ui/SoundControls';
import { useSoundPlayer } from '@/audio/useSoundPlayer';
import type { Analysis } from '@/engine/analysis';
import { formatDuration, formatTime } from '@/engine/time';
import { useNow } from '@/state/useAnalysis';
import { Card, Icon } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

/** Shown from ~2h before wind-down until lights-out: "Wind-down starts 22:20 · open your routine". */
export function WindDownCard({ analysis }: { analysis: Analysis }) {
  const now = useNow();
  const sound = useSoundPlayer();
  const t = analysis.tonight;
  if (!showWindDownCard(now, t) && !sound.playing) return null;

  const s = windDownStatus(now, t);
  const title = s.phase === 'before' ? `Wind-down starts ${formatTime(t.windDownStart)}` : `Wind down now · lights out ${formatTime(t.bedtime)}`;
  const sub =
    s.phase === 'before'
      ? `in ${formatDuration(s.minToWindDown)} · open your routine`
      : s.phase === 'during'
        ? `${formatDuration(s.minToBedtime)} to go · open your routine`
        : 'Past lights-out · open your routine';
  const name = soundInfo(sound.settings.sound).label;

  return (
    <Card accent={s.phase === 'during' ? colors.accent : undefined}>
      <View style={styles.row}>
        <Pressable
          onPress={() => router.push('/winddown')}
          accessibilityRole="button"
          accessibilityLabel={`${title}. Open your wind-down routine`}
          style={({ pressed }) => [styles.main, pressed && { opacity: 0.75 }]}
        >
          <View style={styles.icon}>
            <Icon name="weather-night" size={22} color={colors.light} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>{title}</Text>
            <Text style={[font.small, { marginTop: 2 }]}>{sub}</Text>
          </View>
        </Pressable>
        <PlayButton
          playing={sound.playing}
          size={44}
          onPress={() => sound.toggle()}
          label={sound.playing ? 'Stop sleep sound' : `Play ${name}${sound.settings.sound === 'rain' ? '' : ' noise'}`}
        />
      </View>
      {sound.playback.status !== 'idle' ? (
        <View style={{ marginTop: space.md }}>
          <PlaybackStatus controls={sound} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
});
