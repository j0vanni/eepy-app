/**
 * "How alert are you right now?" — the rating the energy forecast is fitted to.
 *
 *   AlertnessPicker  the answer as large targets: the three quick answers, then the 1–9 scale
 *   NumberScale      a row of numbered buttons with the wording of the selected one
 *   ChoiceTile       one large answer (a face or a number over a word)
 *   QuickCheckIn     the compact one-tap version inside a panel (Energy)
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useStore } from '@/state/store';
import { Chip, Link, Row } from '../components';
import { confirmHaptic } from '../haptics';
import { colors, font, radius, space, touch } from '../theme';

/** Karolinska Sleepiness Scale wording (1–9). */
export const KSS_LABELS: Record<number, string> = {
  1: 'Extremely alert',
  2: 'Very alert',
  3: 'Alert',
  4: 'Rather alert',
  5: 'Neither alert nor sleepy',
  6: 'Some signs of sleepiness',
  7: 'Sleepy, no effort to stay awake',
  8: 'Sleepy, some effort to stay awake',
  9: 'Very sleepy, fighting sleep',
};

/** The same three answers as the ping notification buttons. */
export const QUICK_KSS = [
  { kss: 3, label: '😀 Alert' },
  { kss: 5, label: '😐 OK' },
  { kss: 7, label: '🥱 Sleepy' },
];

const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** One large answer: something big (a face, a number) over a word. Amber when it is the answer. */
export function ChoiceTile({
  top,
  label,
  selected,
  onPress,
  hint,
  onPanel,
  small,
}: {
  top: string;
  label: string;
  selected?: boolean;
  onPress: () => void;
  /** For a screen reader, when the label alone says too little. */
  hint?: string;
  /** Sits inside a panel: one step lighter, so it still reads as a button. */
  onPanel?: boolean;
  /** One of five or more in a row. */
  small?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={hint ?? label}
      style={({ pressed }) => [styles.tile, small ? styles.tileSmall : null, onPanel ? styles.onPanel : null, selected ? styles.on : null, pressed ? { opacity: 0.75 } : null]}
    >
      <Text style={[small ? font.h2 : font.h1, selected ? { color: colors.onAccent } : null]}>{top}</Text>
      <Text
        style={[small ? font.tiny : font.small, { fontWeight: '700', color: selected ? colors.onAccent : small ? colors.textDim : colors.text, textAlign: 'center' }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A row of numbered buttons (1–9 by default) and, under it, what the selected number means. */
export function NumberScale({
  value,
  onPick,
  labels = KSS_LABELS,
  hint = '1 is wide awake, 9 is fighting sleep',
  onPanel,
}: {
  value?: number;
  onPick: (n: number) => void;
  labels?: Record<number, string>;
  /** Shown until a number is picked. */
  hint?: string;
  onPanel?: boolean;
}) {
  const picked = value !== undefined ? Math.round(value) : undefined;
  return (
    <View>
      <View style={styles.scale}>
        {SCALE.map((n) => {
          const on = picked === n;
          return (
            <Pressable
              key={n}
              onPress={() => onPick(n)}
              hitSlop={{ top: 4, bottom: 4 }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${n}: ${labels[n]}`}
              style={({ pressed }) => [styles.step, onPanel ? styles.onPanel : null, on ? styles.on : null, pressed ? { opacity: 0.75 } : null]}
            >
              <Text style={[font.h3, { fontVariant: ['tabular-nums'] }, on ? { color: colors.onAccent } : null]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[font.small, { marginTop: space.sm, textAlign: 'center' }, picked !== undefined ? { color: colors.text } : null]}>
        {picked !== undefined && labels[picked] ? `${picked} of 9 · ${labels[picked]}` : hint}
      </Text>
    </View>
  );
}

/** The answer to "How alert are you right now?": three quick answers, then the full scale. */
export function AlertnessPicker({ value, onPick }: { value?: number; onPick: (kss: number) => void }) {
  const picked = value !== undefined ? Math.round(value) : undefined;
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.quick}>
        {QUICK_KSS.map((q) => {
          const [face, ...word] = q.label.split(' ');
          return <ChoiceTile key={q.kss} top={face} label={word.join(' ')} selected={picked === q.kss} onPress={() => onPick(q.kss)} hint={`${word.join(' ')}: ${q.kss} of 9`} />;
        })}
      </View>
      <NumberScale value={value} onPick={onPick} />
    </View>
  );
}

/** The compact version: a prompt and the three quick answers. Saving is the tap; Undo takes it back. */
export function QuickCheckIn({ prompt = 'How alert are you right now?', showFullScale = true }: { prompt?: string; showFullScale?: boolean }) {
  const addCheckIn = useStore((s) => s.addCheckIn);
  const removeCheckIn = useStore((s) => s.removeCheckIn);
  const [logged, setLogged] = useState<{ id: string; kss: number }>();
  const log = (kss: number) => {
    const time = Date.now();
    const id = `manual-${time}`;
    addCheckIn({ id, time, kss, source: 'manual' });
    confirmHaptic();
    setLogged({ id, kss });
  };
  if (logged) {
    return (
      <Row gap={space.sm} style={{ minHeight: touch.min }}>
        <Text style={[font.small, { flex: 1 }]}>Saved: {KSS_LABELS[logged.kss].toLowerCase()}. That sharpens your forecast.</Text>
        <Link
          label="Undo"
          onPress={() => {
            removeCheckIn(logged.id);
            setLogged(undefined);
          }}
        />
      </Row>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      <Text style={font.small}>{prompt}</Text>
      <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
        {QUICK_KSS.map((q) => (
          <Chip key={q.kss} label={q.label} onPress={() => log(q.kss)} />
        ))}
        {showFullScale ? <Chip label="1–9 scale" icon="tune-variant" onPress={() => router.push('/checkin')} /> : null}
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  quick: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, minHeight: 92, borderRadius: radius.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingHorizontal: space.xs, paddingVertical: space.md },
  tileSmall: { minHeight: 68, borderRadius: radius.md, paddingVertical: space.sm, gap: 0 },
  scale: { flexDirection: 'row', gap: space.xs },
  step: { flex: 1, minHeight: touch.comfy, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  onPanel: { backgroundColor: colors.surfaceAlt },
  on: { backgroundColor: colors.accent },
});
