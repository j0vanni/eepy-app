/**
 * Today's row of big one-tap buttons: log coffee, check in, nap, and adjust tonight (wind down in the
 * evening; from the start of wind-down "I'm in bed", which starts the sleep session right here).
 */
import { Href, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import type { DayPhase } from '@/engine/dayPhase';
import { isOpen } from '@/engine/inBed';
import { sessionFor, startInBedSession } from '@/state/inBed';
import { useStore } from '@/state/store';
import { Icon } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { colors, radius, space } from '@/ui/theme';

interface Action {
  icon: string;
  label: string;
  hint: string;
  color: string;
  href?: Href;
  onPress?: () => void;
}

export function QuickActions({ phase, a, now }: { phase: DayPhase; a?: Analysis; now?: number }) {
  const napping = useStore((s) => !!s.settings.napTimer);
  // Only tonight's own times count (an earlier night's — e.g. last night's "I'm in bed" — is ignored by the plan).
  const adjusted = useStore((s) => !!s.settings.tonight && (!a || s.settings.tonight.wakeDate === a.tonight.wakeDate));
  const inBed = useStore((s) => !!a && isOpen(sessionFor(s.settings.session, a)));
  const [starting, setStarting] = useState(false);
  const winding = phase === 'evening' && !!a && now !== undefined && now >= a.tonight.windDownStart && !inBed;
  const startInBed = async () => {
    if (!a || starting) return;
    setStarting(true);
    confirmHaptic();
    await startInBedSession(a).catch((e) => console.warn('in-bed start failed', e));
    setStarting(false);
  };
  const last: Action = winding
    ? { icon: 'bed', label: "I'm in bed", hint: 'Starts your sleep session: alarm timed from now, reminders off', color: colors.light, onPress: startInBed }
    : phase === 'evening'
      ? { icon: 'weather-night', label: 'Wind down', hint: 'Countdown, checklist, breathing and sounds', color: colors.light, href: '/winddown' }
      : { icon: 'clock-edit-outline', label: adjusted ? 'Tonight (changed)' : 'Adjust tonight', hint: "Can't make tonight's bedtime? Move it", color: colors.energy, href: '/tonight' };
  const actions: Action[] = [
    { icon: 'coffee-outline', label: 'Log coffee', hint: 'Log a drink at the time you had it', color: colors.caffeine, href: '/caffeine' },
    { icon: 'emoticon-happy-outline', label: 'Check in', hint: 'How sleepy or energetic you feel, plus tags', color: colors.good, href: '/checkin' },
    { icon: napping ? 'timer-sand' : 'sleep', label: napping ? 'Napping' : 'Nap', hint: 'Should you nap, and for how long', color: colors.accent, href: '/nap' },
    last,
  ];
  return (
    <View style={styles.row}>
      {actions.map((x) => (
        <Pressable
          key={x.label}
          onPress={() => (x.onPress ? x.onPress() : x.href && router.push(x.href))}
          disabled={x.onPress === startInBed && starting}
          style={({ pressed }) => [styles.tile, pressed ? { opacity: 0.75, transform: [{ scale: 0.97 }] } : null]}
          accessibilityRole="button"
          accessibilityLabel={x.label}
          accessibilityHint={x.hint}
        >
          <View style={[styles.circle, { backgroundColor: `${x.color}22` }]}>
            <Icon name={x.icon} size={24} color={x.color} />
          </View>
          <Text style={styles.label} numberOfLines={2}>
            {x.label}
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
