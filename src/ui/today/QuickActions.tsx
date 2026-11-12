/**
 * Today's row of one-tap actions: log a coffee, check in, nap, and the evening's own step — adjust
 * tonight during the day, wind down in the evening, and from the start of wind-down "I'm in bed",
 * which starts the sleep session right here.
 */
import { Href, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import type { DayPhase } from '@/engine/dayPhase';
import { isOpen } from '@/engine/inBed';
import { sessionFor, startInBedSession } from '@/state/inBed';
import { useStore } from '@/state/store';
import { ActionTile } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { colors, space } from '@/ui/theme';

interface Action {
  icon: string;
  label: string;
  color?: string;
  primary?: boolean;
  href?: Href;
  onPress?: () => void;
}

export function QuickActions({ phase, a, now }: { phase: DayPhase; a?: Analysis; now?: number }) {
  const napping = useStore((s) => !!s.settings.napTimer);
  // Only tonight's own times count (an earlier night's is ignored by the plan).
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
    ? { icon: 'bed', label: "I'm in bed", primary: true, onPress: startInBed }
    : phase === 'evening'
      ? { icon: 'weather-night', label: 'Wind down', color: colors.sleep, href: '/winddown' }
      : { icon: 'clock-edit-outline', label: adjusted ? 'Tonight (changed)' : 'Adjust tonight', href: '/tonight' };
  const actions: Action[] = [
    { icon: 'coffee-outline', label: 'Log coffee', color: colors.caffeine, href: '/caffeine' },
    { icon: 'emoticon-happy-outline', label: 'Check in', href: '/checkin' },
    { icon: napping ? 'timer-sand' : 'sleep', label: napping ? 'Napping' : 'Nap', href: '/nap' },
    last,
  ];
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.md }}>
      {actions.map((x) => (
        <ActionTile
          key={x.label}
          icon={x.icon}
          label={x.label}
          color={x.color}
          tone={x.primary ? 'primary' : 'default'}
          onPress={() => (x.onPress ? x.onPress() : x.href && router.push(x.href))}
        />
      ))}
    </View>
  );
}
