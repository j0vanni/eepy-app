/**
 * Motion primitives built on react-native-reanimated: entering cards, filling rings/bars/arcs,
 * charts that draw on, and a pulsing "now" marker.
 *
 * Reanimated is loaded defensively. Under Jest (without reanimated's resolver) its native worklets
 * module can't initialise, so every primitive falls back to a static view with the same layout.
 */
import { ReactNode, useEffect, useState } from 'react';
import { Pressable, PressableProps, StyleProp, View, ViewProps, ViewStyle } from 'react-native';
import { Circle, CircleProps, Path, PathProps } from 'react-native-svg';
import type * as ReanimatedModule from 'react-native-reanimated';

type RA = typeof ReanimatedModule;
declare const require: (id: string) => unknown;

let R: RA | undefined;
try {
  R = require('react-native-reanimated') as RA;
} catch {
  R = undefined;
}

export const motionAvailable = R !== undefined;

// Views mounted in one burst (a screen's first render) cascade in instead of popping in together.
let burstAt = 0;
let burstIndex = 0;
function nextEnterDelay(): number {
  const t = Date.now();
  if (t - burstAt > 150) burstIndex = 0;
  burstAt = t;
  return Math.min(burstIndex++ * 45, 315);
}

type EnterViewProps = ViewProps & { children?: ReactNode; animate?: boolean };
type EnterPressableProps = Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  animate?: boolean;
};

/** Duration for moving a fill from `from` to `to`: big jumps ease in slowly, small updates follow quickly. */
const fillDuration = (from: number, to: number) => (Math.abs(to - from) > 0.04 ? 900 : 300);

function makeAnimated(Re: RA) {
  const { default: Animated, FadeInDown, Easing, useSharedValue, useAnimatedStyle, useAnimatedProps, withTiming, withRepeat, cancelAnimation, useReducedMotion } = Re;
  const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
  const AnimatedCircle = Animated.createAnimatedComponent(Circle);
  const AnimatedPath = Animated.createAnimatedComponent(Path);
  const easeOut = Easing.out(Easing.cubic);

  function useFraction(target: number) {
    const sv = useSharedValue(0);
    useEffect(() => {
      sv.set(withTiming(target, { duration: fillDuration(sv.get(), target), easing: easeOut }));
    }, [sv, target]);
    return sv;
  }

  function EnterView({ animate = true, children, ...rest }: EnterViewProps) {
    const [delay] = useState(nextEnterDelay);
    return (
      <Animated.View entering={animate ? FadeInDown.duration(380).delay(delay) : undefined} {...rest}>
        {children}
      </Animated.View>
    );
  }

  function EnterPressable({ animate = true, style, pressedStyle, children, ...rest }: EnterPressableProps) {
    const [delay] = useState(nextEnterDelay);
    const [pressed, setPressed] = useState(false);
    return (
      <AnimatedPressable
        entering={animate ? FadeInDown.duration(380).delay(delay) : undefined}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={[style, pressed ? pressedStyle : null]}
        {...rest}
      >
        {children}
      </AnimatedPressable>
    );
  }

  /** A circle stroke filled to `fraction` of its circumference (starts at 3 o'clock; rotate to taste). */
  function FillCircle({ fraction, circumference, ...rest }: CircleProps & { fraction: number; circumference: number }) {
    const f = useFraction(fraction);
    const props = useAnimatedProps(() => {
      'worklet';
      return { strokeDashoffset: circumference * (1 - f.get()), strokeOpacity: f.get() > 0.001 ? 1 : 0 };
    });
    return <AnimatedCircle {...rest} strokeDasharray={`${circumference} ${circumference}`} animatedProps={props} />;
  }

  function FillPath({ fraction, length, ...rest }: PathProps & { fraction: number; length: number }) {
    const f = useFraction(fraction);
    const props = useAnimatedProps(() => {
      'worklet';
      return { strokeDashoffset: length * (1 - f.get()), strokeOpacity: f.get() > 0.001 ? 1 : 0 };
    });
    return <AnimatedPath {...rest} strokeDasharray={`${length} ${length}`} animatedProps={props} />;
  }

  function FillBar({ fraction, style }: { fraction: number; style?: StyleProp<ViewStyle> }) {
    const f = useFraction(fraction);
    const animated = useAnimatedStyle(() => {
      'worklet';
      return { width: `${f.get() * 100}%` };
    });
    return <Animated.View style={[style, animated]} />;
  }

  /** Clips its children to a width that grows from 0, so a chart draws on left to right. */
  function Reveal({ width, height, duration = 750, children }: { width: number; height: number; duration?: number; children: ReactNode }) {
    const w = useSharedValue(0);
    useEffect(() => {
      // First reveal animates; later size changes (rotation, resize) snap.
      if (w.get() === 0) w.set(withTiming(width, { duration, easing: easeOut }));
      else w.set(width);
    }, [w, width, duration]);
    const animated = useAnimatedStyle(() => {
      'worklet';
      return { width: w.get() };
    });
    return (
      <Animated.View style={[{ height, overflow: 'hidden' }, animated]}>
        <View style={{ width, height }}>{children}</View>
      </Animated.View>
    );
  }

  /** A soft ring that keeps expanding and fading around a point (the "now" marker). */
  function PulseCircle({ cx, cy, r, color }: { cx: number; cy: number; r: number; color: string }) {
    const reduced = useReducedMotion();
    const p = useSharedValue(0);
    useEffect(() => {
      if (reduced) return;
      p.set(withRepeat(withTiming(1, { duration: 1800, easing: easeOut }), -1, false));
      return () => cancelAnimation(p);
    }, [p, reduced]);
    const props = useAnimatedProps(() => {
      'worklet';
      return { r: r + p.get() * r * 1.6, opacity: 0.55 * (1 - p.get()) };
    });
    if (reduced) return null;
    return <AnimatedCircle cx={cx} cy={cy} fill={color} animatedProps={props} />;
  }

  return { EnterView, EnterPressable, FillCircle, FillPath, FillBar, Reveal, PulseCircle };
}

