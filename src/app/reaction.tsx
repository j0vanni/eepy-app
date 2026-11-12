/**
 * Reaction test: one minute of "tap when the panel lights up". An objective reading of alertness
 * to set beside the self-rating (engine/reaction.ts).
 */
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { planWaits, REACTION, REACTION_VERDICT_TEXT, readReaction, ReactionReading } from '@/engine/reaction';
import { dateKey, formatTime } from '@/engine/time';
import type { ReactionTest } from '@/engine/types';
import { useStore } from '@/state/store';
import { Button, Card, Hero, KeyValue, ListCard, Row, Screen, Section } from '@/ui/components';
import { confirm } from '@/ui/confirm';
import { dayLabel } from '@/ui/format';
import { confirmHaptic, selectionTick } from '@/ui/haptics';
import { colors, font, radius, space } from '@/ui/theme';

type Stage = 'intro' | 'wait' | 'go' | 'early' | 'done';

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function verdictColor(r: ReactionReading): string {
  return r.verdict === 'sharp' ? colors.good : r.verdict === 'slow' ? colors.warn : r.verdict === 'very-slow' ? colors.bad : colors.text;
}

export default function ReactionScreen() {
  const reactions = useStore((s) => s.reactions);
  const addReaction = useStore((s) => s.addReaction);
  const removeReaction = useStore((s) => s.removeReaction);
  const [stage, setStage] = useState<Stage>('intro');
  const [trial, setTrial] = useState(0);
  const [lastRt, setLastRt] = useState<number>();
  const [result, setResult] = useState<ReactionTest>();
  const run = useRef({ waits: [] as number[], rts: [] as number[], falseStarts: 0, misses: 0, shownAt: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => clear, []);

  const finish = () => {
    clear();
    const r = run.current;
    const time = Date.now();
    const test: ReactionTest = { id: `rt-${time}`, time, rts: r.rts, falseStarts: r.falseStarts, misses: r.misses };
    addReaction(test);
    setResult(test);
    setStage('done');
    confirmHaptic();
  };

  /** Starts the wait before signal `i` (or finishes after the last one). */
  const arm = (i: number) => {
    clear();
    if (i >= run.current.waits.length) return finish();
    setTrial(i);
    setStage('wait');
    timer.current = setTimeout(() => {
      run.current.shownAt = nowMs();
      setStage('go');
      // No tap in time: a miss, on to the next.
      timer.current = setTimeout(() => {
        run.current.misses++;
        setLastRt(undefined);
        arm(i + 1);
      }, REACTION.timeoutMs);
    }, run.current.waits[i]);
  };

  const start = () => {
    run.current = { waits: planWaits(), rts: [], falseStarts: 0, misses: 0, shownAt: 0 };
    setResult(undefined);
    setLastRt(undefined);
    arm(0);
  };

  const tap = () => {
    if (stage === 'go') {
      const rt = Math.round(nowMs() - run.current.shownAt);
      // Faster than a human can react: it was a guess.
      if (rt < REACTION.anticipationMs) run.current.falseStarts++;
      else run.current.rts.push(rt);
      setLastRt(rt);
      selectionTick();
      arm(trial + 1);
    } else if (stage === 'wait') {
      // Tapped before the signal: say so, then start this one again.
      run.current.falseStarts++;
      clear();
      setStage('early');
      timer.current = setTimeout(() => arm(trial), 900);
    }
  };

  const earlier = useMemo(() => (result ? reactions.filter((t) => t.id !== result.id) : reactions), [reactions, result]);
  const reading = useMemo(() => (result ? readReaction(result, earlier) : undefined), [result, earlier]);
  const history = useMemo(() => [...reactions].sort((x, y) => y.time - x.time).slice(0, 8), [reactions]);

  if (stage === 'wait' || stage === 'go' || stage === 'early') {
    const go = stage === 'go';
    return (
      <View style={styles.fill}>
        <Pressable onPressIn={tap} style={[styles.pad, go ? { backgroundColor: colors.accent } : null]} accessibilityRole="button" accessibilityLabel={go ? 'Tap now' : 'Wait for the signal'}>
          <Text style={[styles.padText, go ? { color: colors.onAccent } : null]}>{go ? 'Tap' : stage === 'early' ? 'Too soon' : 'Wait…'}</Text>
          <Text style={[font.small, go ? { color: colors.onAccent } : null]}>
            {stage === 'early' ? 'Wait until it turns amber.' : `${trial + 1} of ${run.current.waits.length}${lastRt !== undefined && !go ? ` · ${lastRt} ms` : ''}`}
          </Text>
        </Pressable>
        <View style={{ padding: space.lg }}>
          <Button
            kind="ghost"
            label="Stop"
            onPress={() => {
              clear();
              setStage('intro');
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <Screen>
      {stage === 'done' && result ? (
        reading ? (
          <>
            <Hero
              label="Your reaction time"
              value={String(reading.medianMs)}
              unit="ms"
              color={verdictColor(reading)}
              caption={
                reading.verdict
                  ? `${REACTION_VERDICT_TEXT[reading.verdict]} (${reading.usualMs} ms).`
                  : `eepy compares this with your own earlier tests — ${Math.max(0, REACTION.minBaseline - earlier.length)} more to have a "usual".`
              }
            />
            <ListCard>
              <KeyValue label="Slowest taps" value={`${reading.slowestMs} ms`} sub="Sleepiness shows here first" />
              {reading.lapses !== undefined ? <KeyValue label="Lapses" value={String(reading.lapses)} sub="Much slower than your usual, or missed" color={reading.lapses >= 2 ? colors.warn : colors.text} /> : null}
              <KeyValue label="Too soon" value={String(reading.falseStarts)} />
            </ListCard>
          </>
        ) : (
          <Hero label="Your reaction time" value="Not enough taps" caption="Fewer than five taps counted. Try again and tap as soon as the panel turns amber." />
        )
      ) : (
        <Hero
          label="Reaction test"
          value="One minute"
          caption={`The panel turns amber ${REACTION.trials} times. Tap it as fast as you can each time. Slower, patchier taps mean lower alertness — whatever you'd have guessed.`}
        />
      )}
      <View style={{ gap: space.sm, marginBottom: space.md }}>
        <Button big label={stage === 'done' ? 'Again' : 'Start'} icon="gesture-tap" onPress={start} />
        {stage === 'done' ? <Button kind="secondary" label="Done" onPress={() => router.back()} /> : null}
      </View>
      {history.length ? (
        <Section title="Earlier tests">
          <Card style={{ paddingVertical: space.xs }}>
            {history.map((t, i) => {
              const r = readReaction(
                t,
                reactions.filter((x) => x.time < t.time),
              );
              return (
                <Pressable
                  key={t.id}
                  onLongPress={async () => {
                    if (await confirm('Delete this test?', `${formatTime(t.time)} · ${r?.medianMs ?? '–'} ms`, 'Delete', true)) removeReaction(t.id);
                  }}
                  style={[styles.historyRow, i ? { borderTopWidth: 1, borderTopColor: colors.border } : null]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={font.body}>
                      {dayLabel(dateKey(t.time))} {formatTime(t.time)}
                    </Text>
                    {r?.verdict ? <Text style={font.small}>{REACTION_VERDICT_TEXT[r.verdict]}</Text> : null}
                  </View>
                  <Text style={[font.h3, { color: r ? verdictColor(r) : colors.textDim, fontVariant: ['tabular-nums'] }]}>{r ? `${r.medianMs} ms` : '–'}</Text>
                </Pressable>
              );
            })}
          </Card>
          <Row>
            <Text style={[font.tiny, { paddingHorizontal: space.xs }]}>Press and hold a test to delete it.</Text>
          </Row>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  pad: { flex: 1, margin: space.lg, marginBottom: 0, borderRadius: radius.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  padText: { fontSize: 44, fontWeight: '800', color: colors.textDim, letterSpacing: -1 },
  historyRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: space.sm },
});
