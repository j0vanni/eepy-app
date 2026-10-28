import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ComponentProps, ReactNode } from 'react';
import { Pressable, ScrollView, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { colors, font, radius, space } from './theme';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({ name, size = 20, color = colors.textDim }: { name: string; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name as IconName} size={size} color={color} />;
}

export function Screen({
  title,
  subtitle,
  right,
  children,
  refreshControl,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  refreshControl?: ComponentProps<typeof ScrollView>['refreshControl'];
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        {(title || right) && (
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              {title ? <Text style={font.h1}>{title}</Text> : null}
              {subtitle ? <Text style={[font.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
            </View>
            {right}
          </View>
        )}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style, onPress, accent }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accent?: string }) {
  const cardStyle = [styles.card, accent ? { borderColor: accent } : null, style];
  if (!onPress) return <View style={cardStyle}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [...cardStyle, pressed ? { opacity: 0.85 } : null]}>
      {children}
    </Pressable>
  );
}

export function CardTitle({ icon, title, right, color = colors.accent }: { icon?: string; title: string; right?: ReactNode; color?: string }) {
  return (
    <View style={styles.cardTitle}>
      {icon ? <Icon name={icon} size={18} color={color} /> : null}
      <Text style={[font.h3, { flex: 1 }]}>{title}</Text>
      {right}
    </View>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <View style={{ marginTop: space.lg }}>
      <View style={[styles.row, { marginBottom: space.sm }]}>
        <Text style={[font.tiny, { flex: 1, textTransform: 'uppercase', fontWeight: '600' }]}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Stat({ label, value, sub, color = colors.text, align = 'left' }: { label: string; value: string; sub?: string; color?: string; align?: 'left' | 'center' }) {
  return (
    <View style={{ flex: 1, alignItems: align === 'center' ? 'center' : 'flex-start' }}>
      <Text style={font.tiny}>{label.toUpperCase()}</Text>
      <Text style={[font.h2, { color, marginTop: 2 }]}>{value}</Text>
      {sub ? <Text style={[font.small, { marginTop: 1 }]}>{sub}</Text> : null}
    </View>
  );
}

export function Row({ children, style, gap = space.md }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[styles.row, { gap }, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  icon,
  kind = 'primary',
  disabled,
  small,
}: {
  label: string;
  onPress: () => void;
  icon?: string;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  small?: boolean;
}) {
  const bg = { primary: colors.accent, secondary: colors.surfaceAlt, ghost: 'transparent', danger: '#3A1B2A' }[kind];
  const fg = { primary: '#140F33', secondary: colors.text, ghost: colors.accent, danger: colors.bad }[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        small && { paddingVertical: 7, paddingHorizontal: 12 },
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        kind === 'ghost' && { borderWidth: 1, borderColor: colors.border },
      ]}
    >
      {icon ? <Icon name={icon} size={small ? 16 : 18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 13 : 15 }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon, color = colors.accent }: { label: string; selected?: boolean; onPress?: () => void; icon?: string; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected ? { backgroundColor: color, borderColor: color } : null]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      {icon ? <Icon name={icon} size={15} color={selected ? '#140F33' : colors.textDim} /> : null}
      <Text style={{ color: selected ? '#140F33' : colors.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={[styles.segment, o.value === value && { backgroundColor: colors.accentSoft }]}>
          <Text style={{ color: o.value === value ? colors.text : colors.textDim, fontWeight: '600', fontSize: 13 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Stepper({ label, value, onDec, onInc, sub }: { label: string; value: string; onDec: () => void; onInc: () => void; sub?: string }) {
  return (
    <View style={[styles.row, { paddingVertical: space.sm }]}>
      <View style={{ flex: 1 }}>
        <Text style={font.body}>{label}</Text>
        {sub ? <Text style={font.small}>{sub}</Text> : null}
      </View>
      <Pressable onPress={onDec} style={styles.stepBtn} accessibilityLabel={`Decrease ${label}`}>
        <Icon name="minus" color={colors.text} />
      </Pressable>
      <Text style={[font.h3, { minWidth: 76, textAlign: 'center' }]}>{value}</Text>
      <Pressable onPress={onInc} style={styles.stepBtn} accessibilityLabel={`Increase ${label}`}>
        <Icon name="plus" color={colors.text} />
      </Pressable>
    </View>
  );
}

export function ListRow({ icon, title, sub, right, onPress, iconColor = colors.accent }: { icon?: string; title: string; sub?: string; right?: ReactNode; onPress?: () => void; iconColor?: string }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.listRow, pressed && onPress ? { opacity: 0.7 } : null]}>
      {icon ? (
        <View style={styles.listIcon}>
          <Icon name={icon} size={18} color={iconColor} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={font.body}>{title}</Text>
        {sub ? <Text style={font.small}>{sub}</Text> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron-right" color={colors.textFaint} /> : null)}
    </Pressable>
  );
}

export function Note({ children, tone = 'info', icon }: { children: ReactNode; tone?: 'info' | 'warn' | 'bad' | 'good'; icon?: string }) {
  const c = { info: colors.info, warn: colors.warn, bad: colors.bad, good: colors.good }[tone];
  return (
    <View style={[styles.note, { borderLeftColor: c }]}>
      <Icon name={icon ?? (tone === 'good' ? 'check-circle-outline' : tone === 'info' ? 'information-outline' : 'alert-outline')} size={18} color={c} />
      <Text style={[font.small, { flex: 1, color: colors.text }]}>{children}</Text>
    </View>
  );
}

export function Ring({ value, max = 100, size = 96, stroke = 10, color = colors.accent, children }: { value: number; max?: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, value / max));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c * frac} ${c}`}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      {children}
    </View>
  );
}

export function Meter({ value, max = 100, color = colors.accent, height = 8 }: { value: number; max?: number; color?: string; height?: number }) {
  const frac = Math.max(0, Math.min(1, value / max));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: colors.border, overflow: 'hidden' }}>
      <View style={{ width: `${frac * 100}%`, height, backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

export function Empty({ icon, title, body, children }: { icon: string; title: string; body: string; children?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
      <Icon name={icon} size={40} color={colors.accent} />
      <Text style={[font.h2, { marginTop: space.md, textAlign: 'center' }]}>{title}</Text>
      <Text style={[font.small, { textAlign: 'center', marginTop: space.sm, marginBottom: space.lg }]}>{body}</Text>
      {children}
    </Card>
  );
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: space.lg, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md, gap: space.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.md,
  },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  segmented: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, padding: 3 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.pill },
  stepBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  listIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  note: {
    flexDirection: 'row',
    gap: space.sm,
    backgroundColor: colors.surfaceAlt,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.sm,
  },
});
