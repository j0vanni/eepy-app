/**
 * Paced breathing as it opens in place on the wind-down screen: box (4-4-4-4) or 4-7-8, a circle
 * that grows and shrinks with the breath, a countdown and a haptic cue at every phase.
 */
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Button, Chip, Note, Segmented } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

import { BREATH_PATTERNS, BreathPatternId, BreathPhaseKind, breathStateAt, MIN_SCALE, phaseTargetScale, SESSION_MINUTES, sessionCycles } from '../breathing';
import { formatRemaining } from '../envelope';

const SIZE = 216;

function cue(kind: BreathPhaseKind | 'done') {
  if (Platform.OS === 'web') return;
  const run =
    kind === 'done'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(kind === 'inhale' ? Haptics.ImpactFeedbackStyle.Medium : kind === 'exhale' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Soft);
  run.catch(() => undefined);
}

export function Breathing() {
  const [patternId, setPatternId] = useState<BreathPatternId>('box');
  const [minutes, setMinutes] = useState<number>(5);
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const [finished, setFinished] = useState<number | undefined>(undefined);
  const pattern = BREATH_PATTERNS[patternId];
  const running = startedAt !== undefined;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running]);

  const state = startedAt !== undefined ? breathStateAt(pattern, minutes, now - startedAt) : undefined;
  const step = state && !state.done ? state.step : -1;

  const scale = useSharedValue(MIN_SCALE);
  useEffect(() => {
    if (!state || state.done) {
      scale.set(withTiming(MIN_SCALE, { duration: 900, easing: Easing.out(Easing.quad) }));
      return;
    }
    const remaining = (1 - state.phaseProgress) * state.phase.seconds * 1000;
    scale.set(withTiming(phaseTargetScale(state.phase.kind), { duration: Math.max(150, remaining), easing: Easing.inOut(Easing.sin) }));
    cue(state.phase.kind);
    // Only a new phase should restart the animation (state changes every tick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (!state?.done) return;
    cue('done');
    setFinished(state.cycles);
    setStartedAt(undefined);
  }, [state?.done, state?.cycles]);

  const core = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const halo = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() * 1.14 }],
    opacity: interpolate(scale.get(), [MIN_SCALE, 1], [0.08, 0.22]),
  }));

  const start = () => {
    setFinished(undefined);
    setNow(Date.now());
    setStartedAt(Date.now());
  };
  const restartIfRunning = () => {
    if (running) start();
  };

  const showing = state && !state.done ? state : undefined;
  const cycles = sessionCycles(pattern, minutes);

  return (
    <View>
      <Segmented
        options={[
          { label: 'Box 4·4·4·4', value: 'box' as BreathPatternId },
          { label: '4·7·8', value: '478' as BreathPatternId },
        ]}
        value={patternId}
        onChange={(v) => {
          setPatternId(v);
          restartIfRunning();
        }}
      />
      <Text style={[font.small, { marginTop: space.sm }]}>{pattern.blurb}</Text>

      <View style={styles.stage} accessibilityLiveRegion="polite" accessibilityLabel={showing ? `${showing.phase.label}, ${showing.phaseSecondsLeft}` : 'Breathing pacer'}>
        <Animated.View style={[styles.circle, styles.halo, halo]} />
        <Animated.View style={[styles.circle, styles.core, core]} />
        <View style={styles.center}>
          {showing ? (
            <>
              <Text style={font.h3}>{showing.phase.label}</Text>
              <Text style={styles.count}>{showing.phaseSecondsLeft}</Text>
            </>
          ) : (
            <>
              <Text style={font.h3}>{finished ? 'Well done' : 'Ready'}</Text>
              <Text style={font.small}>{pattern.phases.map((p) => p.seconds).join(' · ')}</Text>
            </>
          )}
        </View>
      </View>

      <Text style={[font.small, { textAlign: 'center', marginBottom: space.md }]}>
        {showing
          ? `Breath ${showing.cycle + 1} of ${showing.cycles} · ${formatRemaining(showing.remainingMs)} left`
          : `${cycles} breaths · about ${formatRemaining(cycles * pattern.phases.reduce((s, p) => s + p.seconds, 0) * 1000)}`}
      </Text>

      {!running ? (
        <View style={styles.chips}>
          {SESSION_MINUTES.map((m) => (
            <Chip key={m} label={`${m} min`} selected={minutes === m} onPress={() => setMinutes(m)} />
          ))}
        </View>
      ) : null}

      <Button label={running ? 'Stop' : finished ? 'Again' : 'Start breathing'} icon={running ? 'stop' : 'play'} kind="secondary" onPress={running ? () => setStartedAt(undefined) : start} />

      {finished && !running ? (
        <View style={{ marginTop: space.md }}>
          <Note tone="good">{finished} slow breaths done. Carry the calm into lights-out.</Note>
        </View>
      ) : null}
      {patternId === '478' && !running && !finished ? <Text style={[font.tiny, { marginTop: space.md, textAlign: 'center' }]}>New to 4-7-8? Start with 2 minutes. Light-headedness fades with practice.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { height: SIZE * 1.2, alignItems: 'center', justifyContent: 'center', marginVertical: space.md },
  circle: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  // Blue is sleep's colour; the circle is the only thing moving on the screen.
  halo: { backgroundColor: colors.sleep },
  core: { backgroundColor: colors.sleepSoft },
  center: { alignItems: 'center', justifyContent: 'center' },
  // The one number of the exercise: between h1 and display.
  count: { ...font.display, fontSize: 44, lineHeight: 50, letterSpacing: -1 },
  chips: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, marginBottom: space.md },
});