function makeStatic() {
  function EnterView({ animate: _animate, children, ...rest }: EnterViewProps) {
    return <View {...rest}>{children}</View>;
  }
  function EnterPressable({ animate: _animate, style, pressedStyle, children, ...rest }: EnterPressableProps) {
    return (
      <Pressable style={({ pressed }) => [style, pressed ? pressedStyle : null]} {...rest}>
        {children}
      </Pressable>
    );
  }
  function FillCircle({ fraction, circumference, ...rest }: CircleProps & { fraction: number; circumference: number }) {
    return <Circle {...rest} strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - fraction)} strokeOpacity={fraction > 0.001 ? 1 : 0} />;
  }
  function FillPath({ fraction, length, ...rest }: PathProps & { fraction: number; length: number }) {
    return <Path {...rest} strokeDasharray={`${length} ${length}`} strokeDashoffset={length * (1 - fraction)} strokeOpacity={fraction > 0.001 ? 1 : 0} />;
  }
  function FillBar({ fraction, style }: { fraction: number; style?: StyleProp<ViewStyle> }) {
    return <View style={[style, { width: `${fraction * 100}%` }]} />;
  }
  function Reveal({ width, height, children }: { width: number; height: number; duration?: number; children: ReactNode }) {
    return <View style={{ width, height }}>{children}</View>;
  }
  function PulseCircle(_props: { cx: number; cy: number; r: number; color: string }) {
    return null;
  }
  return { EnterView, EnterPressable, FillCircle, FillPath, FillBar, Reveal, PulseCircle };
}

const M = R ? makeAnimated(R) : makeStatic();

/** A view that fades and slides up into place when it mounts. */
export const EnterView = M.EnterView;
/** A pressable that enters like EnterView and dims while pressed. */
export const EnterPressable = M.EnterPressable;
export const FillCircle = M.FillCircle;
export const FillPath = M.FillPath;
export const FillBar = M.FillBar;
export const Reveal = M.Reveal;
export const PulseCircle = M.PulseCircle;
