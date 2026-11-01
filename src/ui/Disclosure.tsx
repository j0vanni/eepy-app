/** A tappable row that opens to show more ("Bedtime calculator ▾"), for tools that are useful but not everyday. */
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './components';
import { colors, font, radius, space } from './theme';

export function Disclosure({
  icon,
  title,
  sub,
  open,
  onToggle,
  children,
  color = colors.accent,
}: {
  icon: string;
  title: string;
  /** One line saying what's inside. */
  sub: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  color?: string;
}) {
  return (
    <View style={[styles.wrap, open ? { borderColor: colors.accentSoft } : null]}>
      <Pressable onPress={onToggle} style={({ pressed }) => [styles.head, pressed ? { opacity: 0.7 } : null]} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={styles.icon}>
          <Icon name={icon} size={18} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={font.h3}>{title}</Text>
          <Text style={font.small}>{sub}</Text>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} color={colors.textFaint} />
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: space.sm, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  icon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: space.lg, paddingBottom: space.lg },
});
