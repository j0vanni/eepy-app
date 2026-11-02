import { Pressable, Text, View } from 'react-native';

import { AppSwitch } from '../components';
import { colors, font, space } from '../theme';

/**
 * A setting that is on or off. The whole row is the touch target (label included), so it is easy
 * to hit; the switch itself only shows the state.
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
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm + 2, minHeight: 52, opacity: disabled ? 0.5 : 1 }, pressed ? { opacity: 0.75 } : null]}
    >
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Text style={font.body}>{label}</Text>
        {sub ? <Text style={[font.small, { color: colors.textDim }]}>{sub}</Text> : null}
      </View>
      {/* Display only: the row handles the tap (a tap on the switch would otherwise toggle twice). */}
      <View style={{ pointerEvents: 'none' }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <AppSwitch value={value} onChange={onChange} disabled={disabled} />
      </View>
    </Pressable>
  );
}
