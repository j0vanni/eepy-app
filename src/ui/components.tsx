/**
 * eepy's building blocks. Every screen is made of these and nothing else, so the app reads as one
 * thing: a page of quiet panels on black, one amber action, big numbers.
 *
 *   Screen        the page: title, optional intro, scrolling content
 *   Hero          the one number (or phrase) a screen is about
 *   Card          a panel; CardTitle heads it
 *   Section       a captioned group of panels or rows
 *   ListCard      a panel of ListRows (settings, menus)
 *   Fold          a row that opens in place (explanations, rarely used tools)
 *   Timeline      what happens when, in order
 *   ActionTile    the big one-tap buttons under Today's hero
 *   Button / Chip / Segmented / Stepper / AppSwitch   controls
 *   Stat / KeyValue / Meter / Ring / SplitBar / Pill  numbers
 *   Banner / Note / Empty                             messages
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Children, ComponentProps, createContext, ReactNode, Ref, useContext, useState } from 'react';
import { Platform, Pressable, ScrollView, ScrollViewInstance, StyleProp, StyleSheet, Switch, Text, TextStyle, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { EnterPressable, EnterView, FillBar, FillCircle } from './motion';
import { colors, font, iconSize, night, radius, space, touch } from './theme';

/** Background for the dimmed night view. */
export const NIGHT_BG = night.bg;

/** Lets a chart that is being scrubbed stop the enclosing Screen from scrolling. */
const ScrollLockContext = createContext<(locked: boolean) => void>(() => undefined);
export const useScrollLock = () => useContext(ScrollLockContext);

/** Extra bottom padding for screens with something floating over their content. */
export const FloatingInsetContext = createContext(0);

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({ name, size = iconSize.md, color = colors.textDim }: { name: string; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name as IconName} size={size} color={color} />;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

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
  /** For screens that scroll to a section. */
  scrollRef?: Ref<ScrollViewInstance>;
}) {
  const [locked, setLocked] = useState(false);
  const floatingInset = useContext(FloatingInsetContext);
  const dark = tone === 'night';
  return (
    <ScrollLockContext.Provider value={setLocked}>
      <SafeAreaView style={[styles.safe, dark && { backgroundColor: night.bg }]} edges={['top']}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, floatingInset ? { paddingBottom: space.xl + floatingInset } : null]}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!locked}
          showsVerticalScrollIndicator={false}
        >
          {title || right ? (
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                {title ? (
                  <Text style={[font.h1, dark && { color: night.text }]} accessibilityRole="header">
                    {title}
                  </Text>
                ) : null}
                {subtitle ? <Text style={[font.small, { marginTop: 2 }, dark && { color: night.textDim }]}>{subtitle}</Text> : null}
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

/**
 * The one thing a screen is about: a caption, a big number (or a short phrase), and a line under it.
 * No panel behind it — it sits straight on the page.
 */
export function Hero({
  label,
  value,
  unit,
  caption,
  color = colors.text,
  right,
  onPress,
  children,
  dim,
}: {
  label?: string;
  /** A number, or a few words. */
  value: string;
  /** Small text after the value (e.g. "/100", "h"). */
  unit?: string;
  caption?: ReactNode;
  color?: string;
  right?: ReactNode;
  onPress?: () => void;
  children?: ReactNode;
  /** Night view: one step quieter. */
  dim?: boolean;
}) {
  // A phrase needs a smaller face than a number.
  const phrase = value.length > 7;
  const body = (
    <>
      {label ? <Text style={[font.label, { textTransform: 'uppercase' }]}>{label}</Text> : null}
      <View style={styles.heroRow}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Text
            style={[phrase ? styles.heroPhrase : font.display, { color: dim ? night.text : color }]}
            numberOfLines={phrase ? 2 : 1}
            adjustsFontSizeToFit={!phrase}
            minimumFontScale={0.6}
          >
            {value}
          </Text>
          {unit ? <Text style={[styles.heroUnit, phrase ? { marginBottom: 4 } : null]}>{unit}</Text> : null}
        </View>
        {right}
      </View>
      {typeof caption === 'string' ? <Text style={[font.body, { color: dim ? night.textDim : colors.textDim, marginTop: space.xs }]}>{caption}</Text> : caption}
      {children}
    </>
  );
  if (!onPress) return <EnterView style={styles.hero}>{body}</EnterView>;
  return (
    <EnterPressable onPress={onPress} style={styles.hero} pressedStyle={{ opacity: 0.8 }} accessibilityRole="button">
      {body}
    </EnterPressable>
  );
}

// ---------------------------------------------------------------------------
// Panels and groups
// ---------------------------------------------------------------------------

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
  /** Marks the panel as the one that matters right now: a thin outline in this colour. */
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
    <EnterPressable animate={animate} onPress={onPress} style={cardStyle} pressedStyle={{ backgroundColor: colors.surfaceAlt }} accessibilityRole="button">
      {children}
    </EnterPressable>
  );
}

