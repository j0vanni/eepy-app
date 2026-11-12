import { Pressable, Text, View } from 'react-native';

import { AppSwitch, styles as kit } from '../components';
import { font } from '../theme';

/**
 * A setting that is on or off, as a row: the name on the left, the switch on the right. The whole
 * row is the touch target (label included), so it is easy to hit; the switch only shows the state.
 */
export function Toggle({ label, sub, value, onChange, disabled }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={label}
      accessibilityHint={sub}
      style={({ pressed }) => [kit.listRow, { opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={font.body}>{label}</Text>
        {sub ? <Text style={font.small}>{sub}</Text> : null}
      </View>
      {/* Display only: the row handles the tap (a tap on the switch would otherwise toggle twice). */}
      <View style={{ pointerEvents: 'none' }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <AppSwitch value={value} onChange={onChange} disabled={disabled} />
      </View>
    </Pressable>
  );
}
