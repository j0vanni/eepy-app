// "Update available — build N" card (Today and Settings) while a newer GitHub build is waiting.
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { summaryLine } from '../../updates/releases';
import { useUpdateStatus } from '../../updates/status';
import { usePendingUpdate } from '../../updates/useUpdates';
import { Card, Icon, Row } from '../components';
import { colors, font, space } from '../theme';

export function UpdateBanner() {
  const build = usePendingUpdate();
  const latest = useUpdateStatus((s) => s.latest);
  if (build === undefined) return null;
  const line = latest?.build === build ? summaryLine(latest) : 'See what changed and install it in a minute.';
  return (
    <Card onPress={() => router.push('/updates')} accent={colors.accent} animate={false}>
      <Row gap={space.md}>
        <Icon name="cellphone-arrow-down" size={22} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={font.h3}>Update available — build {build}</Text>
          <Text style={font.small} numberOfLines={2}>
            {line}
          </Text>
        </View>
        <Icon name="chevron-right" color={colors.textFaint} />
      </Row>
    </Card>
  );
}
