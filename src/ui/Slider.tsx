import { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './components';
import { colors, font, space } from './theme';

const THUMB = 24;
const TRACK_H = 6;
const TOUCH_H = 40;

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Value label shown on the right, e.g. a clock time. */
  format?: (value: number) => string;
  /** Secondary line under the value label, e.g. "30m earlier than plan". */
  sub?: string;
  /** The track fills from here to the thumb (defaults to `min`), e.g. the planned value. */
  fillFrom?: number;
  /** A reference tick on the track, e.g. the planned value. */
  mark?: number;
  color?: string;
  disabled?: boolean;
}

const snap = (v: number, min: number, max: number, step: number) => Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step));

/**
 * Horizontal slider on PanResponder (Android and web): tap or drag anywhere on the track, values snap
 * to `step`. The −/+ buttons and screen-reader increment/decrement move one step.
 */
export function Slider(props: SliderProps) {
  const { label, value, min, max, step, onChange, format = String, sub, color = colors.accent, disabled } = props;
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  // PanResponder is created once; handlers read the latest props through this ref.
  const live = useRef({ props, width, startX: 0, last: value });
  live.current.props = props;
  live.current.width = width;

  const pan = useMemo(() => {
    const valueAt = (x: number) => {
      const { props: p, width: w } = live.current;
      const usable = Math.max(1, w - THUMB);
      const frac = Math.min(1, Math.max(0, (x - THUMB / 2) / usable));
      return snap(p.min + frac * (p.max - p.min), p.min, p.max, p.step);
    };
    const update = (x: number) => {
      const v = valueAt(x);
      if (v !== live.current.last) {
        live.current.last = v;
        live.current.props.onChange(v);
      }
    };
    const end = () => setDragging(false);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !live.current.props.disabled,
      onMoveShouldSetPanResponder: () => !live.current.props.disabled,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        live.current.startX = e.nativeEvent.locationX;
        live.current.last = live.current.props.value;
        setDragging(true);
        update(live.current.startX);
      },
      onPanResponderMove: (_, g) => update(live.current.startX + g.dx),
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    });
  }, []);

  const nudge = (dir: 1 | -1) => {
    const v = snap(value + dir * step, min, max, step);
    if (v !== value) onChange(v);
  };

  const span = max - min || 1;
  const pos = (v: number) => THUMB / 2 + ((Math.min(max, Math.max(min, v)) - min) / span) * Math.max(0, width - THUMB);
  const x = pos(value);
  const from = pos(props.fillFrom ?? min);
  const steps = Math.round(span / step);

  return (
    <View style={[styles.wrap, disabled && { opacity: 0.45 }]}>
      <View style={styles.header}>
        <Text style={[font.body, { flex: 1 }]} numberOfLines={1}>
          {label}
        </Text>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[font.h3, { color: dragging ? color : colors.text, fontVariant: ['tabular-nums'] }]}>{format(value)}</Text>
          {sub ? <Text style={[font.tiny, { marginTop: 1 }]}>{sub}</Text> : null}
        </View>
      </View>
      <View style={styles.row}>
        <StepButton icon="minus" label={`Decrease ${label}`} onPress={() => nudge(-1)} disabled={disabled || value <= min} />
        <View
          style={styles.touch}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          accessible
          role="slider"
          aria-label={label}
          aria-disabled={!!disabled}
          aria-valuemin={0}
          aria-valuemax={steps}
          aria-valuenow={Math.round((value - min) / step)}
          aria-valuetext={format(value)}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
          {...pan.panHandlers}
        >
          <View style={styles.track} />
          {width > 0 ? (
            <>
              <View style={[styles.fill, { left: Math.min(from, x), width: Math.abs(x - from), backgroundColor: color }]} />
              {props.mark !== undefined ? <View style={[styles.mark, { left: pos(props.mark) - 1 }]} /> : null}
              <View
                style={[
                  styles.thumb,
                  { left: x - THUMB / 2, borderColor: color },
                  dragging && { transform: [{ scale: 1.2 }], backgroundColor: color },
                ]}
              />
            </>
          ) : null}
        </View>
        <StepButton icon="plus" label={`Increase ${label}`} onPress={() => nudge(1)} disabled={disabled || value >= max} />
      </View>
    </View>
  );
}

function StepButton({ icon, label, onPress, disabled }: { icon: string; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.stepBtn, { opacity: disabled ? 0.35 : pressed ? 0.7 : 1 }]}
    >
      <Icon name={icon} size={16} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: space.xs },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // box-only: touches always target the track itself, so locationX is measured from its left edge.
  touch: { flex: 1, height: TOUCH_H, justifyContent: 'center', cursor: 'pointer', userSelect: 'none', pointerEvents: 'box-only' },
  track: { height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: colors.border, marginHorizontal: THUMB / 2 - TRACK_H / 2 },
  fill: { position: 'absolute', top: (TOUCH_H - TRACK_H) / 2, height: TRACK_H, borderRadius: TRACK_H / 2 },
  mark: { position: 'absolute', top: (TOUCH_H - 14) / 2, width: 2, height: 14, borderRadius: 1, backgroundColor: colors.textFaint },
  thumb: {
    position: 'absolute',
    top: (TOUCH_H - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 3,
    backgroundColor: colors.bg,
  },
  stepBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
});
