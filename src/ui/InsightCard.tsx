/** One personal insight ("After drinking alcohol, your HRV is 13 ms lower"), the same on Today, Sleep → Trends and the weekly review. */
import { Text, View } from 'react-native';

import type { Insight } from '@/engine/insights';

import { Card, Icon, Row } from './components';
import { colors, font, space } from './theme';

const KIND = {
  negative: { icon: 'trending-down', color: colors.warn, label: 'Seems to hurt your sleep' },
  positive: { icon: 'trending-up', color: colors.good, label: 'Seems to help your sleep' },
  neutral: { icon: 'lightbulb-on-outline', color: colors.info, label: 'Worth knowing' },
} as const;

export function InsightCard({ insight: i }: { insight: Insight }) {
  const k = KIND[i.kind];
  return (
    <Card>
      <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: `${k.color}22`, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={k.label}>
          <Icon name={k.icon} size={18} color={k.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={font.h3}>{i.title}</Text>
          <Text style={[font.small, { marginTop: 4 }]}>{i.detail}</Text>
          {i.evidence ? <Text style={[font.tiny, { marginTop: 6 }]}>{i.evidence}</Text> : null}
        </View>
      </Row>
    </Card>
  );
}
