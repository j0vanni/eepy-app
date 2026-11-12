/**
 * The Plan tab's week: one tile per coming morning with its weekday, the wake-up and the
 * lights-out the night before. A time you set shows in amber, a free day says "free", a skipped
 * alarm "off". Tap a tile to open that day.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { weekdayOfKey } from '@/engine/time';
import type { UpcomingNight } from '@/engine/weekPlan';
import { colors, font, radius, space, touch } from '@/ui/theme';

import { compactTime, DAY_SHORT, MorningKind, morningKind, planSentence } from './planText';

/** The icon for how a morning wakes you. Only a set time and a free day carry a colour. */
export const KIND_ICON: Record<MorningKind, { icon: string; color: string }> = {
  alarm: { icon: 'alarm', color: colors.textDim },
  set: { icon: 'alarm-check', color: colors.accent },
  free: { icon: 'weather-sunny', color: colors.energy },
  skipped: { icon: 'alarm-off', color: colors.textFaint },
};

export function WeekStrip({
  nights,
  selected,
  onSelect,
  skippedDate,
}: {
  nights: UpcomingNight[];
  selected: string;
  onSelect: (wakeDate: string) => void;
  skippedDate?: string;
}) {
  return (
    <View>
      <View style={styles.strip}>
        {nights.map((n, i) => {
          const kind = morningKind(n, skippedDate);
          const isSel = n.wakeDate === selected;
          return (
            <Pressable
              key={n.wakeDate}
              onPress={() => onSelect(n.wakeDate)}
              style={({ pressed }) => [styles.tile, isSel ? styles.tileSelected : null, pressed ? { opacity: 0.7 } : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: isSel }}
              accessibilityLabel={`${i === 0 ? 'Tonight. ' : ''}${planSentence(n, kind)}`}
            >
              <Text style={[font.small, styles.weekday, isSel ? { color: colors.text } : null]}>{DAY_SHORT[weekdayOfKey(n.wakeDate)]}</Text>
              <Text style={[font.tiny, i === 0 ? { color: colors.accent, fontWeight: '700' } : null]} numberOfLines={1}>
                {i === 0 ? 'tonight' : Number(n.wakeDate.slice(8))}
              </Text>
              <Text style={[font.tiny, styles.time, { color: kind === 'set' ? colors.accent : kind === 'skipped' ? colors.textFaint : colors.text }]} numberOfLines={1}>
                {kind === 'free' ? 'free' : kind === 'skipped' ? 'off' : compactTime(n.twoStep ? n.wake : (n.alarm ?? n.wake))}
              </Text>
              <Text style={[font.tiny, styles.time, { color: colors.sleep }]} numberOfLines={1}>
                {compactTime(n.bedtime)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[font.tiny, { marginTop: space.sm, paddingHorizontal: space.xs }]}>
        Each day: wake-up, then <Text style={{ color: colors.sleep }}>lights out</Text> the night before. Amber is a time you set.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: space.xs },
  tile: { flex: 1, minWidth: 0, minHeight: touch.min, alignItems: 'center', gap: space.xxs, paddingVertical: space.md, borderRadius: radius.md, backgroundColor: colors.surface },
  tileSelected: { backgroundColor: colors.accentSoft },
  weekday: { fontWeight: '700' },
  time: { fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: space.xs },
});
