/**
 * Sleep sounds: the pieces (sound tiles, volume, timer, play button, status line) and `SleepSounds`,
 * the whole control as it opens in place on the wind-down screen. Settings → Wind-down uses the
 * pieces for the defaults.
 */
import { useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatTime } from '@/engine/time';
import { useNow } from '@/state/useAnalysis';
import { Button, Icon, Note, Segmented } from '@/ui/components';
import { colors, font, iconSize, radius, space, touch } from '@/ui/theme';

import { formatRemaining, timerFadeMs } from '../envelope';
import { soundPlayer } from '../player';
import { SOUNDS, SoundId, soundInfo, TIMER_OPTIONS, timerShortLabel } from '../sounds';
import { SoundControls, useSoundPlayer } from '../useSoundPlayer';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const THUMB = 24;
const TRACK = 6;

/** "Brown noise" / "Rain". */
export const soundName = (id: SoundId) => (id === 'rain' ? 'Rain' : `${soundInfo(id).label} noise`);

/** 2×2 grid of sound tiles; the chosen one sits on a quiet amber wash. */
export function SoundPicker({ value, onChange, playing }: { value: SoundId; onChange: (s: SoundId) => void; playing?: boolean }) {
  return (
    <View style={styles.grid} accessibilityRole="radiogroup">
      {SOUNDS.map((s) => {
        const selected = s.id === value;
        return (
          <Pressable
            key={s.id}
            onPress={() => onChange(s.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={soundName(s.id)}
            style={({ pressed }) => [styles.tile, selected ? styles.tileSelected : null, pressed ? { opacity: 0.75 } : null]}
          >
            <View style={styles.tileHead}>
              <Icon name={s.icon} color={selected ? colors.accent : colors.textDim} />
              {selected && playing ? <Icon name="volume-high" size={iconSize.sm} color={colors.accent} /> : null}
            </View>
            <Text style={[font.h3, { marginTop: space.sm, color: selected ? colors.text : colors.textDim }]}>{s.label}</Text>
            <Text style={font.tiny} numberOfLines={2}>
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
      <Pressable onPress={() => step(-0.1)} accessibilityRole="button" accessibilityLabel="Quieter" style={({ pressed }) => [styles.volBtn, pressed ? { opacity: 0.6 } : null]}>
        <Icon name="volume-low" />
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
        <View style={[styles.thumb, styles.passThrough, { left: Math.min(Math.max(0, shown * width - THUMB / 2), Math.max(0, width - THUMB)) }]} />
      </View>
      <Pressable onPress={() => step(0.1)} accessibilityRole="button" accessibilityLabel="Louder" style={({ pressed }) => [styles.volBtn, pressed ? { opacity: 0.6 } : null]}>
        <Icon name="volume-high" />
      </Pressable>
      <Text style={[font.small, styles.volPct]}>{Math.round(shown * 100)}%</Text>
    </View>
  );
}

export function TimerPicker({ value, onChange }: { value: number; onChange: (min: number) => void }) {
  return <Segmented options={TIMER_OPTIONS.map((m) => ({ label: timerShortLabel(m), value: m as number }))} value={value} onChange={onChange} />;
}

/** One line describing the live session: "Brown noise · fades out by 23:35 · 41:20 left". */
export function PlaybackStatus({ controls }: { controls: SoundControls }) {
  const { playback } = controls;
  const now = useNow(1000);
  if (playback.status === 'idle') {
    if (playback.error) return <Text style={[font.small, { color: colors.warn }]}>Couldn't play: {playback.error}</Text>;
    return null;
  }
  let detail: string;
  if (playback.status === 'stopping') detail = 'stopping…';
  else if (playback.paused) detail = 'paused by your phone, it resumes on its own';
  else if (playback.endsAt === undefined) detail = 'playing until you stop it';
  else if (playback.fading) detail = `fading out · ${formatRemaining(playback.endsAt - now)}`;
  else detail = `fades out by ${formatTime(playback.endsAt)} · ${formatRemaining(playback.endsAt - now)} left`;
  return (
    <View style={[styles.row, { gap: space.sm }]}>
      <View style={[styles.dot, { backgroundColor: playback.paused ? colors.warn : colors.good }]} />
      <Text style={[font.small, { flex: 1 }]}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{soundName(playback.sound)}</Text> · {detail}
      </Text>
    </View>
  );
}

function fadeText(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`;
}

/** Round play/stop button: quiet while idle, amber icon while playing. */
export function PlayButton({ playing, onPress, size = touch.comfy, label }: { playing: boolean; onPress: () => void; size?: number; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? (playing ? 'Stop sound' : 'Play sound')}
      hitSlop={Math.max(0, (touch.min - size) / 2)}
      style={({ pressed }) => [styles.playBtn, { width: size, height: size, borderRadius: size / 2 }, pressed ? { opacity: 0.75 } : null]}
    >
      <Icon name={playing ? 'stop' : 'play'} size={Math.round(size * 0.46)} color={playing ? colors.accent : colors.text} />
    </Pressable>
  );
}

/** What the sounds row says while it is closed: "Playing" or the remembered sound. */
export function useSoundsSummary(): string {
  const { playing, settings } = useSoundPlayer();
  return playing ? 'Playing' : soundName(settings.sound);
}

/** Sleep sounds, opened in place on the wind-down screen: play first, then what and how long. */
export function SleepSounds() {
  const controls = useSoundPlayer();
  const { settings, playing } = controls;
  return (
    <View>
      <Button kind="secondary" icon={playing ? 'stop' : 'play'} label={playing ? 'Stop' : `Play ${soundName(settings.sound).toLowerCase()}`} onPress={() => controls.toggle()} />
      <View style={{ marginTop: space.sm, marginBottom: space.md }}>
        {controls.playback.status === 'idle' && !controls.playback.error ? <Text style={font.small}>Keeps playing with the screen off.</Text> : <PlaybackStatus controls={controls} />}
      </View>
      {playing && settings.volume === 0 ? (
        <Note tone="warn" icon="volume-off">
          Volume is at 0%.
        </Note>
      ) : null}
      <SoundPicker value={settings.sound} onChange={controls.setSound} playing={playing} />

      <Text style={[font.label, styles.label]}>VOLUME</Text>
      <VolumeSlider value={settings.volume} onChange={(v) => soundPlayer.setVolume(v)} onCommit={controls.setVolume} />

      <Text style={[font.label, styles.label]}>SLEEP TIMER</Text>
      <TimerPicker value={settings.timerMin} onChange={controls.setTimer} />
      <Text style={[font.small, { marginTop: space.sm }]}>
        {settings.timerMin > 0 ? `Fades out over the last ${fadeText(timerFadeMs(settings.timerMin * 60_000))}, then stops.` : 'Plays until you stop it.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { flexBasis: '47%', flexGrow: 1, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  tileSelected: { backgroundColor: colors.accentSoft },
  tileHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { marginTop: space.lg, marginBottom: space.sm },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  volBtn: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  volPct: { width: 40, textAlign: 'right', color: colors.text, fontVariant: ['tabular-nums'] },
  sliderHit: { flex: 1, height: touch.min, justifyContent: 'center' },
  track: { height: TRACK, borderRadius: TRACK / 2, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: TRACK, borderRadius: TRACK / 2, backgroundColor: colors.textDim },
  thumb: { position: 'absolute', top: (touch.min - THUMB) / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: colors.text },
  playBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  dot: { width: 8, height: 8, borderRadius: 4 },
  passThrough: { pointerEvents: 'none' },
});
