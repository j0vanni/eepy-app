/**
 * Drag to set the phone's brightness (slider position 0–1, like Android's own slider), with the
 * current phone-light target marked on the track. Changes apply while dragging (throttled by the
 * caller) and once more on release.
 */
import { useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const MIN = 0.01;

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
  const fill = over ? colors.warn : colors.light;

  return (
    <View style={[styles.row, disabled ? { opacity: 0.4 } : null]} pointerEvents={disabled ? 'none' : 'auto'}>
      <Pressable onPress={() => step(-0.05)} hitSlop={8} accessibilityLabel="Dimmer" style={styles.btn}>
        <Icon name="brightness-4" size={18} color={colors.textDim} />
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
          <View style={[styles.fill, { width: `${shown * 100}%`, backgroundColor: fill }]} />
        </View>
        {target !== undefined && target < 1 ? <View style={[styles.marker, styles.pass, { left: Math.max(0, target * width - 1) }]} /> : null}
        <View style={[styles.thumb, styles.pass, { left: Math.min(Math.max(0, shown * width - 11), Math.max(0, width - 22)) }]} />
      </View>
      <Pressable onPress={() => step(0.05)} hitSlop={8} accessibilityLabel="Brighter" style={styles.btn}>
        <Icon name="brightness-7" size={18} color={colors.textDim} />
      </Pressable>
      <Text style={[font.small, styles.pct, over ? { color: colors.warn } : null]}>{Math.round(shown * 100)}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  btn: { padding: 4 },
  hit: { flex: 1, height: 36, justifyContent: 'center' },
  pass: { pointerEvents: 'none' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  marker: { position: 'absolute', top: 6, width: 2, height: 24, borderRadius: 1, backgroundColor: colors.text },
  thumb: { position: 'absolute', top: 7, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.text, borderWidth: 3, borderColor: colors.bg },
  pct: { width: 40, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
