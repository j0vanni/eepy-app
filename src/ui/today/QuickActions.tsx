/** Today's row of big one-tap buttons: log coffee, check in, nap, and adjust tonight (wind down in the evening). */
import { Href, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DayPhase } from '@/engine/dayPhase';
import { useStore } from '@/state/store';
import { Icon } from '@/ui/components';
import { colors, radius, space } from '@/ui/theme';

interface Action {
  icon: string;
  label: string;
  hint: string;
  color: string;
  href: Href;
}

export function QuickActions({ phase }: { phase: DayPhase }) {
  const napping = useStore((s) => !!s.settings.napTimer);
  const adjusted = useStore((s) => !!s.settings.tonight);
  const actions: Action[] = [
    { icon: 'coffee-outline', label: 'Log coffee', hint: 'Log a drink at the time you had it', color: colors.caffeine, href: '/caffeine' },
    { icon: 'emoticon-happy-outline', label: 'Check in', hint: 'How sleepy or energetic you feel, plus tags', color: colors.good, href: '/checkin' },
    { icon: napping ? 'timer-sand' : 'sleep', label: napping ? 'Napping' : 'Nap', hint: 'Should you nap, and for how long', color: colors.accent, href: '/nap' },
    phase === 'evening'
      ? { icon: 'weather-night', label: 'Wind down', hint: 'Countdown, checklist, breathing and sounds', color: colors.light, href: '/winddown' }
      : { icon: 'clock-edit-outline', label: adjusted ? 'Tonight (changed)' : 'Adjust tonight', hint: "Can't make tonight's bedtime? Move it", color: colors.energy, href: '/tonight' },
  ];
  return (
    <View style={styles.row}>
      {actions.map((a) => (
        <Pressable
          key={a.label}
          onPress={() => router.push(a.href)}
          style={({ pressed }) => [styles.tile, pressed ? { opacity: 0.75, transform: [{ scale: 0.97 }] } : null]}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          accessibilityHint={a.hint}
        >
          <View style={[styles.circle, { backgroundColor: `${a.color}22` }]}>
            <Icon name={a.icon} size={24} color={a.color} />
          </View>
          <Text style={styles.label} numberOfLines={2}>
            {a.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  tile: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    paddingVertical: space.md,
    paddingHorizontal: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
