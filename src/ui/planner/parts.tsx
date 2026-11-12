/**
 * Small pieces the Plan screens share, built from the kit's tokens:
 *
 *   Rows       a panel of rows with hairlines that reports where each row sits (for scroll-to)
 *   DayPicker  seven weekday toggles, Monday first
 *   Bullet     an icon and a line of small text
 *   Caption    a small uppercase label inside a panel
 */
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Icon, styles as kit } from '@/ui/components';
import { colors, font, iconSize, radius, space, touch } from '@/ui/theme';

export type RowItem = { key: string; node: ReactNode } | null | undefined | false;

/** A `ListCard` whose rows have keys: `onRowLayout` reports each row's offset inside the panel. */
export function Rows({ rows, onRowLayout }: { rows: RowItem[]; onRowLayout?: (key: string, y: number) => void }) {
  const shown = rows.filter((r): r is { key: string; node: ReactNode } => !!r);
  if (!shown.length) return null;
  return (
    <Card style={{ paddingVertical: space.xs }}>
      {shown.map((r, i) => (
        <View key={r.key} onLayout={onRowLayout ? (e) => onRowLayout(r.key, e.nativeEvent.layout.y) : undefined}>
          {i ? <View style={kit.listSep} /> : null}
          {r.node}
        </View>
      ))}
    </Card>
  );
}

/** Monday first, the way most people read a week. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Seven weekday toggles in one even row. `label` says what "on" means for a screen reader. */
export function DayPicker({ days, onToggle, short, label }: { days: number[]; onToggle: (day: number) => void; short: string[]; label: (day: number, on: boolean) => string }) {
  return (
    <View style={local.days}>
      {WEEK_ORDER.map((d) => {
        const on = days.includes(d);
        return (
          <Pressable
            key={d}
            onPress={() => onToggle(d)}
            style={({ pressed }) => [local.day, on ? { backgroundColor: colors.accent } : null, pressed ? { opacity: 0.7 } : null]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={label(d, on)}
          >
            <Text style={[font.small, { fontWeight: '700', color: on ? colors.onAccent : colors.text }]}>{short[d]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** An icon and a line of small text, top-aligned. */
export function Bullet({ icon, color = colors.textDim, children, strong }: { icon: string; color?: string; children: ReactNode; strong?: boolean }) {
  return (
    <View style={local.bullet}>
      <View style={{ marginTop: 1 }}>
        <Icon name={icon} size={iconSize.sm} color={color} />
      </View>
      <Text style={[font.small, { flex: 1 }, strong ? { color: colors.text } : null]}>{children}</Text>
    </View>
  );
}

/** A small uppercase label inside a panel. */
export function Caption({ children, color }: { children: string; color?: string }) {
  return <Text style={[font.label, { textTransform: 'uppercase' }, color ? { color } : null]}>{children}</Text>;
}

const local = StyleSheet.create({
  days: { flexDirection: 'row', gap: space.xs },
  day: { flex: 1, minWidth: 0, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
});
