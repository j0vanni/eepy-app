/**
 * Press-and-drag scrubbing for charts, on React Native's PanResponder (no gesture-handler root
 * view needed, works on web and in Jest).
 *
 * A touch becomes a scrub after a short hold or a mostly-horizontal drag; a vertical swipe is left
 * to the page's ScrollView. While scrubbing, the enclosing Screen's scrolling is locked so drifting
 * up or down doesn't steal the gesture. A quick tap selects a point (or calls `onTap`).
 */
import { useEffect, useState } from 'react';
import { GestureResponderHandlers, LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';

import { useScrollLock } from './components';
import { selectionTick } from './haptics';
import { colors, font, radius } from './theme';

const HOLD_MS = 200;
const SLOP = 8;

export interface ScrubSelection {
  /** Finger position, px from the chart's left edge. */
  x: number;
  index: number;
}

export interface ScrubConfig {
  /** Maps an x position (px from the chart's left edge) to a point index. */
  indexAt: (x: number) => number | undefined;
  /** Haptic ticks fire when this changes; defaults to the index. */
  tickKey?: (index: number) => number | string;
  /** Called on a quick tap; return false to show the tooltip instead. */
  onTap?: (index: number) => boolean | void;
}

type Timer = ReturnType<typeof setTimeout> | undefined;

interface ScrubState {
  active: boolean;
  /** The touch turned into a vertical swipe; leave it to the scroll view. */
  moved: boolean;
  x0: number;
  key?: number | string;
  hold: Timer;
  clear: Timer;
}

type Live = ScrubConfig & { lockScroll: (locked: boolean) => void };

/** The gesture state machine, created once per chart; `setLive` feeds it the latest config after each render. */
function createScrubMachine(setSelection: (s: ScrubSelection | undefined) => void) {
  const s: ScrubState = { active: false, moved: false, x0: 0, hold: undefined, clear: undefined };
  let live: Live | undefined;
  const select = (x: number, tick = true) => {
    const index = live?.indexAt(x);
    if (!live || index === undefined) return;
    const key = live.tickKey ? live.tickKey(index) : index;
    if (key !== s.key) {
      if (tick) selectionTick();
      s.key = key;
    }
    setSelection({ x, index });
  };
  const activate = (x: number) => {
    s.active = true;
    s.key = undefined;
    live?.lockScroll(true);
    select(x);
  };
  const finish = (keepMs: number) => {
    clearTimeout(s.hold);
    if (s.active) live?.lockScroll(false);
    s.active = false;
    s.key = undefined;
    clearTimeout(s.clear);
    if (keepMs <= 0) setSelection(undefined);
    else s.clear = setTimeout(() => setSelection(undefined), keepMs);
  };
  const horizontal = (dx: number, dy: number) => Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy);
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => horizontal(g.dx, g.dy),
    // Until the scrub starts, a vertical swipe may still scroll the page.
    onShouldBlockNativeResponder: () => false,
    onPanResponderTerminationRequest: () => !s.active,
    onPanResponderGrant: (e) => {
      clearTimeout(s.clear);
      clearTimeout(s.hold);
      s.x0 = e.nativeEvent.locationX;
      s.moved = false;
      s.active = false;
      s.hold = setTimeout(() => activate(s.x0), HOLD_MS);
    },
    onPanResponderMove: (_, g) => {
      if (s.active) {
        select(s.x0 + g.dx);
        return;
      }
      if (s.moved) return;
      if (horizontal(g.dx, g.dy)) {
        clearTimeout(s.hold);
        activate(s.x0 + g.dx);
      } else if (Math.abs(g.dy) > SLOP) {
        clearTimeout(s.hold);
        s.moved = true;
      }
    },
    onPanResponderRelease: (_, g) => {
      const tap = !s.active && !s.moved && Math.abs(g.dx) < SLOP && Math.abs(g.dy) < SLOP;
      if (!tap) {
        finish(s.active ? 1200 : 0);
        return;
      }
      clearTimeout(s.hold);
      const index = live?.indexAt(s.x0);
      if (index !== undefined && live?.onTap && live.onTap(index) !== false) {
        finish(0);
        return;
      }
      s.key = undefined;
      select(s.x0);
      finish(2500);
    },
    onPanResponderTerminate: () => finish(0),
  });
  return {
    panHandlers: responder.panHandlers,
    setLive: (l: Live) => {
      live = l;
    },
    dispose: () => {
      clearTimeout(s.hold);
      clearTimeout(s.clear);
      if (s.active) live?.lockScroll(false);
    },
  };
}

export function useScrub(cfg: ScrubConfig): { selection?: ScrubSelection; panHandlers: GestureResponderHandlers } {
  const [selection, setSelection] = useState<ScrubSelection>();
  const lockScroll = useScrollLock();
  const [machine] = useState(() => createScrubMachine(setSelection));
  useEffect(() => machine.setLive({ ...cfg, lockScroll }));
  useEffect(() => () => machine.dispose(), [machine]);
  return { selection, panHandlers: machine.panHandlers };
}

/** Transparent layer on top of a chart that receives the touches. */
export function ScrubSurface({ panHandlers, label }: { panHandlers: GestureResponderHandlers; label?: string }) {
  // collapsable={false}: a transparent view must not be flattened away, or it can't receive touches.
  return <View collapsable={false} style={StyleSheet.absoluteFill} accessibilityLabel={label} accessibilityHint={label ? 'Touch and drag to read values' : undefined} {...panHandlers} />;
}

/** Floating readout above (or below) the scrubbed point, kept inside the chart's width. */
export function ScrubTooltip({
  x,
  width,
  title,
  value,
  detail,
  color = colors.text,
  bottom,
}: {
  x: number;
  width: number;
  title: string;
  value: string;
  detail?: string;
  color?: string;
  /** Place it at the bottom of the chart (when the point is near the top). */
  bottom?: number;
}) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width));
  const left = Math.max(0, Math.min(width - w, x - w / 2));
  return (
    <View
      onLayout={onLayout}
      style={[styles.tip, bottom !== undefined ? { bottom } : { top: 0 }, { left, opacity: w ? 1 : 0, pointerEvents: 'none' }]}
    >
      <Text style={[font.tiny, { color: colors.textDim }]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={{ color, fontWeight: '700', fontSize: 14, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
        {value}
      </Text>
      {detail ? (
        <Text style={[font.tiny, { color: colors.textDim }]} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tip: {
    position: 'absolute',
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 220,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
});
