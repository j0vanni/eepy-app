/**
 * The Planner's 7-day strip: one tile per coming morning with its weekday, wake-up and the
 * lights-out the night before, plus small marks for a time you set, a free day or a skipped alarm.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { weekdayOfKey } from '@/engine/time';
import type { UpcomingNight } from '@/engine/weekPlan';
import { Icon, Row } from '@/ui/components';
import { colors, font, radius, space } from '@/ui/theme';

import { compactTime, DAY_SHORT, MorningKind, morningKind, planSentence } from './planText';

export const KIND_ICON: Record<MorningKind, { icon: string; color: string }> = {
  alarm: { icon: 'alarm', color: colors.energy },
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
          const meta = KIND_ICON[kind];
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
              <Text style={[styles.weekday, { color: isSel ? colors.text : colors.textDim }]}>{DAY_SHORT[weekdayOfKey(n.wakeDate)]}</Text>
              <Text style={[styles.date, i === 0 ? { color: colors.accent, fontWeight: '700' } : null]}>{i === 0 ? 'tonight' : Number(n.wakeDate.slice(8))}</Text>
              <Icon name={meta.icon} size={15} color={meta.color} />
              <Text style={[styles.time, { color: kind === 'set' ? colors.accent : kind === 'skipped' ? colors.textFaint : colors.text }]} numberOfLines={1}>
                {kind === 'free' ? 'free' : kind === 'skipped' ? 'off' : compactTime(n.twoStep ? n.wake : (n.alarm ?? n.wake))}
              </Text>
              <View style={styles.divider} />
              <Icon name="moon-waning-crescent" size={12} color={colors.light} />
              <Text style={[styles.time, { color: colors.textDim }]} numberOfLines={1}>
                {compactTime(n.bedtime)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Row gap={space.md} style={{ marginTop: space.sm, flexWrap: 'wrap', rowGap: 4 }}>
        <Legend icon="alarm" color={colors.energy} label="wake-up" />
        <Legend icon="moon-waning-crescent" color={colors.light} label="lights out (night before)" />
        <Legend icon="alarm-check" color={colors.accent} label="time you set" />
        <Legend icon="weather-sunny" color={colors.energy} label="free day" />
        <Legend icon="alarm-off" color={colors.textFaint} label="skipped" />
      </Row>
    </View>
  );
}

function Legend({ icon, color, label }: { icon: string; color: string; label: string }) {
  return (
    <Row gap={3}>
      <Icon name={icon} size={12} color={color} />
      <Text style={font.tiny}>{label}</Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: 4 },
  tile: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tileSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  weekday: { fontSize: 13, fontWeight: '700' },
  date: { fontSize: 11, color: colors.textFaint, marginBottom: 2 },
  time: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  divider: { width: '60%', height: 1, backgroundColor: colors.border, marginVertical: 3 },
});
