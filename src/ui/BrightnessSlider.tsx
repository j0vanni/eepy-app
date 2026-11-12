/**
 * Drag to set the phone's brightness (slider position 0–1, like Android's own slider), with the
 * current phone-light target marked on the track. Changes apply while dragging (throttled by the
 * caller) and once more on release.
 */
import { useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/ui/components';
import { colors, font, radius, space, touch } from '@/ui/theme';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const MIN = 0.01;
const THUMB = 24;
const TRACK = 6;

export function BrightnessSlider({
  value,
  target,
  onChange,
  onCommit,
  disabled,
}: {
  value: number;
  /** Highest recommended position right now (marked on the track), if any. */
  target?: number;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
  disabled?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number>();
  const shown = drag ?? value;
  const over = target !== undefined && shown > target + 0.02;

  const at = (e: GestureResponderEvent) => (width > 0 ? Math.max(MIN, clamp01(e.nativeEvent.locationX / width)) : shown);
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
  const step = (d: number) => onCommit(Math.max(MIN, Math.round(clamp01(value + d) * 20) / 20));

  return (
    <View style={[styles.row, disabled ? { opacity: 0.4 } : null]} pointerEvents={disabled ? 'none' : 'auto'}>
      <Pressable onPress={() => step(-0.05)} accessibilityRole="button" accessibilityLabel="Dimmer" style={({ pressed }) => [styles.btn, pressed ? styles.btnPressed : null]}>
        <Icon name="brightness-4" />
      </Pressable>
      <View
        style={styles.hit}
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
        accessibilityLabel="Phone brightness"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05)}
      >
        <View style={[styles.track, styles.pass]}>
          {/* Past the target the fill turns to the warning colour. */}
          <View style={[styles.fill, { width: `${shown * 100}%`, backgroundColor: over ? colors.warn : colors.textDim }]} />
        </View>
        {target !== undefined && target < 1 ? <View style={[styles.marker, styles.pass, { left: Math.max(0, target * width - 1) }]} /> : null}
        <View style={[styles.thumb, styles.pass, { left: Math.min(Math.max(0, shown * width - THUMB / 2), Math.max(0, width - THUMB)) }]} />
      </View>
      <Pressable onPress={() => step(0.05)} accessibilityRole="button" accessibilityLabel="Brighter" style={({ pressed }) => [styles.btn, pressed ? styles.btnPressed : null]}>
        <Icon name="brightness-7" />
      </Pressable>
      <Text style={[font.small, styles.pct, over ? { color: colors.warn } : null]}>{Math.round(shown * 100)}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  btn: { width: touch.min, height: touch.min, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnPressed: { opacity: 0.6 },
  hit: { flex: 1, height: touch.min, justifyContent: 'center' },
  pass: { pointerEvents: 'none' },
  track: { height: TRACK, borderRadius: TRACK / 2, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: TRACK, borderRadius: TRACK / 2 },
  marker: { position: 'absolute', top: (touch.min - 20) / 2, width: 2, height: 20, borderRadius: 1, backgroundColor: colors.text },
  thumb: { position: 'absolute', top: (touch.min - THUMB) / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: colors.text },
  pct: { width: 40, textAlign: 'right', color: colors.text, fontVariant: ['tabular-nums'] },
});
