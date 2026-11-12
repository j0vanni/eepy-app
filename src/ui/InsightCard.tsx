/**
 * One personal insight ("After drinking alcohol, your HRV is 13 ms lower"): what eepy found, what it
 * means, and what it is based on. `InsightRow` is the bare row for a list of them (Sleep → Trends);
 * `InsightCard` is the same thing as a panel of its own (the weekly review).
 */
import { Text, View } from 'react-native';

import type { Insight } from '@/engine/insights';

import { Card, Icon, Row } from './components';
import { colors, font, space } from './theme';

const KIND = {
  negative: { icon: 'trending-down', color: colors.warn, label: 'Seems to hurt your sleep' },
  positive: { icon: 'trending-up', color: colors.good, label: 'Seems to help your sleep' },
  neutral: { icon: 'lightbulb-on-outline', color: colors.textDim, label: 'Worth knowing' },
} as const;

export function InsightRow({ insight: i }: { insight: Insight }) {
  const k = KIND[i.kind];
  return (
    <Row gap={space.md} style={{ alignItems: 'flex-start', paddingVertical: space.md }}>
      <View style={{ width: 28, alignItems: 'center', marginTop: 1 }} accessibilityLabel={k.label}>
        <Icon name={k.icon} size={22} color={k.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={font.h3}>{i.title}</Text>
        <Text style={[font.small, { marginTop: space.xs }]}>{i.detail}</Text>
        {i.evidence ? <Text style={[font.tiny, { marginTop: space.xs }]}>{i.evidence}</Text> : null}
      </View>
    </Row>
  );
}

export function InsightCard({ insight }: { insight: Insight }) {
  return (
    <Card style={{ paddingVertical: space.xs }}>
      <InsightRow insight={insight} />
    </Card>
  );
}
