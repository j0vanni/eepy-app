import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Button, Card, CardTitle, Chip, Note, Segmented } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

import { BREATH_PATTERNS, BreathPatternId, BreathPhaseKind, breathStateAt, MIN_SCALE, phaseTargetScale, SESSION_MINUTES, sessionCycles } from '../breathing';
import { formatRemaining } from '../envelope';

const SIZE = 232;

function cue(kind: BreathPhaseKind | 'done') {
  if (Platform.OS === 'web') return;
  const run =
    kind === 'done'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(kind === 'inhale' ? Haptics.ImpactFeedbackStyle.Medium : kind === 'exhale' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Soft);
  run.catch(() => undefined);
}

/** Box (4-4-4-4) or 4-7-8 breathing with a growing/shrinking circle, countdown and haptic cues. */
export function BreathingCard() {
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
    transform: [{ scale: scale.get() * 1.12 }],
    opacity: interpolate(scale.get(), [MIN_SCALE, 1], [0.12, 0.32]),
  }));
  const outerHalo = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() * 1.26 }],
    opacity: interpolate(scale.get(), [MIN_SCALE, 1], [0.04, 0.14]),
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
    <Card>
      <CardTitle icon="meditation" title="Breathe" color={colors.light} />
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
        <View style={[styles.guide, { width: SIZE, height: SIZE, borderRadius: SIZE / 2 }]} />
        <View style={[styles.guide, { width: SIZE * MIN_SCALE, height: SIZE * MIN_SCALE, borderRadius: (SIZE * MIN_SCALE) / 2, borderStyle: 'dashed' }]} />
        <Animated.View style={[styles.circle, { backgroundColor: colors.light }, outerHalo]} />
        <Animated.View style={[styles.circle, { backgroundColor: colors.light }, halo]} />
        <Animated.View style={[styles.circle, styles.core, core]} />
        <View style={styles.center}>
          {showing ? (
            <>
              <Text style={styles.phase}>{showing.phase.label}</Text>
              <Text style={styles.count}>{showing.phaseSecondsLeft}</Text>
            </>
          ) : (
            <>
              <Text style={styles.phase}>{finished ? 'Well done' : 'Ready'}</Text>
              <Text style={styles.pattern}>{pattern.phases.map((p) => p.seconds).join(' · ')}</Text>
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

      <Button label={running ? 'Stop' : finished ? 'Again' : 'Start breathing'} icon={running ? 'stop' : 'play'} kind={running ? 'secondary' : 'primary'} onPress={running ? () => setStartedAt(undefined) : start} />

      {finished && !running ? (
        <View style={{ marginTop: space.md }}>
          <Note tone="good" icon="check-circle-outline">
            {finished} slow breaths done. Your heart rate is already easing — carry the calm into lights-out.
          </Note>
        </View>
      ) : null}
      {patternId === '478' && !running && !finished ? (
        <Text style={[font.tiny, { marginTop: space.md, textAlign: 'center' }]}>New to 4-7-8? Start with 2 minutes; light-headedness fades with practice.</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  stage: { height: SIZE * 1.3, alignItems: 'center', justifyContent: 'center', marginVertical: space.md },
  guide: { position: 'absolute', borderWidth: 1, borderColor: colors.border },
  circle: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  core: { backgroundColor: colors.accentSoft, borderWidth: 2, borderColor: colors.accent },
  center: { alignItems: 'center', justifyContent: 'center' },
  phase: { ...font.h3, color: colors.text, letterSpacing: 0.5 },
  count: { fontSize: 44, fontWeight: '300', color: colors.text, marginTop: 2, fontVariant: ['tabular-nums'] },
  pattern: { ...font.small, marginTop: 4, letterSpacing: 1 },
  chips: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, marginBottom: space.md },
});
