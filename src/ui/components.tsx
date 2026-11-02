import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Children, ComponentProps, createContext, ReactNode, Ref, useContext, useState } from 'react';
import { Platform, Pressable, ScrollView, ScrollViewInstance, StyleProp, StyleSheet, Switch, Text, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { EnterPressable, EnterView, FillBar, FillCircle } from './motion';
import { colors, font, iconSize, radius, space, touch } from './theme';

/** Background for the dimmed night view. */
export const NIGHT_BG = '#05070F';

/** Lets a chart that is being scrubbed stop the enclosing Screen from scrolling. */
const ScrollLockContext = createContext<(locked: boolean) => void>(() => undefined);
export const useScrollLock = () => useContext(ScrollLockContext);

/** Extra bottom padding for screens with a floating button over their content (set by the tabs layout). */
export const FloatingInsetContext = createContext(0);

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({ name, size = iconSize.md, color = colors.textDim }: { name: string; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name as IconName} size={size} color={color} />;
}

export function Screen({
  title,
  subtitle,
  right,
  children,
  refreshControl,
  tone = 'default',
  scrollRef,
}: {
  title?: string;
  /** Under the title; on a stack screen (title in the header bar) a one-line intro at the top. */
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  refreshControl?: ComponentProps<typeof ScrollView>['refreshControl'];
  /** 'night' dims the whole screen. */
  tone?: 'default' | 'night';
  /** For screens that scroll to a section (e.g. the Planner opened from search). */
  scrollRef?: Ref<ScrollViewInstance>;
}) {
  const [locked, setLocked] = useState(false);
  const floatingInset = useContext(FloatingInsetContext);
  return (
    <ScrollLockContext.Provider value={setLocked}>
      <SafeAreaView style={[styles.safe, tone === 'night' && { backgroundColor: NIGHT_BG }]} edges={['top']}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, floatingInset ? { paddingBottom: space.xl + floatingInset } : null]}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!locked}
        >
          {title || right ? (
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                {title ? (
                  <Text style={[font.h1, tone === 'night' && { color: colors.textDim }]} accessibilityRole="header">
                    {title}
                  </Text>
                ) : null}
                {subtitle ? <Text style={[font.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
              </View>
              {right}
            </View>
          ) : subtitle ? (
            // Stack screens take their title from the header bar: the subtitle is a one-line intro.
            <Text style={[font.small, styles.intro]}>{subtitle}</Text>
          ) : null}
          {children}
        </ScrollView>
      </SafeAreaView>
    </ScrollLockContext.Provider>
  );
}

export function Card({
  children,
  style,
  onPress,
  accent,
  animate = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accent?: string;
  /** Fade/slide in on mount (default true). */
  animate?: boolean;
}) {
  const cardStyle = [styles.card, accent ? { borderColor: accent } : null, style];
  if (!onPress)
    return (
      <EnterView animate={animate} style={cardStyle}>
        {children}
      </EnterView>
    );
  return (
    <EnterPressable animate={animate} onPress={onPress} style={cardStyle} pressedStyle={{ opacity: 0.85 }} accessibilityRole="button">
      {children}
    </EnterPressable>
  );
}

/**
 * A card's heading: icon, title and an optional right-hand slot (a value, a link or a switch).
 * `sub` is a short hint under the title — put long status text there rather than on the right,
 * where it would squeeze the title.
 */
export function CardTitle({ icon, title, sub, right, color = colors.accent }: { icon?: string; title: string; sub?: string; right?: ReactNode; color?: string }) {
  return (
    <View style={[styles.cardTitle, sub ? { alignItems: 'flex-start' } : null]}>
      {icon ? (
        <View style={sub ? { marginTop: 1 } : null}>
          <Icon name={icon} size={iconSize.md} color={color} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={font.h3} accessibilityRole="header">
          {title}
        </Text>
        {sub ? <Text style={[font.small, { marginTop: 1 }]}>{sub}</Text> : null}
      </View>
      {right ? <View style={styles.cardTitleRight}>{right}</View> : null}
    </View>
  );
}

/** The app's switch: accent track and a light thumb on every platform (web's default thumb is teal). */
export function AppSwitch({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  const web = Platform.OS === 'web' ? ({ activeThumbColor: colors.text, activeTrackColor: colors.accent } as object) : null;
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      trackColor={{ true: colors.accent, false: colors.border }}
      thumbColor={colors.text}
      accessibilityLabel={label}
      {...web}
    />
  );
}

/** A group of cards under a small uppercase heading. An empty title (a page with one group) shows no heading. */
export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  if (!title && !action) return <View>{children}</View>;
  return (
    <View style={{ marginTop: space.lg }}>
      <View style={styles.sectionHead}>
        <Text style={[font.label, { flex: 1, textTransform: 'uppercase' }]} accessibilityRole="header">
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/**
 * A labelled number. The value never wraps (it shrinks a little on Android if it must); keep `sub`
 * to a few words so a row of three stats stays tidy.
 */
export function Stat({ label, value, sub, color = colors.text, align = 'left' }: { label: string; value: string; sub?: string; color?: string; align?: 'left' | 'center' }) {
  const center = align === 'center';
  return (
    // Top-aligned in its row, so labels line up whether or not a neighbour has a sub-line.
    <View style={{ flex: 1, minWidth: 0, alignSelf: 'flex-start', alignItems: center ? 'center' : 'flex-start' }}>
      <Text style={[font.label, center ? { textAlign: 'center' } : null]} numberOfLines={2}>
        {label.toUpperCase()}
      </Text>
      <Text style={[font.h2, { color, marginTop: 2, fontVariant: ['tabular-nums'] }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {value}
      </Text>
      {sub ? <Text style={[font.small, { marginTop: 1 }, center ? { textAlign: 'center' } : null]}>{sub}</Text> : null}
    </View>
  );
}

export function Row({ children, style, gap = space.md }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[styles.row, { gap }, style]}>{children}</View>;
}

const SMALL_SLOP = { top: 4, bottom: 4, left: 2, right: 2 };

/**
 * Buttons: 48 dp tall (40 dp `small`, with hitSlop so the touch area still reaches ~48; 60 dp `big`
 * for the one action a screen is there for, like "I'm in bed").
 * primary = the one main action on a card; secondary = other actions; ghost = quiet or dismiss;
 * danger = destructive. `style` is for layout only (e.g. `{ flex: 1 }` in a row of buttons).
 */
export function Button({
  label,
  onPress,
  icon,
  kind = 'primary',
  disabled,
  small,
  big,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: string;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  small?: boolean;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = { primary: colors.accent, secondary: colors.surfaceAlt, ghost: 'transparent', danger: '#3A1B2A' }[kind];
  const fg = { primary: colors.onAccent, secondary: colors.text, ghost: colors.accent, danger: colors.bad }[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={small ? SMALL_SLOP : undefined}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        big && styles.buttonBig,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        kind !== 'primary' && { borderWidth: 1, borderColor: kind === 'danger' ? '#5A2A3C' : colors.border },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={small ? iconSize.sm : big ? iconSize.lg : 18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 13 : big ? 17 : 15, flexShrink: 1, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon, color = colors.accent }: { label: string; selected?: boolean; onPress?: () => void; icon?: string; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={SMALL_SLOP}
      style={({ pressed }) => [styles.chip, selected ? { backgroundColor: color, borderColor: color } : null, pressed ? { opacity: 0.75 } : null]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
    >
      {icon ? <Icon name={icon} size={15} color={selected ? colors.onAccent : colors.textDim} /> : null}
      <Text style={{ color: selected ? colors.onAccent : colors.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [styles.segment, on && styles.segmentOn, pressed && !on ? { opacity: 0.7 } : null]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={{ color: on ? colors.text : colors.textDim, fontWeight: on ? '700' : '600', fontSize: 13 }} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ label, value, onDec, onInc, sub }: { label: string; value: string; onDec: () => void; onInc: () => void; sub?: string }) {
  return (
    <View style={[styles.row, { paddingVertical: space.sm, gap: space.xs }]}>
      <View style={{ flex: 1, paddingRight: space.xs }}>
        <Text style={font.body}>{label}</Text>
        {sub ? <Text style={font.small}>{sub}</Text> : null}
      </View>
      <Pressable onPress={onDec} style={({ pressed }) => [styles.stepBtn, pressed ? styles.stepBtnPressed : null]} hitSlop={4} accessibilityRole="button" accessibilityLabel={`Decrease ${label}`}>
        <Icon name="minus" color={colors.text} />
      </Pressable>
      <Text style={[font.h3, styles.stepValue]} numberOfLines={1}>
        {value}
      </Text>
      <Pressable onPress={onInc} style={({ pressed }) => [styles.stepBtn, pressed ? styles.stepBtnPressed : null]} hitSlop={4} accessibilityRole="button" accessibilityLabel={`Increase ${label}`}>
        <Icon name="plus" color={colors.text} />
      </Pressable>
    </View>
  );
}

export function ListRow({ icon, title, sub, right, onPress, iconColor = colors.accent }: { icon?: string; title: string; sub?: string; right?: ReactNode; onPress?: () => void; iconColor?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.listRow, pressed && onPress ? { opacity: 0.7 } : null]}
    >
      {icon ? (
        <View style={styles.listIcon}>
          <Icon name={icon} size={iconSize.md} color={iconColor} />
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

/** A card of ListRows with hairline separators between them (inset past the icon). */
export function ListCard({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <Card style={{ paddingVertical: space.xs }}>
      {rows.map((row, i) => (
        <View key={i}>
          {i ? <View style={styles.listSep} /> : null}
          {row}
        </View>
      ))}
    </Card>
  );
}

/** A round 44 dp icon button for screen headers (journal, sync, settings…). */
export function IconButton({ icon, label, onPress, color = colors.textDim, children }: { icon: string; label: string; onPress: () => void; color?: string; children?: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={2}
      style={({ pressed }) => [styles.iconButton, pressed ? { backgroundColor: colors.surfaceAlt } : null]}
    >
      {children ?? <Icon name={icon} size={iconSize.lg} color={color} />}
    </Pressable>
  );
}

/** A thin rule between groups inside a card. */
export function Divider({ spacing = space.md }: { spacing?: number }) {
  return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing }} />;
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
        <FillCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          fraction={frac}
          circumference={c}
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
      <FillBar fraction={frac} style={{ height, backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

export function Empty({ icon, title, body, children }: { icon: string; title: string; body: string; children?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={34} color={colors.accent} />
      </View>
      <Text style={[font.h2, { marginTop: space.md, textAlign: 'center' }]}>{title}</Text>
      <Text style={[font.small, { textAlign: 'center', marginTop: space.sm, marginBottom: space.lg }]}>{body}</Text>
      {children}
    </Card>
  );
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: space.lg, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space.lg, gap: space.sm },
  intro: { marginBottom: space.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.md,
  },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md, minHeight: 24 },
  cardTitleRight: { flexShrink: 1, alignItems: 'flex-end' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm, minHeight: 20, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: touch.comfy,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
  },
  buttonSmall: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 14, gap: 6 },
  buttonBig: { minHeight: 60, paddingVertical: 16, paddingHorizontal: 24, gap: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  segmented: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, padding: 3, borderWidth: 1, borderColor: colors.border },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderRadius: radius.pill },
  segmentOn: { backgroundColor: colors.accentSoft },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnPressed: { backgroundColor: colors.accentSoft },
  stepValue: { minWidth: 84, textAlign: 'center', fontVariant: ['tabular-nums'] },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 56 },
  listSep: { height: 1, backgroundColor: colors.border, marginLeft: 48, opacity: 0.7 },
  listIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  note: {
    flexDirection: 'row',
    gap: space.sm,
    backgroundColor: colors.surfaceAlt,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  iconButton: { width: touch.min, height: touch.min, borderRadius: touch.min / 2, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
});