/**
 * A panel's heading: optional icon, title and an optional right-hand slot (a value, a link or a
 * switch). `sub` is a short hint under the title.
 */
export function CardTitle({ icon, title, sub, right, color = colors.textDim }: { icon?: string; title: string; sub?: string; right?: ReactNode; color?: string }) {
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

/** A group under a small caption. An empty title (a page with one group) shows no caption. */
export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  if (!title && !action) return <View>{children}</View>;
  return (
    <View style={{ marginTop: space.xl }}>
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

/** A quiet text link, for the right of a Section caption ("All nights"). */
export function Link({ label, onPress, color = colors.accent }: { label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} accessibilityRole="link" style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>
      <Text style={{ color, fontWeight: '700', fontSize: 13.5 }}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

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
      <Text style={[font.h2, { color, marginTop: 3, fontVariant: ['tabular-nums'] }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {value}
      </Text>
      {sub ? <Text style={[font.small, { marginTop: 1 }, center ? { textAlign: 'center' } : null]}>{sub}</Text> : null}
    </View>
  );
}

/** One line: what on the left, how much on the right. */
export function KeyValue({ label, value, sub, color = colors.text, onPress }: { label: string; value: string; sub?: string; color?: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [styles.keyValue, pressed && onPress ? { opacity: 0.7 } : null]}>
      <View style={{ flex: 1 }}>
        <Text style={font.body}>{label}</Text>
        {sub ? <Text style={font.small}>{sub}</Text> : null}
      </View>
      <Text style={[font.h3, { color, fontVariant: ['tabular-nums'] }]}>{value}</Text>
      {onPress ? <Icon name="chevron-right" color={colors.textFaint} /> : null}
    </Pressable>
  );
}

/** A small status tag. */
export function Pill({ label, color = colors.textDim, icon }: { label: string; color?: string; icon?: string }) {
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      {icon ? <Icon name={icon} size={13} color={color} /> : null}
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function Row({ children, style, gap = space.md }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[styles.row, { gap }, style]}>{children}</View>;
}

export function Ring({ value, max = 100, size = 96, stroke = 8, color = colors.accent, children }: { value: number; max?: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
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

export function Meter({ value, max = 100, color = colors.accent, height = 6 }: { value: number; max?: number; color?: string; height?: number }) {
  const frac = Math.max(0, Math.min(1, value / max));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: colors.border, overflow: 'hidden' }}>
      <FillBar fraction={frac} style={{ height, backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

/**
 * A bar that grows right (adds) or left (takes) from a centre line: what one thing contributes to
 * a total. `value` and `max` share a unit; the bar is clipped at ±max.
 */
export function SplitBar({ value, max, height = 6 }: { value: number; max: number; height?: number }) {
  const frac = Math.max(-1, Math.min(1, max > 0 ? value / max : 0));
  const half = `${Math.abs(frac) * 50}%` as const;
  return (
    <View style={{ height, borderRadius: height, backgroundColor: colors.border, overflow: 'hidden' }}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: half,
          backgroundColor: frac >= 0 ? colors.good : colors.bad,
          ...(frac >= 0 ? { left: '50%' } : { right: '50%' }),
        }}
      />
      <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: colors.textFaint }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

const SMALL_SLOP = { top: 4, bottom: 4, left: 2, right: 2 };

/**
 * Buttons: 52 dp tall (40 dp `small`, with hitSlop so the touch area still reaches ~48; 64 dp `big`
 * for the one action a screen is there for, like "I'm in bed").
 * primary = the one main action; secondary = other actions; ghost = quiet or dismiss;
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
  const bg = { primary: colors.accent, secondary: colors.surfaceAlt, ghost: 'transparent', danger: colors.badSoft }[kind];
  const fg = { primary: colors.onAccent, secondary: colors.text, ghost: colors.accent, danger: colors.bad }[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={small ? SMALL_SLOP : undefined}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.button, small && styles.buttonSmall, big && styles.buttonBig, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 }, style]}
    >
      {icon ? <Icon name={icon} size={small ? iconSize.sm : big ? iconSize.lg : 19} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 13.5 : big ? 18 : 15.5, flexShrink: 1, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

/**
 * A large one-tap action: icon over a short label. Several sit side by side under Today's hero.
 * `tone` 'primary' fills it amber — at most one per row.
 */
export function ActionTile({ icon, label, onPress, tone = 'default', color }: { icon: string; label: string; onPress: () => void; tone?: 'default' | 'primary'; color?: string }) {
  const primary = tone === 'primary';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, primary ? { backgroundColor: colors.accent } : null, pressed ? { opacity: 0.75 } : null]}
    >
      <Icon name={icon} size={26} color={primary ? colors.onAccent : (color ?? colors.text)} />
      <Text style={[styles.tileLabel, primary ? { color: colors.onAccent } : null]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon, color = colors.accent }: { label: string; selected?: boolean; onPress?: () => void; icon?: string; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={SMALL_SLOP}
      style={({ pressed }) => [styles.chip, selected ? { backgroundColor: color } : null, pressed ? { opacity: 0.75 } : null]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
    >
      {icon ? <Icon name={icon} size={15} color={selected ? colors.onAccent : colors.textDim} /> : null}
      <Text style={{ color: selected ? colors.onAccent : colors.text, fontWeight: '600', fontSize: 13.5 }}>{label}</Text>
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
            <Text style={{ color: on ? colors.text : colors.textDim, fontWeight: '700', fontSize: 13.5 }} numberOfLines={1}>
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

/** The app's switch: amber track and a light thumb on every platform (web's default thumb is teal). */
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

/** A round 44 dp icon button for screen headers (sync, settings…). */
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

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export function ListRow({
  icon,
  title,
  sub,
  right,
  onPress,
  iconColor = colors.textDim,
  value,
}: {
  icon?: string;
  title: string;
  sub?: string;
  right?: ReactNode;
  onPress?: () => void;
  iconColor?: string;
  /** Short current value before the chevron ("7:00 AM", "On"). */
  value?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.listRow, pressed && onPress ? { opacity: 0.65 } : null]}
    >
      {icon ? (
        <View style={styles.listIcon}>
          <Icon name={icon} size={22} color={iconColor} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={font.body}>{title}</Text>
        {sub ? <Text style={font.small}>{sub}</Text> : null}
      </View>
      {value ? <Text style={[font.small, { color: colors.textDim, fontVariant: ['tabular-nums'] }]}>{value}</Text> : null}
      {right ?? (onPress ? <Icon name="chevron-right" color={colors.textFaint} /> : null)}
    </Pressable>
  );
}

/** A panel of ListRows with hairlines between them. */
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

/**
 * A row that opens in place to show more: explanations, rarely used tools, long lists. Closed by
 * default; `open` + `onToggle` make it controlled (e.g. opened by a route param).
 */
export function Fold({
  title,
  sub,
  icon,
  value,
  children,
  startOpen = false,
  open,
  onToggle,
  bare,
}: {
  title: string;
  sub?: string;
  icon?: string;
  /** Short current value shown while closed. */
  value?: string;
  children: ReactNode;
  startOpen?: boolean;
  open?: boolean;
  onToggle?: () => void;
  /** No panel of its own: for use inside a Card or ListCard. */
  bare?: boolean;
}) {
  const [own, setOwn] = useState(startOpen);
  const isOpen = open ?? own;
  const body = (
    <>
      <ListRow
        icon={icon}
        title={title}
        sub={sub}
        value={isOpen ? undefined : value}
        onPress={onToggle ?? (() => setOwn(!own))}
        right={<Icon name={isOpen ? 'chevron-up' : 'chevron-down'} color={colors.textFaint} />}
      />
      {isOpen ? <View style={{ paddingBottom: space.md }}>{children}</View> : null}
    </>
  );
  return bare ? <View accessibilityState={{ expanded: isOpen }}>{body}</View> : <Card style={{ paddingVertical: space.xs }}>{body}</Card>;
}

/** A thin rule between groups inside a panel. */
export function Divider({ spacing = space.md }: { spacing?: number }) {
  return <View style={{ height: 1, backgroundColor: colors.border, opacity: 0.7, marginVertical: spacing }} />;
}

export interface TimelineItem {
  key: string;
  /** Left column: a clock time, or a few characters. */
  time: string;
  title: string;
  sub?: string;
  icon?: string;
  /** done = behind you; now = happening; next = the first thing still to come; later = the rest. */
  state?: 'done' | 'now' | 'next' | 'later';
  onPress?: () => void;
}

/** What happens when, top to bottom: a time, a dot on a line, and what it is. */
export function Timeline({ items, dim }: { items: TimelineItem[]; dim?: boolean }) {
  return (
    <View>
      {items.map((it, i) => {
        const state = it.state ?? 'later';
        const live = state === 'now' || state === 'next';
        const done = state === 'done';
        const dot = state === 'now' ? colors.accent : state === 'next' ? colors.text : colors.border;
        const text = done ? colors.textFaint : dim ? night.text : colors.text;
        return (
          <Pressable
            key={it.key}
            onPress={it.onPress}
            disabled={!it.onPress}
            accessibilityRole={it.onPress ? 'button' : undefined}
            style={({ pressed }) => [styles.tlRow, pressed && it.onPress ? { opacity: 0.65 } : null]}
          >
            <Text style={[styles.tlTime, { color: live ? (state === 'now' ? colors.accent : colors.text) : colors.textFaint }]} numberOfLines={1}>
              {it.time}
            </Text>
            <View style={styles.tlRail}>
              <View style={[styles.tlLine, i === 0 ? { top: 12 } : null, i === items.length - 1 ? { bottom: undefined, height: 12 } : null]} />
              <View style={[styles.tlDot, { backgroundColor: dot }, state === 'now' ? styles.tlDotNow : null]} />
            </View>
            <View style={{ flex: 1, paddingBottom: space.md }}>
              <Text style={[font.body, { color: text, fontWeight: live ? '700' : '400' }, done ? { textDecorationLine: 'line-through' } : null]}>{it.title}</Text>
              {it.sub ? <Text style={[font.small, done ? { color: colors.textFaint } : null]}>{it.sub}</Text> : null}
            </View>
            {it.onPress ? <Icon name="chevron-right" color={colors.textFaint} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export function Note({ children, tone = 'info', icon }: { children: ReactNode; tone?: 'info' | 'warn' | 'bad' | 'good'; icon?: string }) {
  const c = { info: colors.textDim, warn: colors.warn, bad: colors.bad, good: colors.good }[tone];
  return (
    <View style={styles.note}>
      <Icon name={icon ?? (tone === 'good' ? 'check-circle-outline' : tone === 'info' ? 'information-outline' : 'alert-outline')} size={18} color={c} />
      <Text style={[font.small, { flex: 1, color: colors.text }]}>{children}</Text>
    </View>
  );
}

/** One message at the top of a screen, with at most one thing to do about it. */
export function Banner({
  text,
  tone = 'info',
  icon,
  action,
  onAction,
  onPress,
}: {
  text: string;
  tone?: 'info' | 'warn' | 'bad' | 'good';
  icon?: string;
  action?: string;
  onAction?: () => void;
  onPress?: () => void;
}) {
  const c = { info: colors.textDim, warn: colors.warn, bad: colors.bad, good: colors.good }[tone];
  return (
    <Pressable onPress={onPress ?? onAction} disabled={!onPress && !onAction} style={({ pressed }) => [styles.banner, pressed ? { opacity: 0.75 } : null]} accessibilityRole={onPress || onAction ? 'button' : undefined}>
      <Icon name={icon ?? (tone === 'good' ? 'check-circle-outline' : tone === 'info' ? 'information-outline' : 'alert-outline')} size={18} color={c} />
      <Text style={[font.small, { flex: 1, color: colors.text }]}>{text}</Text>
      {action ? <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13.5 }}>{action}</Text> : null}
    </Pressable>
  );
}

export function Empty({ icon, title, body, children }: { icon: string; title: string; body: string; children?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.md }}>
      <Icon name={icon} size={40} color={colors.textFaint} />
      <Text style={[font.h2, { marginTop: space.md, textAlign: 'center' }]}>{title}</Text>
      <Text style={[font.small, { textAlign: 'center', marginTop: space.sm, marginBottom: space.lg }]}>{body}</Text>
      {children}
    </View>
  );
}

/** Text styles for the odd place that needs raw Text. */
export const text: Record<'dim' | 'faint' | 'accent' | 'tabular', TextStyle> = {
  dim: { color: colors.textDim },
  faint: { color: colors.textFaint },
  accent: { color: colors.accent },
  tabular: { fontVariant: ['tabular-nums'] },
};

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: 56 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space.lg, gap: space.sm },
  intro: { marginBottom: space.lg },
  hero: { marginBottom: space.lg },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, marginTop: 2 },
  heroPhrase: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -0.8, color: colors.text },
  heroUnit: { fontSize: 18, fontWeight: '700', color: colors.textFaint, marginLeft: 6, marginBottom: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    // Transparent unless the panel is marked with `accent`.
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: space.md,
  },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md, minHeight: 24 },
  cardTitleRight: { flexShrink: 1, alignItems: 'flex-end' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm, minHeight: 20, gap: space.sm, paddingHorizontal: space.xs },
  row: { flexDirection: 'row', alignItems: 'center' },
  keyValue: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingVertical: space.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: touch.comfy,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radius.md + 2,
  },
  buttonSmall: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 14, gap: 6, borderRadius: radius.md },
  buttonBig: { minHeight: 64, paddingVertical: 16, paddingHorizontal: 24, gap: 10, borderRadius: radius.lg },
  tile: {
    flex: 1,
    minHeight: 84,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: space.md,
    paddingHorizontal: space.xs,
  },
  tileLabel: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'center', lineHeight: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md + 2, padding: 4 },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderRadius: radius.md - 2 },
  segmentOn: { backgroundColor: colors.border },
  stepBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  stepBtnPressed: { backgroundColor: colors.border },
  stepValue: { minWidth: 84, textAlign: 'center', fontVariant: ['tabular-nums'] },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 56 },
  listSep: { height: 1, backgroundColor: colors.border, opacity: 0.7 },
  listIcon: { width: 28, alignItems: 'center', justifyContent: 'center' },
  tlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, minHeight: 44 },
  tlTime: { width: 68, fontSize: 13.5, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'right' },
  tlRail: { width: 12, alignSelf: 'stretch', alignItems: 'center' },
  tlLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.border },
  tlDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  tlDotNow: { width: 12, height: 12, borderRadius: 6, marginTop: 5 },
  note: { flexDirection: 'row', gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  iconButton: { width: touch.min, height: touch.min, borderRadius: touch.min / 2, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
