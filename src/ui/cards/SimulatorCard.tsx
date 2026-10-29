import { router } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import type { Analysis } from '@/engine/analysis';
import { baselineScenario, simulateTomorrow } from '@/engine/simulate';
import { formatDuration, formatTime, HOUR, MINUTE } from '@/engine/time';
import { selectDataset, useStore } from '@/state/store';
import { Card, CardTitle, Icon } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

/** Today teaser for the "What if?" simulator: one concrete trade-off, tap to play with it. */
export function SimulatorCard({ analysis }: { analysis: Analysis }) {
  const data = useStore(useShallow(selectDataset));
  const teaser = useMemo(() => {
    const base = baselineScenario(analysis);
    // Bed 30 min earlier when there's still time for it, otherwise what staying up 2h would cost.
    const earlier = base.bedtime - 30 * MINUTE >= analysis.now;
    const bedtime = earlier ? base.bedtime - 30 * MINUTE : base.bedtime + 2 * HOUR;
    const r = simulateTomorrow(analysis, data, { ...base, bedtime });
    return { earlier, bedtime, r };
  }, [analysis, data]);

  const { earlier, bedtime, r } = teaser;
  const energy = Math.round(r.delta.avgEnergy);
  const good = energy > 0;
  const color = energy === 0 ? colors.textDim : good ? colors.good : colors.warn;
  const question = earlier ? `What if you went to bed 30 min earlier (${formatTime(bedtime)})?` : `What would staying up until ${formatTime(bedtime)} cost?`;
  const details = [
    `debt ${formatDuration(r.baseline.debtMin)} → ${formatDuration(r.scenario.debtMin)}`,
    `score ${r.baseline.score.total} → ${r.scenario.score.total}`,
  ].join(' · ');

  return (
    <Card onPress={() => router.push('/simulate')}>
      <CardTitle icon="tune-variant" title="What if?" right={<Icon name="chevron-right" color={colors.textFaint} />} />
      <Text style={font.body}>{question}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: space.sm }}>
        <Icon name={good ? 'arrow-up-bold' : energy < 0 ? 'arrow-down-bold' : 'minus'} size={18} color={color} />
        <Text style={[font.h2, { color }]}>
          {energy > 0 ? '+' : energy < 0 ? '−' : '±'}
          {Math.abs(energy)} energy
        </Text>
        <Text style={font.small}>tomorrow</Text>
      </View>
      <Text style={[font.small, { marginTop: 2 }]}>{details}</Text>
      <Text style={[font.tiny, { marginTop: space.sm, color: colors.accent }]}>Try a bedtime, nap or coffee →</Text>
    </Card>
  );
}
