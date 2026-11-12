/**
 * Small pieces shared by the evening and night widgets (the sleep session, mornings in bed, the
 * bedtime rundown): the panel colour on true black, a caption, and the big button's night version.
 */
import { Pressable, StyleProp, Text, TextStyle } from 'react-native';

import { Icon } from '@/ui/components';
import { colors, font, iconSize, night, radius, space } from '@/ui/theme';

/** A panel on the true-black night view (pass as a Card's `style`). */
export const NIGHT_PANEL = { backgroundColor: night.surface };

/** The small uppercase caption over a group or a number. */
export function Caption({ children, color, style }: { children: string; color?: string; style?: StyleProp<TextStyle> }) {
  return <Text style={[font.label, color ? { color } : null, style]}>{children.toUpperCase()}</Text>;
}

/**
 * The one big action after lights-out: as tall as the kit's `big` button, but amber text on a dark
 * control instead of a filled amber block, so nothing glares in a dark room.
 */
export function NightButton({ label, icon, onPress, disabled }: { label: string; icon?: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.md,
        minHeight: 64,
        paddingVertical: space.lg,
        paddingHorizontal: space.xl,
        borderRadius: radius.lg,
        backgroundColor: colors.surfaceAlt,
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={iconSize.lg} color={colors.accent} /> : null}
      <Text style={[font.h2, { color: colors.accent, flexShrink: 1, textAlign: 'center' }]}>{label}</Text>
    </Pressable>
  );
}
