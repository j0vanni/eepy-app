import { useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { useNow } from '@/state/useAnalysis';
import { Card, CardTitle, Icon, Note, Segmented } from '@/ui/components';
import { colors, font, radius, space } from '@/ui/theme';

import { formatRemaining, timerFadeMs } from '../envelope';
import { soundPlayer } from '../player';
import { SOUNDS, SoundId, soundInfo, TIMER_OPTIONS, timerShortLabel } from '../sounds';
import { SoundControls, useSoundPlayer } from '../useSoundPlayer';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 2×2 grid of sound tiles. */
export function SoundPicker({ value, onChange, playing }: { value: SoundId; onChange: (s: SoundId) => void; playing?: boolean }) {
  return (
    <View style={styles.grid}>
      {SOUNDS.map((s) => {
        const selected = s.id === value;
        return (
          <Pressable
            key={s.id}
            onPress={() => onChange(s.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${s.label}${s.id === 'rain' ? '' : ' noise'}`}
            style={({ pressed }) => [styles.tile, selected && styles.tileSelected, pressed && { opacity: 0.8 }]}
          >
            <View style={styles.tileHead}>
              <Icon name={s.icon} size={20} color={selected ? colors.text : colors.textDim} />
              {selected && playing ? <Icon name="volume-high" size={14} color={colors.accent} /> : null}
            </View>
            <Text style={[font.h3, { marginTop: space.sm, color: selected ? colors.text : colors.textDim }]}>{s.label}</Text>
            <Text style={[font.tiny, { marginTop: 2 }]} numberOfLines={2}>
              {s.blurb}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Drag (or tap) to set the volume. `onChange` fires live while dragging; `onCommit` once on
 * release, so the persisted setting isn't rewritten on every move.
 */
export function VolumeSlider({ value, onChange, onCommit }: { value: number; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | undefined>(undefined);
  const shown = drag ?? value;

  const at = (e: GestureResponderEvent) => (width > 0 ? clamp01(e.nativeEvent.locationX / width) : shown);
  const move = (e: GestureResponderEvent) => {
    const v = Math.round(at(e) * 100) / 100;
    setDrag(v);
    onChange(v);
  };
  const end = (e: GestureResponderEvent) => {
    const v = Math.round(at(e) * 100) / 100;
    setDrag(undefined);
    onCommit(v);
  };
  const step = (d: number) => onCommit(Math.round(clamp01(value + d) * 10) / 10);

  return (
    <View style={styles.volumeRow}>
      <Pressable onPress={() => step(-0.1)} hitSlop={8} accessibilityLabel="Quieter" style={styles.volBtn}>
        <Icon name="volume-low" size={18} color={colors.textDim} />
      </Pressable>
      <View
        style={styles.sliderHit}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={move}
        onResponderMove={move}
        onResponderRelease={end}
        onResponderTerminate={() => {
          if (drag !== undefined) onCommit(drag);
          setDrag(undefined);
        }}
        accessibilityRole="adjustable"
        accessibilityLabel="Volume"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)}
      >
        <View style={[styles.track, styles.passThrough]}>
          <View style={[styles.fill, { width: `${shown * 100}%` }]} />
        </View>
        <View style={[styles.thumb, styles.passThrough, { left: Math.min(Math.max(0, shown * width - 11), Math.max(0, width - 22)) }]} />
      </View>
      <Pressable onPress={() => step(0.1)} hitSlop={8} accessibilityLabel="Louder" style={styles.volBtn}>
        <Icon name="volume-high" size={18} color={colors.textDim} />
      </Pressable>
      <Text style={[font.small, styles.volPct]}>{Math.round(shown * 100)}%</Text>
    </View>
  );
}

export function TimerPicker({ value, onChange }: { value: number; onChange: (min: number) => void }) {
  return <Segmented options={TIMER_OPTIONS.map((m) => ({ label: timerShortLabel(m), value: m as number }))} value={value} onChange={onChange} />;
}

/** One line describing the live session: "Brown noise · fades out by 23:35 (41:20)". */
export function PlaybackStatus({ controls }: { controls: SoundControls }) {
  const { playback } = controls;
  const now = useNow(1000);
  if (playback.status === 'idle') {
    if (playback.error) return <Text style={[font.small, { color: colors.warn }]}>Couldn't play: {playback.error}</Text>;
    return null;
  }
  const name = playback.sound === 'rain' ? 'Rain' : `${soundInfo(playback.sound).label} noise`;
  let detail: string;
  if (playback.status === 'stopping') detail = 'stopping…';
  else if (playback.paused) detail = 'paused by your phone — it resumes on its own';
  else if (playback.endsAt === undefined) detail = 'playing until you stop it';
  else if (playback.fading) detail = `fading out · ${formatRemaining(playback.endsAt - now)}`;
  else detail = `fades out by ${clock(playback.endsAt)} · ${formatRemaining(playback.endsAt - now)} left`;
  return (
    <View style={[styles.row, { gap: space.sm }]}>
      <View style={[styles.dot, { backgroundColor: playback.paused ? colors.warn : colors.good }]} />
      <Text style={[font.small, { flex: 1 }]}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{name}</Text> · {detail}
      </Text>
    </View>
  );
}

function fadeText(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`;
}

function clock(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Round play/stop button. */
export function PlayButton({ playing, onPress, size = 56, label }: { playing: boolean; onPress: () => void; size?: number; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? (playing ? 'Stop sound' : 'Play sound')}
      hitSlop={6}
      style={({ pressed }) => [
        styles.playBtn,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: playing ? colors.surfaceAlt : colors.accent, borderColor: colors.accent },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Icon name={playing ? 'stop' : 'play'} size={size * 0.46} color={playing ? colors.accent : '#140F33'} />
    </Pressable>
  );
}

/** The full sounds card on the wind-down screen. */
export function SoundsCard() {
  const controls = useSoundPlayer();
  const { settings, playing } = controls;
  return (
    <Card>
      <CardTitle icon="music-note-outline" title="Sleep sounds" color={colors.rem} />
      <SoundPicker value={settings.sound} onChange={controls.setSound} playing={playing} />

      <Text style={[font.tiny, styles.label]}>VOLUME</Text>
      <VolumeSlider value={settings.volume} onChange={(v) => soundPlayer.setVolume(v)} onCommit={controls.setVolume} />

      <Text style={[font.tiny, styles.label]}>SLEEP TIMER</Text>
      <TimerPicker value={settings.timerMin} onChange={controls.setTimer} />
      <Text style={[font.small, { marginTop: space.sm }]}>
        {settings.timerMin > 0
          ? `Fades out gently over the last ${fadeText(timerFadeMs(settings.timerMin * 60_000))}, then stops.`
          : 'Plays until you stop it.'}
      </Text>

      <View style={[styles.row, { marginTop: space.lg, gap: space.md }]}>
        <PlayButton playing={playing} onPress={() => controls.toggle()} />
        <View style={{ flex: 1 }}>
          {controls.playback.status === 'idle' ? (
            <Text style={font.small}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{soundInfo(settings.sound).label}</Text>
              {settings.sound === 'rain' ? '' : ' noise'} · keeps playing with the screen off
            </Text>
          ) : (
            <PlaybackStatus controls={controls} />
          )}
        </View>
      </View>
      {playing && settings.volume === 0 ? (
        <View style={{ marginTop: space.md }}>
          <Note tone="warn" icon="volume-off">
            Volume is at 0%.
          </Note>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  tileHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { marginTop: space.lg, marginBottom: space.sm, fontWeight: '600' },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  volBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  volPct: { width: 40, textAlign: 'right', color: colors.text },
  sliderHit: { flex: 1, height: 36, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  thumb: {
    position: 'absolute',
    top: 7,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.text,
    borderWidth: 3,
    borderColor: colors.accent,
  },
  playBtn: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  passThrough: { pointerEvents: 'none' },
});
