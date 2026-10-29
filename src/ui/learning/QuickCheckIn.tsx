// OWNER: learning workstream. One-tap "how alert are you right now?" used by the learning card and screen.
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useStore } from '@/state/store';
import { Chip, Row } from '../components';
import { colors, font, space } from '../theme';

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

export function QuickCheckIn({ prompt = 'How alert do you feel right now?', showFullScale = true }: { prompt?: string; showFullScale?: boolean }) {
  const addCheckIn = useStore((s) => s.addCheckIn);
  const [logged, setLogged] = useState<number>();
  const log = (kss: number) => {
    const time = Date.now();
    addCheckIn({ id: `manual-${time}`, time, kss, source: 'manual' });
    setLogged(kss);
  };
  if (logged !== undefined) {
    return <Text style={[font.small, { color: colors.good }]}>Logged “{KSS_LABELS[logged]}” — thanks, that sharpens your forecast.</Text>;
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
