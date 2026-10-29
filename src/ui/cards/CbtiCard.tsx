// Today slot: the running insomnia programme at a glance, or a gentle nudge when the insomnia check suggests it.
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Text } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { cbtiStatus } from '@/engine/cbti';
import { formatClock } from '@/engine/time';
import { useStore } from '@/state/store';
import { Card, CardTitle, Icon } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

export function CbtiCard({ analysis }: { analysis: Analysis }) {
  const program = useStore((s) => s.cbti);
  const isi = useStore((s) => s.profile.screenings.isi?.score);
  const status = useMemo(
    () => (program?.active ? cbtiStatus(program, analysis.nights, analysis.day) : undefined),
    [program, analysis.nights, analysis.day],
  );

  if (status) {
    const eff = status.current.efficiency ?? status.lastCompleted?.efficiency;
    const parts = [
      'Insomnia programme',
      `week ${status.week}`,
      `in bed ${formatClock(status.bedMin)}–${formatClock(status.wakeMin)}`,
      ...(eff !== undefined ? [`efficiency ${Math.round(eff * 100)}%`] : []),
    ];
    return (
      <Card onPress={() => router.push('/cbti')}>
        <CardTitle icon="account-heart" title={parts.join(' · ')} right={<Icon name="chevron-right" color={colors.textFaint} />} />
        <Text style={[font.small, { marginTop: -space.xs }]}>
          This week: {status.lesson.title.toLowerCase()}. {status.change}
        </Text>
      </Card>
    );
  }

  if (isi !== undefined && isi >= 15 && !program?.active) {
    return (
      <Card onPress={() => router.push('/cbti')}>
        <CardTitle icon="account-heart" title="Sleep could get easier" right={<Icon name="chevron-right" color={colors.textFaint} />} />
        <Text style={font.small}>
          Your insomnia check ({isi}) suggests insomnia that CBT-I helps with. eepy has a 6-week programme built on your watch data, whenever you&apos;re ready.
        </Text>
      </Card>
    );
  }

  return null;
}
