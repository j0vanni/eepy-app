import { Switch, Text, View } from 'react-native';

import { Row } from '../components';
import { colors, font, space } from '../theme';

export function Toggle({ label, sub, value, onChange }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row style={{ paddingVertical: space.sm }}>
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Text style={font.body}>{label}</Text>
        {sub ? <Text style={font.small}>{sub}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.border }} thumbColor={colors.text} />
    </Row>
  );
}
